# Payerproof

API paga por requisição (protocolo **x402**, USDC na **Base**) que vende **pontuação de confiança de serviços x402** listados no Bazaar da Coinbase. A pergunta que ela responde para agentes de IA (e humanos) antes de gastarem dinheiro em um endpoint desconhecido: **"este serviço é legítimo?"**

A resposta é computada a partir de dados que não mentem:

- **Receita on-chain verificada** (logs de `Transfer` de USDC na Base) vs. contadores auto-reportados no catálogo → detecta contadores inflados
- **Diversidade de pagadores** e concentração do maior pagador → detecta auto-negociação ("self-dealing")
- **Sonda de prova de vida** (o endpoint responde 402 com requisitos coerentes?)
- **Idade da listagem** nos snapshots diários do catálogo

## Endpoints

| Rota | Preço | O que faz |
| --- | --- | --- |
| `GET /score?resource=<url>` | $0.02 | Nota 0–100 (A–F) com breakdown e flags (`inflated_counter`, `self_dealing_suspected`, `dead_endpoint`...) |
| `GET /revenue?address=0x...` | $0.01 | Estatísticas de receita USDC verificada de qualquer endereço vendedor |
| `GET /ping` | grátis | Teste de integração |
| `GET /` | grátis | Documentação (página estática em `public/`) |

A receita cai **direto na sua carteira** em USDC. Sem Stripe, sem PIX, sem conta bancária.

## Como rodar

```powershell
npm install
copy .env.example .env   # e edite o .env
npm run wallet           # gera a carteira que RECEBE (coloque o endereco em PAY_TO)
npm run snapshot         # baixa o catalogo do Bazaar (~33 mil itens, ~10 min)
npm run dev              # sobe a API em http://localhost:3000
```

Scripts úteis:

```powershell
npm run scan -- 0xEndereco 24   # varredura on-chain manual (24h)
npm run report                  # gera o relatorio "Estado do Bazaar" em reports/
npm run test:buyer              # testa o fluxo x402 completo como comprador
npm run typecheck
```

## Testnet → Mainnet

**Testnet (padrão, `NETWORK=base-sepolia`):** usa o facilitador público `x402.org` automaticamente. Para testar como comprador: crie uma segunda carteira, pegue USDC de teste no [faucet da Circle](https://faucet.circle.com) (rede Base Sepolia) e ETH de teste em um faucet da Base Sepolia, preencha `BUYER_PRIVATE_KEY` no `.env` e rode `npm run test:buyer`.

**Mainnet (`NETWORK=base`):**

1. Crie uma conta gratuita no [CDP Portal](https://portal.cdp.coinbase.com) e gere uma API key (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`). O facilitador da Coinbase liquida USDC na Base **sem taxa** (1.000 transações/mês grátis, depois $0.001/transação).
2. Gere uma carteira **nova** com `npm run wallet`, guarde a chave privada offline (gerenciador de senhas) e coloque só o **endereço** em `PAY_TO`.
3. Ajuste `NETWORK=base` e `PUBLIC_BASE_URL=https://seu-dominio.com`.
4. A listagem no **Bazaar** é automática: ao liquidar pagamentos pelo facilitador CDP com `discoverable: true` (já configurado), o serviço entra no catálogo de descoberta.

## Deploy (Railway, ~US$ 5/mês)

O [Dockerfile](Dockerfile) usa Node 24 e sobe com `npm start`. O banco SQLite **não** fica no disco do container: a imagem espera um volume montado em `/data` (`DB_PATH=/data/x402rep.db`). Sem esse volume, o catálogo e o cache on-chain somem a cada restart.

1. Crie o serviço no Railway a partir deste repositório (builder Docker).
2. Em **Volumes**, crie um volume e monte em `/data`.
3. Variáveis: `NETWORK=base`, `PAY_TO`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `PUBLIC_BASE_URL` (a URL `https://....up.railway.app`), `ETHERSCAN_API_KEY`. Não defina `DB_PATH` — o Dockerfile já aponta para `/data`.
4. Segundo serviço (cron), mesma imagem e **o mesmo volume** em `/data`:
   - todo dia: `npm run snapshot`
   - toda segunda: `npm run report`
5. Health check: `GET /health`.

Domínio próprio (`payerproof.xyz`, ~US$ 12/ano) pode esperar. A URL do Railway basta para o primeiro post. Os RPCs públicos já funcionam; um endpoint grátis da Alchemy no início de `BASE_RPC_URL` deixa a varredura mais estável.

## Arquitetura

```
src/
  config.ts            variaveis de ambiente e constantes
  db.ts                SQLite (node:sqlite) - listagens, historico, transfers, scan_state
  server.ts            Express + paymentMiddleware (x402)
  bazaar/snapshot.ts   snapshot diario do catalogo de descoberta (keyless)
  onchain/usdc.ts      coletor de Transfer USDC na Base (chunks adaptativos, cache incremental)
  services/probe.ts    sonda de prova de vida (espera HTTP 402)
  services/score.ts    nota composta 0-100
  jobs/                snapshot | scan | report (CLI)
scripts/
  create-wallet.ts     gera carteira receptora
  test-buyer.ts        testa o fluxo de pagamento como comprador
public/index.html      documentacao publica
launch/                rascunhos de posts de lancamento
```

### Como a cobertura on-chain funciona

Varrer 30 dias de logs na Base (~1,3 milhão de blocos) via RPC gratuito leva minutos. Para não estourar o timeout de uma requisição paga, cada chamada varre no máximo `SCAN_MAX_BLOCKS_PER_REQUEST` blocos novos e **guarda tudo em cache** no SQLite. A resposta sempre informa a janela exatamente coberta (`window.hoursCovered`, `window.complete`); chamadas repetidas estendem a cobertura. Honestidade metodológica > número bonito.

## Avisos

- Carteiras podem receber USDC por motivos alheios ao x402; os números são sinais, não provas.
- Nota alta não é endosso; nota baixa não é acusação. Não é aconselhamento financeiro.
