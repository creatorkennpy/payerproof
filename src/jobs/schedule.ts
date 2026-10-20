/**
 * Agenda o snapshot diario DENTRO do processo da API.
 * Assim nao precisa de segundo servico nem de volume compartilhado no Railway.
 */
import { db } from "../db.js";
import { config } from "../config.js";
import { runSnapshot } from "../bazaar/snapshot.js";

let running = false;

function listingCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number };
  return row.n;
}

function msUntilNextHourUtc(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function snapshotOnce(reason: string): Promise<void> {
  if (running) {
    console.log(`snapshot pulado (${reason}): ja em andamento`);
    return;
  }
  running = true;
  const started = Date.now();
  console.log(`snapshot iniciado (${reason})`);
  try {
    const { itemsSeen, listingsUpserted } = await runSnapshot();
    console.log(
      `snapshot OK (${reason}) em ${Math.round((Date.now() - started) / 1000)}s - ${itemsSeen} itens, ${listingsUpserted} listagens.`,
    );
  } catch (err) {
    console.error(`snapshot falhou (${reason}):`, err);
  } finally {
    running = false;
  }
}

function armDaily(): void {
  const wait = msUntilNextHourUtc(config.snapshotHourUtc);
  const when = new Date(Date.now() + wait).toISOString();
  console.log(`proximo snapshot diario as ${when} (hora UTC ${config.snapshotHourUtc})`);
  setTimeout(() => {
    void snapshotOnce("diario").finally(() => armDaily());
  }, wait);
}

export function startSnapshotScheduler(): void {
  if (!config.snapshotEnabled) {
    console.log("snapshot interno desligado (SNAPSHOT_ENABLED=false)");
    return;
  }
  armDaily();
  if (listingCount() === 0) {
    void snapshotOnce("catalogo vazio no boot");
  }
}
