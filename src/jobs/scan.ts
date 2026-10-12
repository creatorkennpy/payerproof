/**
 * Varredura on-chain manual de um endereco vendedor.
 * Uso: npm run scan -- 0xEndereco [horas]
 */
import { isAddress, type Address } from "viem";
import { getRevenueStats } from "../onchain/usdc.js";

const [address, hoursArg] = process.argv.slice(2);
if (!address || !isAddress(address)) {
  console.error("Uso: npm run scan -- 0xEndereco [horas=24]");
  process.exit(1);
}
const hours = Math.min(Number(hoursArg ?? 24) || 24, 720);

getRevenueStats(address as Address, hours)
  .then((stats) => console.log(JSON.stringify(stats, null, 2)))
  .catch((err) => {
    console.error("Falhou:", err);
    process.exit(1);
  });
