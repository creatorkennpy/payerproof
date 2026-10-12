/**
 * Nota de confianca 0-100 de um servico x402, combinando:
 *  - prova de vida (sonda HTTP ao vivo)           ate 30 pts
 *  - diversidade de pagadores on-chain            ate 30 pts
 *  - receita verificada vs. contador reportado    ate 25 pts
 *  - idade/consistencia da listagem no catalogo   ate 15 pts
 */
import type { Address } from "viem";
import { db } from "../db.js";
import { probeResource, type ProbeResult } from "./probe.js";
import { getRevenueStats, type RevenueStats } from "../onchain/usdc.js";

export interface ListingRow {
  recipient: string;
  resource: string;
  network: string | null;
  amount_atomic: string | null;
  price_usd: number | null;
  service_name: string | null;
  description: string | null;
  first_seen: string;
  last_seen: string;
  reported_calls_30d: number | null;
  reported_payers_30d: number | null;
  last_called_at: string | null;
}

export function findListing(resource: string): ListingRow | undefined {
  return db
    .prepare(
      `SELECT recipient, resource, network, amount_atomic, price_usd, service_name,
              description, first_seen, last_seen, reported_calls_30d,
              reported_payers_30d, last_called_at
       FROM listings WHERE resource = ?
       ORDER BY last_seen DESC LIMIT 1`,
    )
    .get(resource) as ListingRow | undefined;
}

export interface ScoreResult {
  resource: string;
  recipient: string | null;
  serviceName: string | null;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: {
    liveness: { points: number; max: 30; probe: ProbeResult };
    payerDiversity: {
      points: number;
      max: 30;
      uniquePayers: number | null;
      topPayerShare: number | null;
    };
    revenueVerification: {
      points: number;
      max: 25;
      reportedCalls30d: number | null;
      onchainPriceMatchingTransfers: number | null;
      onchainTotalUsdcIn: number | null;
      windowHoursCovered: number | null;
      ratioEstimate: number | null;
    };
    listingAge: { points: number; max: 15; firstSeen: string | null; daysTracked: number | null };
  };
  flags: string[];
  onchainWindow: RevenueStats["window"] | null;
  methodology: string;
  disclaimer: string;
}

