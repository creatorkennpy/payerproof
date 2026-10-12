/**
 * Testa o fluxo x402 completo como COMPRADOR contra o proprio servidor.
 *
 * Pre-requisitos:
 *  - Servidor rodando (npm run dev)
 *  - BUYER_PRIVATE_KEY no .env: carteira de teste com USDC
 *      - testnet (NETWORK=base-sepolia): USDC de faucet https://faucet.circle.com (Base Sepolia)
 *      - mainnet (NETWORK=base): USDC real (centavos bastam)
 *
 * Uso: npm run test:buyer
 */
import "dotenv/config";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { createSigner } from "x402/types";

const pk = process.env.BUYER_PRIVATE_KEY;
const target = process.env.BUYER_TARGET_URL ?? "http://localhost:3000";
const network = (process.env.NETWORK ?? "base-sepolia") as "base" | "base-sepolia";

if (!pk || !pk.startsWith("0x")) {
  console.error("Defina BUYER_PRIVATE_KEY no .env (carteira de TESTE com USDC).");
  process.exit(1);
}

async function main() {
  // 1) Rota gratuita
  const ping = await fetch(`${target}/ping`);
  console.log(`GET /ping -> ${ping.status}`);
  console.log(JSON.stringify(await ping.json(), null, 2));

  // 2) Rota paga sem pagamento (esperado: 402)
  const noPay = await fetch(`${target}/revenue?address=0x7284D41b5b852F2bd4c99bDf95043D84452d299C`);
  console.log(`\nGET /revenue sem pagamento -> ${noPay.status} (esperado: 402)`);

  // 3) Rota paga COM pagamento automatico via x402-fetch
  const signer = await createSigner(network, pk as `0x${string}`);
  const fetchWithPay = wrapFetchWithPayment(globalThis.fetch, signer);

  console.log(`\nPagando e chamando GET /revenue (rede: ${network})...`);
  const paid = await fetchWithPay(
    `${target}/revenue?address=0x7284D41b5b852F2bd4c99bDf95043D84452d299C&window=24`,
  );
  console.log(`-> ${paid.status}`);
  const body = await paid.json();
  console.log(JSON.stringify(body, null, 2));

  const receipt = paid.headers.get("x-payment-response");
  if (receipt) {
    console.log("\nRecibo de pagamento (liquidado on-chain):");
    console.log(JSON.stringify(decodeXPaymentResponse(receipt), null, 2));
  }
}

main().catch((err) => {
  console.error("Teste falhou:", err);
  process.exit(1);
});
