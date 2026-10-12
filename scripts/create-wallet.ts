/**
 * Gera uma carteira EVM nova (para RECEBER os pagamentos na Base).
 * A chave privada e exibida UMA vez - guarde offline (gerenciador de senhas).
 * Apenas o ENDERECO vai para o .env (PAY_TO). A chave NUNCA entra no servidor.
 *
 * Uso: npm run wallet
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

console.log("=".repeat(64));
console.log("NOVA CARTEIRA GERADA (Base / EVM)");
console.log("=".repeat(64));
console.log(`Endereco (PAY_TO, vai no .env):\n  ${account.address}`);
console.log("");
console.log(`Chave privada (GUARDE OFFLINE, NUNCA compartilhe, NUNCA suba pro servidor):\n  ${pk}`);
console.log("=".repeat(64));
console.log("Importe a chave em uma carteira (Rabby/MetaMask) para sacar o USDC recebido.");
