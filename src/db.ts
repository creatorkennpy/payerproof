import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";

const dbFile = resolve(config.dbPath);
mkdirSync(dirname(dbFile), { recursive: true });

export const db = new DatabaseSync(dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 10000;

CREATE TABLE IF NOT EXISTS listings (
  recipient           TEXT NOT NULL,
  resource            TEXT NOT NULL,
  network             TEXT,
  asset               TEXT,
  amount_atomic       TEXT,
  price_usd           REAL,
  service_name        TEXT,
  description         TEXT,
  first_seen          TEXT NOT NULL,
  last_seen           TEXT NOT NULL,
  last_updated        TEXT,
  reported_calls_30d  INTEGER,
  reported_payers_30d INTEGER,
  last_called_at      TEXT,
  PRIMARY KEY (recipient, resource)
);
CREATE INDEX IF NOT EXISTS idx_listings_resource ON listings(resource);

CREATE TABLE IF NOT EXISTS listing_history (
  recipient           TEXT NOT NULL,
  resource            TEXT NOT NULL,
  snapshot_date       TEXT NOT NULL,
  reported_calls_30d  INTEGER,
  reported_payers_30d INTEGER,
  price_usd           REAL,
  PRIMARY KEY (recipient, resource, snapshot_date)
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_date TEXT PRIMARY KEY,
  items         INTEGER,
  started_at    TEXT,
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS transfers (
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  to_addr      TEXT NOT NULL,
  from_addr    TEXT NOT NULL,
  value_atomic TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_time   INTEGER,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_addr, block_number);

CREATE TABLE IF NOT EXISTS scan_state (
  address      TEXT PRIMARY KEY,
  oldest_block INTEGER NOT NULL,
  newest_block INTEGER NOT NULL,
  updated_at   TEXT NOT NULL
);
`);

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
