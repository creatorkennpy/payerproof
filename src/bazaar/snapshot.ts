/**
 * Snapshot do catalogo de descoberta do Bazaar (keyless).
 * Deduplica por (recipient, resource) e grava listagem corrente + historico diario.
 */
import { db, todayUtc } from "../db.js";
import { config, BAZAAR_DISCOVERY_URL, USDC_BASE } from "../config.js";

interface DiscoveryAccept {
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  scheme?: string;
}

interface DiscoveryItem {
  accepts?: DiscoveryAccept[];
  description?: string;
  serviceName?: string;
  lastUpdated?: string;
  resource?: string;
  quality?: {
    l30DaysTotalCalls?: number;
    l30DaysUniquePayers?: number;
    lastCalledAt?: string;
  };
}

interface DiscoveryResponse {
  items: DiscoveryItem[];
  pagination?: { limit: number; offset: number; total: number };
}

const upsertListing = db.prepare(`
  INSERT INTO listings (
    recipient, resource, network, asset, amount_atomic, price_usd,
    service_name, description, first_seen, last_seen, last_updated,
    reported_calls_30d, reported_payers_30d, last_called_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(recipient, resource) DO UPDATE SET
    network             = excluded.network,
    asset               = excluded.asset,
    amount_atomic       = excluded.amount_atomic,
    price_usd           = excluded.price_usd,
    service_name        = excluded.service_name,
    description         = excluded.description,
    last_seen           = excluded.last_seen,
    last_updated        = excluded.last_updated,
    reported_calls_30d  = excluded.reported_calls_30d,
    reported_payers_30d = excluded.reported_payers_30d,
    last_called_at      = excluded.last_called_at
`);

const upsertHistory = db.prepare(`
  INSERT OR REPLACE INTO listing_history
    (recipient, resource, snapshot_date, reported_calls_30d, reported_payers_30d, price_usd)
  VALUES (?, ?, ?, ?, ?, ?)
`);

/** Escolhe o "accept" mais relevante: USDC na Base mainnet primeiro. */
function pickAccept(accepts: DiscoveryAccept[] | undefined): DiscoveryAccept | undefined {
  if (!accepts || accepts.length === 0) return undefined;
  return (
    accepts.find(
      (a) =>
        a.network === "eip155:8453" &&
        (a.asset ?? "").toLowerCase() === USDC_BASE.toLowerCase(),
    ) ??
    accepts.find((a) => a.network === "eip155:8453") ??
    accepts[0]
  );
}

export async function runSnapshot(log: (msg: string) => void = console.log): Promise<{
  itemsSeen: number;
  listingsUpserted: number;
}> {
  const started = new Date().toISOString();
  const date = todayUtc();
  const limit = config.bazaarPageLimit;
  let offset = 0;
  let total = Infinity;
  let itemsSeen = 0;
  let upserted = 0;
  const seen = new Set<string>();

  while (offset < total) {
    const url = `${BAZAAR_DISCOVERY_URL}?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      // Backoff simples em rate limit / erro transitorio
      if (res.status === 429 || res.status >= 500) {
        log(`HTTP ${res.status} em offset=${offset}, aguardando 10s...`);
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      throw new Error(`API de descoberta retornou HTTP ${res.status} em ${url}`);
    }
    const body = (await res.json()) as DiscoveryResponse;
    const items = body.items ?? [];
    total = body.pagination?.total ?? offset + items.length;
    const pageSize = body.pagination?.limit ?? items.length;

    for (const item of items) {
      itemsSeen += 1;
      const accept = pickAccept(item.accepts);
      const recipient = (accept?.payTo ?? "").toLowerCase();
      const resource = item.resource ?? "";
      if (!recipient || !resource) continue;

      const key = `${recipient}|${resource}`;
      if (seen.has(key)) continue; // deduplicacao (mesmo recurso listado em varias redes)
      seen.add(key);

      const amountAtomic = accept?.amount ?? accept?.maxAmountRequired ?? null;
      const isUsdc = (accept?.asset ?? "").toLowerCase() === USDC_BASE.toLowerCase();
      const priceUsd =
        amountAtomic !== null && isUsdc ? Number(amountAtomic) / 1e6 : null;

      upsertListing.run(
        recipient,
        resource,
        accept?.network ?? null,
        accept?.asset ?? null,
        amountAtomic,
        priceUsd,
        item.serviceName ?? null,
        item.description ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
        item.lastUpdated ?? null,
        item.quality?.l30DaysTotalCalls ?? null,
        item.quality?.l30DaysUniquePayers ?? null,
        item.quality?.lastCalledAt ?? null,
      );
      upsertHistory.run(
        recipient,
        resource,
        date,
        item.quality?.l30DaysTotalCalls ?? null,
        item.quality?.l30DaysUniquePayers ?? null,
        priceUsd,
      );
      upserted += 1;
    }

    offset += pageSize;
    if (config.bazaarMaxItems > 0 && itemsSeen >= config.bazaarMaxItems) break;
    if (items.length === 0) break;
    if (offset % 2000 < pageSize) log(`...${offset}/${total} itens`);
  }

  db.prepare(
    `INSERT OR REPLACE INTO snapshots (snapshot_date, items, started_at, finished_at)
     VALUES (?, ?, ?, ?)`,
  ).run(date, itemsSeen, started, new Date().toISOString());

  log(`Snapshot ${date}: ${itemsSeen} itens vistos, ${upserted} listagens gravadas.`);
  return { itemsSeen, listingsUpserted: upserted };
}
