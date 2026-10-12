import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paymentMiddleware } from "x402-express";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import type { FacilitatorConfig } from "x402/types";
import { isAddress, type Address } from "viem";
import { config, assertMainnetReady } from "./config.js";
import { getRevenueStats } from "./onchain/usdc.js";
import { computeScore, findListing } from "./services/score.js";
import { db } from "./db.js";

assertMainnetReady();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);

// ===== Rotas gratuitas (registradas ANTES do middleware de pagamento) =====

// Documentacao
app.use(express.static(path.join(__dirname, "..", "public")));

// Teste de integracao para compradores
app.get("/ping", (_req, res) => {
  const listings = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number };
  res.json({
    ok: true,
    service: "Payerproof",
    time: new Date().toISOString(),
    network: config.network,
    trackedListings: listings.n,
    paidEndpoints: {
      "GET /revenue": { price: "$0.01", params: "address (0x...), window (hours, max 720)" },
      "GET /score": { price: "$0.02", params: "resource (x402 service URL), window (hours, max 720)" },
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ===== Middleware de pagamento x402 =====

// Testnet: facilitador publico x402.org (default). Mainnet: facilitador do CDP.
const facilitator =
  config.network === "base"
    ? (cdpFacilitator as unknown as FacilitatorConfig)
    : undefined;

app.use(
  paymentMiddleware(
    config.payTo,
    {
      "GET /revenue": {
        price: "$0.01",
        network: config.network,
        config: {
          description:
            "Verified on-chain USDC revenue stats for any x402 seller address on Base: total received, transfer count, unique payers, top-payer concentration, largest transfers. Window up to 720h (30d), incremental coverage.",
          mimeType: "application/json",
          maxTimeoutSeconds: 120,
          discoverable: true,
          resource: `${config.publicBaseUrl}/revenue` as `${string}://${string}`,
          inputSchema: {
            queryParams: {
              address: "EVM address (0x...) that receives the payments",
              window: "window in hours, default 24, max 720",
            },
          },
          outputSchema: {
            type: "json",
            example: {
              address: "0x...",
              window: { hours: 24, hoursCovered: 24, complete: true },
              totalUsdcIn: 12.34,
              transferCount: 210,
              uniquePayers: 18,
              topPayerShare: 0.22,
            },
          },
        },
      },
      "GET /score": {
        price: "$0.02",
        network: config.network,
        config: {
          description:
            "Trust score (0-100) for an x402 service listed in the Bazaar: liveness probe, on-chain payer diversity, reported-vs-verified revenue (detects inflated counters and self-dealing), and listing age. Returns full component breakdown and flags.",
          mimeType: "application/json",
          maxTimeoutSeconds: 120,
          discoverable: true,
          resource: `${config.publicBaseUrl}/score` as `${string}://${string}`,
          inputSchema: {
            queryParams: {
              resource: "full URL of the x402 service to score (as listed in the Bazaar)",
              window: "on-chain window in hours, default 720 (30d)",
            },
          },
          outputSchema: {
            type: "json",
            example: {
              resource: "https://api.example.com/paid",
              score: 72,
              grade: "B",
              flags: ["concentrated_payers"],
              components: { liveness: {}, payerDiversity: {}, revenueVerification: {}, listingAge: {} },
            },
          },
        },
      },
    },
    facilitator,
    { appName: "Payerproof" },
  ),
);

// ===== Rotas pagas =====

app.get("/revenue", async (req, res) => {
  try {
    const address = String(req.query.address ?? "");
    if (!isAddress(address)) {
      res.status(400).json({ error: "query param 'address' must be a valid EVM address (0x...)" });
      return;
    }
    const window = Math.min(Math.max(Number(req.query.window ?? 24) || 24, 1), 720);
    const listing = db
      .prepare("SELECT amount_atomic FROM listings WHERE recipient = ? LIMIT 1")
      .get(address.toLowerCase()) as { amount_atomic: string | null } | undefined;
    const stats = await getRevenueStats(address as Address, window, listing?.amount_atomic ?? undefined);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});

app.get("/score", async (req, res) => {
  try {
    const resource = String(req.query.resource ?? "");
    if (!/^https?:\/\/.+/.test(resource)) {
      res.status(400).json({ error: "query param 'resource' must be a full http(s) URL" });
      return;
    }
    const window = Math.min(Math.max(Number(req.query.window ?? 720) || 720, 1), 720);
    const result = await computeScore(resource, window);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});

app.listen(config.port, () => {
  const listed = findListing(`${config.publicBaseUrl}/score`);
  console.log(`Payerproof rodando em http://localhost:${config.port}`);
  console.log(`  rede: ${config.network} | payTo: ${config.payTo}`);
  console.log(`  facilitador: ${config.network === "base" ? "CDP (mainnet)" : "x402.org (testnet)"}`);
  if (config.network === "base" && !listed) {
    console.log("  dica: a listagem no Bazaar aparece apos as primeiras liquidacoes via facilitador CDP.");
  }
});
