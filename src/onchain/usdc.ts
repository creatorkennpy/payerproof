/**
 * Coletor de transferencias USDC na Base mainnet.
 *
 * Estrategia: varre logs de Transfer(to = vendedor) em blocos (chunks) via RPC
 * gratuito, grava tudo no SQLite e mantem em scan_state a faixa continua de
 * blocos ja coberta por endereco. Chamadas repetidas so buscam o que falta.
 */
import { createPublicClient, fallback, http, parseAbiItem, type Address } from "viem";
import { base } from "viem/chains";
import { db } from "../db.js";
import { config, USDC_BASE, BLOCKS_PER_HOUR } from "../config.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/** Cliente generico (getBlock etc.): fallback simples resolve. */
export const publicClient = createPublicClient({
  chain: base,
  transport: fallback(
    config.baseRpcUrls.map((url) => http(url, { retryCount: 1, timeout: 20_000 })),
    { rank: false },
  ),
});

/**
 * Para eth_getLogs o fallback do viem nao serve: ele mascara QUAL RPC falhou
 * e POR QUE (ex.: um nega historico, outro esta rate-limitado). Mantemos um
 * cliente por RPC e classificamos o erro de cada um.
 */
const logClients = config.baseRpcUrls.map((url) => ({
  url,
  client: createPublicClient({
    chain: base,
    transport: http(url, { retryCount: 0, timeout: 20_000 }),
  }),
}));

class HistoryUnavailableError extends Error {}
class AllRateLimitedError extends Error {}

type GetLogsParams = {
  fromBlock: bigint;
  toBlock: bigint;
  to?: Address;
};

/** Tenta cada RPC em ordem; distingue "sem historico" de "rate limit". */
async function getLogsRobust(params: GetLogsParams) {
  let sawRateLimit = false;
  let lastErr: unknown = null;
  for (const { client } of logClients) {
    try {
      return await client.getLogs({
        address: USDC_BASE,
        event: transferEvent,
        args: params.to ? { to: params.to } : undefined,
        fromBlock: params.fromBlock,
        toBlock: params.toBlock,
      });
    } catch (err) {
      lastErr = err;
      if (isRateLimit(err)) sawRateLimit = true;
      // qualquer outro erro (historico, range, 400): tenta o proximo RPC
    }
  }
  if (sawRateLimit) throw new AllRateLimitedError("todos os RPCs rate-limitados ou sem a faixa");
  if (isHistoryUnavailable(lastErr)) {
    throw new HistoryUnavailableError("nenhum RPC serve esta faixa de blocos");
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Erros de rate limit: espera e tenta de novo em vez de reduzir o chunk. */
function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("request limit") ||
    msg.includes("rate limit") ||
    msg.includes("too many request") ||
    msg.includes("429") ||
    msg.includes("-32011") ||
    msg.includes("-32005")
  );
}

/** Erros de "historico indisponivel" nos RPCs gratuitos (no de poda/archive). */
function isHistoryUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("archive") ||
    msg.includes("personal token") ||
    msg.includes("invalid parameters") ||
    msg.includes("ranges over")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ScanState {
  oldest_block: number;
  newest_block: number;
}

function getScanState(address: string): ScanState | undefined {
  return db
    .prepare("SELECT oldest_block, newest_block FROM scan_state WHERE address = ?")
    .get(address.toLowerCase()) as ScanState | undefined;
}

function saveScanState(address: string, oldest: number, newest: number): void {
  db.prepare(
    `INSERT INTO scan_state (address, oldest_block, newest_block, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       oldest_block = excluded.oldest_block,
       newest_block = excluded.newest_block,
       updated_at   = excluded.updated_at`,
  ).run(address.toLowerCase(), oldest, newest, new Date().toISOString());
}

