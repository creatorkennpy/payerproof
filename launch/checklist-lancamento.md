# Checklist de lançamento (ordem recomendada)

## Semana 0 — colocar no ar (custos: domínio ~US$12 + host ~US$5/mês)
- [ ] Criar conta no CDP Portal (https://portal.cdp.coinbase.com) e gerar API key
- [ ] Gerar carteira de produção: `npm run wallet` (chave privada OFFLINE, só o endereço no servidor)
- [ ] Comprar domínio (sugestões de nome: algo com "402", "trust", "score", "bazaar")
- [ ] Deploy no Railway/Render com variáveis de produção (`NETWORK=base`, `PUBLIC_BASE_URL=https://dominio`)
- [ ] Configurar cron: `npm run snapshot` diário (ex.: 03:00 UTC) e `npm run report` semanal (segunda)
- [ ] Testar o fluxo real: `npm run test:buyer` apontando para o domínio, com alguns centavos de USDC
- [ ] Confirmar listagem: procurar seu endpoint em https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources (pode levar um tempo após as primeiras liquidações)

## Semana 1 — distribuição orgânica (custo: zero)
- [ ] Rodar `npm run report` e extrair 2-3 números fortes para o post
- [ ] Publicar a thread no X (rascunho em launch/post-x-en.md) — em inglês, o público é global
- [ ] Postar no Discord oficial do x402 e em comunidades de agentes de IA
- [ ] Postar versão longa no r/microsaas ou r/SideProject (o que funciona: dados + honestidade metodológica)
- [ ] Responder TODO comentário em 24h

## Contínuo
- [ ] Relatório "Estado do Bazaar" toda segunda no X (isca de conteúdo recorrente)
- [ ] Monitorar a carteira receptora (ex.: https://basescan.org/address/SEU_ENDERECO)
- [ ] Ajustar preços conforme demanda ($0.02 → $0.05 se houver tração)
- [ ] Ideias de expansão: badge "verified by" para vendedores honestos; webhook de alerta
      quando o score de um serviço cair; endpoint em lote (batch) para marketplaces

## Regras de segurança
- A chave privada da carteira receptora NUNCA entra no servidor nem no repositório
- Sacar USDC acumulado periodicamente para uma carteira fria
- `.env` está no .gitignore — mantenha assim
