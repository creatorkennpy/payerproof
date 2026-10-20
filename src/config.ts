import "dotenv/config";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
}

export const config = {
  port: Number(env("PORT", "3000")),
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:3000"),

  /** "base" (mainnet) ou "base-sepolia" (testnet) */
  network: env("NETWORK", "base-sepolia") as "base" | "base-sepolia",
  payTo: env("PAY_TO", "0x0000000000000000000000000000000000000000") as `0x${string}`,

  cdpApiKeyId: process.env.CDP_API_KEY_ID ?? "",
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET ?? "",

  /** Lista de RPCs da Base mainnet separados por virgula (fallback automatico). */
  baseRpcUrls: env(
    "BASE_RPC_URL",
    "https://base-rpc.publicnode.com,https://base.drpc.org,https://mainnet.base.org",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  /**
   * Chave da API do Etherscan (gratuita, https://etherscan.io/apis - funciona
   * na Base via API v2). OPCIONAL, mas recomendada: sem ela, os RPCs publicos
   * gratuitos so servem logs das ultimas ~3-5 horas e o historico de 30 dias
   * e construido aos poucos pelo cache incremental.
   */
  etherscanApiKey: process.env.ETHERSCAN_API_KEY ?? "",
  scanMaxBlocksPerRequest: Number(env("SCAN_MAX_BLOCKS_PER_REQUEST", "200000")),

  dbPath: env("DB_PATH", "./data/x402rep.db"),

  bazaarPageLimit: Number(env("BAZAAR_PAGE_LIMIT", "100")),
  bazaarMaxItems: Number(env("BAZAAR_MAX_ITEMS", "0")),

  /** Snapshot diario no proprio processo da API (evita segundo servico no Railway). */
  snapshotEnabled: env("SNAPSHOT_ENABLED", "true") !== "false",
  /** Hora UTC do snapshot diario (0-23). Padrao: 3 = 00:00 em Brasilia. */
  snapshotHourUtc: Number(env("SNAPSHOT_HOUR_UTC", "3")),
};

/** USDC na Base mainnet */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
/** Blocos por hora na Base (bloco a cada 2s) */
export const BLOCKS_PER_HOUR = 1800;
/** API de descoberta do Bazaar (keyless) */
export const BAZAAR_DISCOVERY_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

export function assertMainnetReady(): void {
  if (config.network === "base") {
    if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
      throw new Error(
        "NETWORK=base exige CDP_API_KEY_ID e CDP_API_KEY_SECRET (crie em https://portal.cdp.coinbase.com)",
      );
    }
    if (/^0x0{40}$/i.test(config.payTo)) {
      throw new Error("NETWORK=base exige um PAY_TO real (gere com: npm run wallet)");
    }
  }
}