const insertTransfer = db.prepare(
  `INSERT OR IGNORE INTO transfers
     (tx_hash, log_index, to_addr, from_addr, value_atomic, block_number, block_time)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

/**
 * Varre do bloco mais NOVO para o mais ANTIGO, em chunks adaptativos, gravando
 * no SQLite. Para graciosamente onde os RPCs gratuitos deixam de servir
 * historico e retorna o bloco mais antigo efetivamente coberto (cobertura
 * contigua de `oldestCovered` ate `fromNewest`).
 */
async function scanDown(
  address: Address,
  fromNewest: bigint,
  toOldest: bigint,
  latestBlock: bigint,
  latestTimestamp: bigint,
): Promise<bigint> {
  // 3000 blocos (~100 min na Base) por chamada: fica abaixo dos limites de
  // resultados dos RPCs publicos mesmo para enderecos muito movimentados.
  const MAX_CHUNK = 3_000n;
  let chunk = MAX_CHUNK;
  let endCursor = fromNewest;
  let rateLimitWaits = 0;
  while (endCursor >= toOldest) {
    const start = endCursor - chunk + 1n < toOldest ? toOldest : endCursor - chunk + 1n;
    try {
      const logs = await getLogsRobust({ fromBlock: start, toBlock: endCursor, to: address });
      for (const log of logs) {
        // Tempo estimado pelo numero do bloco (Base: 1 bloco a cada 2s).
        const estTime = Number(latestTimestamp - (latestBlock - log.blockNumber) * 2n);
        insertTransfer.run(
          log.transactionHash,
          Number(log.logIndex),
          address.toLowerCase(),
          (log.args.from as string).toLowerCase(),
          (log.args.value as bigint).toString(),
          Number(log.blockNumber),
          estTime,
        );
      }
      endCursor = start - 1n;
      rateLimitWaits = 0;
      // Aumenta o chunk devagar se o RPC esta aguentando.
      if (chunk < MAX_CHUNK) chunk = chunk * 2n;
    } catch (err) {
      if (err instanceof AllRateLimitedError) {
        // Rate limit: espera com backoff e tenta o MESMO chunk de novo.
        rateLimitWaits += 1;
        if (rateLimitWaits > 4) return endCursor + 1n; // devolve o que conseguiu
        await sleep(1500 * rateLimitWaits);
        continue;
      }
      if (err instanceof HistoryUnavailableError) {
        // Chegamos ao limite de historico dos nos gratuitos: para aqui.
        return endCursor + 1n;
      }
      // RPC recusou a faixa (limite de range/resultados): reduz o chunk e tenta de novo.
      if (chunk > 500n) {
        chunk = chunk / 2n;
        continue;
      }
      return endCursor + 1n;
    }
  }
  return toOldest;
}

// ===== Caminho alternativo: API do Etherscan (v2, chainid 8453) =====

interface EtherscanTokenTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timeStamp: string;
  transactionIndex: string;
}

/**
 * Busca transferencias USDC recebidas via API do Etherscan (ordem desc),
 * caminhando por paginas de 1000. Retorna o bloco mais antigo alcancado.
 */
async function scanViaEtherscan(
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
  maxPages = 25,
): Promise<bigint> {
  let endBlock = toBlock;
  let oldestReached = toBlock;
  for (let page = 0; page < maxPages; page++) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=8453&module=account&action=tokentx` +
      `&contractaddress=${USDC_BASE}&address=${address}` +
      `&startblock=${fromBlock}&endblock=${endBlock}` +
      `&page=1&offset=1000&sort=desc&apikey=${config.etherscanApiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);
    const body = (await res.json()) as { status: string; message: string; result: unknown };
    if (body.status !== "1") {
      if (body.message === "No transactions found") return fromBlock;
      // Rate limit do Etherscan (5/s no plano gratuito): espera e repete a pagina.
      if (String(body.result).toLowerCase().includes("rate limit")) {
        await sleep(1200);
        page -= 1;
        continue;
      }
      throw new Error(`Etherscan: ${body.message} ${String(body.result).slice(0, 120)}`);
    }
    const txs = body.result as EtherscanTokenTx[];
    for (const tx of txs) {
      if (tx.to.toLowerCase() !== address.toLowerCase()) continue; // tokentx inclui saidas
      // Nota: tokentx nao expoe logIndex; usamos transactionIndex. Se uma mesma
      // transacao tiver 2+ transferencias USDC para o mesmo endereco (raro),
      // apenas uma e contada.
      insertTransfer.run(
        tx.hash,
        Number(tx.transactionIndex),
        address.toLowerCase(),
        tx.from.toLowerCase(),
        tx.value,
        Number(tx.blockNumber),
        Number(tx.timeStamp),
      );
    }
    if (txs.length > 0) {
      oldestReached = BigInt(txs[txs.length - 1].blockNumber);
    }
    if (txs.length < 1000) return fromBlock; // acabou o historico na janela
    endBlock = oldestReached - 1n;
    if (endBlock < fromBlock) return fromBlock;
    await sleep(250); // cortesia com o rate limit gratuito
  }
  return oldestReached; // orcamento de paginas esgotado: cobertura parcial
}

export interface Coverage {
  fromBlock: number;
  toBlock: number;
  /** Horas realmente cobertas pela varredura (pode ser menos que o pedido). */
  hoursCovered: number;
  /** true se a janela pedida foi coberta por completo. */
  complete: boolean;
  /** Fonte dos dados on-chain desta cobertura. */
  source: "rpc" | "etherscan";
  /** Presente quando o RPC gratuito limita o historico disponivel. */
  note?: string;
}

/**
 * Garante cobertura de logs para `address` na janela de `windowHours` ate agora,
 * limitada a `maxBlocks` blocos novos por chamada (orcamento de RPC).
 */
export async function ensureCoverage(
  address: Address,
  windowHours: number,
  maxBlocks: number = config.scanMaxBlocksPerRequest,
): Promise<Coverage> {
  const latest = await publicClient.getBlock();
  const latestBlock = latest.number;
  const latestTimestamp = latest.timestamp;

  const targetFrom = latestBlock - BigInt(Math.ceil(windowHours * BLOCKS_PER_HOUR));
  const state = getScanState(address);
  const useEtherscan = config.etherscanApiKey !== "";

  let oldest: bigint;
  let newest: bigint;
  let note: string | undefined;

  if (useEtherscan) {
    // Caminho Etherscan: historico profundo em poucas requisicoes.
    if (!state) {
      oldest = await scanViaEtherscan(address, targetFrom, latestBlock);
      newest = latestBlock;
    } else {
      oldest = BigInt(state.oldest_block);
      newest = BigInt(state.newest_block);
      if (newest < latestBlock) {
        await scanViaEtherscan(address, newest + 1n, latestBlock);
        newest = latestBlock;
      }
      if (oldest > targetFrom) {
        oldest = await scanViaEtherscan(address, targetFrom, oldest - 1n);
      }
    }
  } else {
    // Caminho RPC gratuito: varre do presente para tras e para onde o historico
    // acaba (nos gratuitos servem poucas horas de logs).
    const budget = BigInt(Math.max(maxBlocks, 1000));

    if (!state) {
      const bound = targetFrom > latestBlock - budget ? targetFrom : latestBlock - budget;
      oldest = await scanDown(address, latestBlock, bound, latestBlock, latestTimestamp);
      newest = latestBlock;
    } else {
      oldest = BigInt(state.oldest_block);
      newest = BigInt(state.newest_block);

      // 1) Frente: blocos novos desde a ultima varredura (do presente para tras).
      if (newest < latestBlock) {
        const covered = await scanDown(
          address,
          latestBlock,
          newest + 1n,
          latestBlock,
          latestTimestamp,
        );
        // Se nao alcancou newest+1 (gap), a faixa contigua recomeca em `covered`.
        if (covered > newest + 1n) oldest = covered;
        newest = latestBlock;
      }

      // 2) Tras: estende em direcao ao inicio da janela pedida (dentro do possivel).
      if (oldest > targetFrom) {
        const bound = targetFrom > oldest - budget ? targetFrom : oldest - budget;
        const covered = await scanDown(address, oldest - 1n, bound, latestBlock, latestTimestamp);
        if (covered < oldest) oldest = covered;
      }
    }

    if (oldest > targetFrom) {
      note =
        "RPCs gratuitos limitam o historico de logs a poucas horas; a cobertura cresce " +
        "de forma incremental a cada chamada (cache). Configure ETHERSCAN_API_KEY " +
        "(gratuita) ou um RPC archive para historico completo imediato.";
    }
  }

  saveScanState(address, Number(oldest), Number(newest));

  const effectiveFrom = oldest > targetFrom ? oldest : targetFrom;
  const hoursCovered = Number(latestBlock - effectiveFrom) / BLOCKS_PER_HOUR;
  return {
    fromBlock: Number(effectiveFrom),
    toBlock: Number(latestBlock),
    hoursCovered: Math.round(hoursCovered * 10) / 10,
    complete: oldest <= targetFrom,
    source: useEtherscan ? "etherscan" : "rpc",
    ...(note ? { note } : {}),
  };
}

export interface RevenueStats {
  address: string;
  window: {
    hours: number;
    fromBlock: number;
    toBlock: number;
    hoursCovered: number;
    complete: boolean;
    source: "rpc" | "etherscan";
    note?: string;
  };
  totalUsdcIn: number;
  transferCount: number;
  uniquePayers: number;
  topPayerShare: number | null;
  topPayers: { address: string; usdc: number; transfers: number }[];
  largestTransfers: { from: string; usdc: number; blockNumber: number; txHash: string }[];
  /** Transferencias cujo valor bate exatamente com `priceAtomic` (se informado). */
  priceMatchingCount: number | null;
}

/** Calcula estatisticas a partir do cache local (chame ensureCoverage antes). */
export function computeStats(
  address: Address,
  coverage: Coverage,
  windowHours: number,
  priceAtomic?: string,
): RevenueStats {
  const rows = db
    .prepare(
      `SELECT tx_hash, from_addr, value_atomic, block_number
       FROM transfers
       WHERE to_addr = ? AND block_number >= ? AND block_number <= ?`,
    )
    .all(address.toLowerCase(), coverage.fromBlock, coverage.toBlock) as {
    tx_hash: string;
    from_addr: string;
    value_atomic: string;
    block_number: number;
  }[];

  let total = 0n;
  const byPayer = new Map<string, { value: bigint; count: number }>();
  let priceMatching = 0;
  const priceAtomicBig = priceAtomic ? BigInt(priceAtomic) : null;

  for (const r of rows) {
    const v = BigInt(r.value_atomic);
    total += v;
    const p = byPayer.get(r.from_addr) ?? { value: 0n, count: 0 };
    p.value += v;
    p.count += 1;
    byPayer.set(r.from_addr, p);
    if (priceAtomicBig !== null && v === priceAtomicBig) priceMatching += 1;
  }

  const usd = (v: bigint) => Number(v) / 1e6;
  const payersSorted = [...byPayer.entries()].sort((a, b) => (b[1].value > a[1].value ? 1 : -1));
  const topPayerShare =
    total > 0n && payersSorted.length > 0 ? Number(payersSorted[0][1].value) / Number(total) : null;

  const largest = [...rows]
    .sort((a, b) => (BigInt(b.value_atomic) > BigInt(a.value_atomic) ? 1 : -1))
    .slice(0, 5)
    .map((r) => ({
      from: r.from_addr,
      usdc: usd(BigInt(r.value_atomic)),
      blockNumber: r.block_number,
      txHash: r.tx_hash,
    }));

  return {
    address: address.toLowerCase(),
    window: {
      hours: windowHours,
      fromBlock: coverage.fromBlock,
      toBlock: coverage.toBlock,
      hoursCovered: coverage.hoursCovered,
      complete: coverage.complete,
      source: coverage.source,
      ...(coverage.note ? { note: coverage.note } : {}),
    },
    totalUsdcIn: Math.round(usd(total) * 1e6) / 1e6,
    transferCount: rows.length,
    uniquePayers: byPayer.size,
    topPayerShare: topPayerShare === null ? null : Math.round(topPayerShare * 1000) / 1000,
    topPayers: payersSorted.slice(0, 5).map(([addr, p]) => ({
      address: addr,
      usdc: Math.round(usd(p.value) * 1e6) / 1e6,
      transfers: p.count,
    })),
    largestTransfers: largest,
    priceMatchingCount: priceAtomicBig === null ? null : priceMatching,
  };
}

export async function getRevenueStats(
  address: Address,
  windowHours: number,
  priceAtomic?: string,
): Promise<RevenueStats> {
  const coverage = await ensureCoverage(address, windowHours);
  return computeStats(address, coverage, windowHours, priceAtomic);
}
