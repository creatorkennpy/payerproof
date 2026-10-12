/**
 * Gera o relatorio semanal "Estado do Bazaar" em Markdown (isca de conteudo
 * para X/comunidades). Usa apenas dados dos snapshots locais.
 * Uso: npm run report
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db, todayUtc } from "../db.js";

interface Row {
  [k: string]: unknown;
}

function q<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

const date = todayUtc();

const totals = q<{ n: number; sellers: number }>(
  `SELECT COUNT(*) AS n, COUNT(DISTINCT recipient) AS sellers FROM listings`,
)[0];

const withCalls = q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM listings WHERE reported_calls_30d > 0`,
)[0];

const priceBands = q<{ band: string; n: number }>(`
  SELECT CASE
    WHEN price_usd IS NULL  THEN 'sem preco em USDC'
    WHEN price_usd <= 0.005 THEN 'micro (<= $0.005)'
    WHEN price_usd <= 0.05  THEN 'barato ($0.005 - $0.05)'
    WHEN price_usd <= 0.5   THEN 'medio ($0.05 - $0.50)'
    WHEN price_usd <= 5     THEN 'premium ($0.50 - $5)'
    ELSE 'alto (> $5)'
  END AS band, COUNT(*) AS n
  FROM listings GROUP BY band ORDER BY n DESC
`);

const topByCalls = q<{
  service_name: string | null;
  resource: string;
  price_usd: number | null;
  reported_calls_30d: number;
  reported_payers_30d: number | null;
}>(`
  SELECT service_name, resource, price_usd, reported_calls_30d, reported_payers_30d
  FROM listings WHERE reported_calls_30d IS NOT NULL
  ORDER BY reported_calls_30d DESC LIMIT 15
`);

const newToday = q<{ n: number }>(
  `SELECT COUNT(*) AS n FROM listings WHERE substr(first_seen, 1, 10) = ?`,
  date,
)[0];

const snapshotDays = q<{ n: number }>(`SELECT COUNT(*) AS n FROM snapshots`)[0];

const suspicious = q<{
  service_name: string | null;
  resource: string;
  reported_calls_30d: number;
  reported_payers_30d: number | null;
}>(`
  SELECT service_name, resource, reported_calls_30d, reported_payers_30d
  FROM listings
  WHERE reported_calls_30d > 1000
    AND (reported_payers_30d IS NULL OR reported_payers_30d <= 3)
  ORDER BY reported_calls_30d DESC LIMIT 10
`);

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : n.toLocaleString("pt-BR");

const lines: string[] = [];
lines.push(`# Estado do Bazaar x402 - ${date}`);
lines.push("");
lines.push(
  `> Dados do catalogo publico de descoberta do Bazaar (Coinbase CDP), coletados por snapshot ` +
    `diario. Contadores de chamadas/pagadores sao auto-reportados pelo catalogo; ` +
    `a verificacao on-chain e feita sob demanda pela nossa API.`,
);
lines.push("");
lines.push(`## Visao geral`);
lines.push(`- Listagens rastreadas: **${fmt(totals.n)}** (${fmt(totals.sellers)} vendedores unicos)`);
lines.push(`- Listagens com pelo menos 1 chamada paga em 30d: **${fmt(withCalls.n)}** ` +
  `(${totals.n > 0 ? ((withCalls.n / totals.n) * 100).toFixed(1) : "0"}% do catalogo)`);
lines.push(`- Novas listagens vistas hoje: **${fmt(newToday.n)}**`);
lines.push(`- Dias de historico acumulado: ${fmt(snapshotDays.n)}`);
lines.push("");
lines.push(`## Distribuicao de precos`);
lines.push(`| Faixa | Listagens |`);
lines.push(`| --- | --- |`);
for (const b of priceBands) lines.push(`| ${b.band} | ${fmt(b.n)} |`);
lines.push("");
lines.push(`## Top 15 por chamadas reportadas (30d)`);
lines.push(`| Servico | Preco | Chamadas 30d | Pagadores 30d |`);
lines.push(`| --- | --- | --- | --- |`);
for (const t of topByCalls) {
  const name = t.service_name ?? new URL(t.resource).hostname;
  const price = t.price_usd === null ? "-" : `$${t.price_usd}`;
  lines.push(`| ${name} | ${price} | ${fmt(t.reported_calls_30d)} | ${fmt(t.reported_payers_30d)} |`);
}
lines.push("");
if (suspicious.length > 0) {
  lines.push(`## Contadores que merecem desconfianca`);
  lines.push(`Listagens com mais de 1.000 chamadas reportadas e 3 ou menos pagadores unicos:`);
  lines.push(`| Servico | Chamadas 30d | Pagadores 30d |`);
  lines.push(`| --- | --- | --- |`);
  for (const s of suspicious) {
    const name = s.service_name ?? new URL(s.resource).hostname;
    lines.push(`| ${name} | ${fmt(s.reported_calls_30d)} | ${fmt(s.reported_payers_30d)} |`);
  }
  lines.push("");
}
lines.push(`---`);
lines.push(
  `Quer o detalhe verificado on-chain de qualquer servico? ` +
    `Payerproof: GET /score, pago via x402 ($0.02 USDC na Base).`,
);
lines.push("");

const outDir = resolve("./reports");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `estado-do-bazaar-${date}.md`);
writeFileSync(outFile, lines.join("\n"), "utf8");
console.log(`Relatorio gravado em ${outFile}`);