function gradeFor(score: number): ScoreResult["grade"] {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

function livenessPoints(probe: ProbeResult, flags: string[]): number {
  if (!probe.reachable) {
    flags.push("dead_endpoint");
    return 0;
  }
  if (probe.returns402) {
    if (probe.payToMatches === false) {
      flags.push("payto_mismatch");
      return 15;
    }
    return probe.latencyMs !== null && probe.latencyMs > 4000 ? 24 : 30;
  }
  // Responde mas nao pede pagamento no GET direto (pode exigir POST/corpo).
  flags.push("no_402_on_probe");
  return 12;
}

function diversityPoints(stats: RevenueStats | null, flags: string[]): number {
  if (!stats || stats.uniquePayers === 0) {
    flags.push("no_onchain_activity_in_window");
    return 0;
  }
  const p = stats.uniquePayers;
  let pts: number;
  if (p >= 100) pts = 30;
  else if (p >= 21) pts = 25;
  else if (p >= 6) pts = 18;
  else if (p >= 2) pts = 10;
  else pts = 5;

  const share = stats.topPayerShare ?? 0;
  if (share > 0.8) {
    flags.push("self_dealing_suspected");
    pts = Math.round(pts * 0.4);
  } else if (share > 0.5) {
    flags.push("concentrated_payers");
    pts = Math.round(pts * 0.7);
  }
  return pts;
}

function revenuePoints(
  listing: ListingRow | undefined,
  stats: RevenueStats | null,
  flags: string[],
): { points: number; ratio: number | null } {
  const reported = listing?.reported_calls_30d ?? null;
  if (reported === null || reported === 0) return { points: 12, ratio: null }; // neutro: nada a verificar
  if (!stats) return { points: 12, ratio: null };

  const coveredDays = Math.max(stats.window.hoursCovered / 24, 1 / 24);
  const onchainCalls = stats.priceMatchingCount ?? stats.transferCount;
  const estPerDay = onchainCalls / coveredDays;
  const reportedPerDay = reported / 30;
  const ratio = reportedPerDay > 0 ? estPerDay / reportedPerDay : null;

  if (onchainCalls === 0) {
    flags.push("inflated_counter");
    return { points: 0, ratio: 0 };
  }
  if (ratio === null) return { points: 12, ratio: null };
  if (ratio >= 0.5) return { points: 25, ratio };
  if (ratio >= 0.2) return { points: 18, ratio };
  if (ratio >= 0.05) return { points: 10, ratio };
  flags.push("inflated_counter");
  return { points: 3, ratio };
}

function agePoints(listing: ListingRow | undefined, flags: string[]): {
  points: number;
  daysTracked: number | null;
} {
  if (!listing) {
    flags.push("not_in_bazaar_catalog");
    return { points: 0, daysTracked: null };
  }
  const first = new Date(listing.first_seen).getTime();
  const days = (Date.now() - first) / 86_400_000;
  const daysTracked = Math.round(days * 10) / 10;
  if (days >= 30) return { points: 15, daysTracked };
  if (days >= 14) return { points: 11, daysTracked };
  if (days >= 7) return { points: 8, daysTracked };
  if (days >= 2) return { points: 5, daysTracked };
  flags.push("new_listing");
  return { points: 2, daysTracked };
}

export async function computeScore(resource: string, windowHours = 720): Promise<ScoreResult> {
  const flags: string[] = [];
  const listing = findListing(resource);

  const probe = await probeResource(resource, listing?.recipient);

  // Recipient: da listagem ou, em fallback, do que o proprio endpoint anuncia no 402.
  const recipient = listing?.recipient ?? probe.advertisedPayTo ?? null;

  let stats: RevenueStats | null = null;
  if (recipient && /^0x[0-9a-f]{40}$/i.test(recipient)) {
    try {
      stats = await getRevenueStats(
        recipient as Address,
        windowHours,
        listing?.amount_atomic ?? undefined,
      );
    } catch {
      flags.push("onchain_scan_failed");
    }
  }

  const liveness = livenessPoints(probe, flags);
  const diversity = diversityPoints(stats, flags);
  const revenue = revenuePoints(listing, stats, flags);
  const age = agePoints(listing, flags);

  const score = liveness + diversity + revenue.points + age.points;

  return {
    resource,
    recipient,
    serviceName: listing?.service_name ?? null,
    score,
    grade: gradeFor(score),
    components: {
      liveness: { points: liveness, max: 30, probe },
      payerDiversity: {
        points: diversity,
        max: 30,
        uniquePayers: stats?.uniquePayers ?? null,
        topPayerShare: stats?.topPayerShare ?? null,
      },
      revenueVerification: {
        points: revenue.points,
        max: 25,
        reportedCalls30d: listing?.reported_calls_30d ?? null,
        onchainPriceMatchingTransfers: stats?.priceMatchingCount ?? null,
        onchainTotalUsdcIn: stats?.totalUsdcIn ?? null,
        windowHoursCovered: stats?.window.hoursCovered ?? null,
        ratioEstimate: revenue.ratio === null ? null : Math.round(revenue.ratio * 1000) / 1000,
      },
      listingAge: {
        points: age.points,
        max: 15,
        firstSeen: listing?.first_seen ?? null,
        daysTracked: age.daysTracked,
      },
    },
    flags,
    onchainWindow: stats?.window ?? null,
    methodology:
      "Score = liveness probe (30) + on-chain payer diversity (30) + reported-vs-verified revenue (25) + catalog listing age (15). On-chain data: USDC Transfer logs on Base mainnet. Coverage may be partial; see onchainWindow.",
    disclaimer:
      "Verifiable on-chain data and heuristics only. Not financial advice. A high score is not an endorsement.",
  };
}
