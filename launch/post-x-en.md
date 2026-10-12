# Launch post — X/Twitter (English, primary channel)

> Post as a thread. Replace [DOMAIN] with the real domain and fill in the real
> numbers from your latest `npm run report` output before posting.
> Golden rule learned from this niche: lead with DATA, not with your product.

## Numeros REAIS ja coletados (snapshot + on-chain de 2026-10-12) — use/atualize:
- Catalogo: 32.723 listagens, 1.606 vendedores unicos
- agents.chain.link: 29.628 chamadas reportadas em 30d vindas de apenas 2 pagadores
- Storm Station 247: 3.669 chamadas / 2 pagadores; api.jarvisclaw.ai: 1.118 / 1 pagador
- AX1 (top do catalogo): verificado on-chain em janela de 4h — 1.617 transferencias,
  29 pagadores unicos, maior pagador = 21,6% do volume, ratio contador/on-chain ~0,74
  (este e um caso RAZOAVELMENTE honesto — bom contraste para mostrar equilibrio)

---

**Tweet 1 (the hook — data, not product)**

The x402 Bazaar lists 32,000+ paid services. I snapshot the catalog daily and
checked the self-reported call counters against actual USDC transfers on Base.

Some "popular" endpoints report 400k calls/month while the chain shows a few
dollars. Thread with receipts:

**Tweet 2 (receipts)**

Example: the top endpoint by reported calls shows ~13k calls/day on its counter.
On-chain, its wallet received [N] transfers in 24h from [M] unique payers — and
the top payer alone is [X]% of all volume.

Counters are self-reported. Wallets are not.

**Tweet 3 (the gap)**

If you're building an agent that picks services from the Bazaar autonomously,
it has no way to tell a real service from a counter-stuffed one.

That's the trust gap in the agent economy right now.

**Tweet 4 (the product)**

So I built Payerproof: an x402 service that scores x402 services.

GET /score → trust score 0-100: liveness probe + on-chain payer diversity +
reported-vs-verified revenue + listing age. Flags like inflated_counter and
self_dealing_suspected.

$0.02 USDC on Base, paid via x402 itself. No account, no API key.

**Tweet 5 (close)**

Docs: https://[DOMAIN]
Free integration check: GET https://[DOMAIN]/ping

Weekly "Payerproof: State of the Bazaar" report drops every Monday — follow along.
Methodology is public and every response includes the exact block range covered.

---

# Community post — x402 Discord / r/microsaas / agent forums

Title: I audited the x402 Bazaar's self-reported counters against the chain — and turned it into a paid x402 endpoint

Body:
- What I measured (daily catalog snapshots + USDC Transfer logs on Base)
- 2-3 concrete findings with numbers (from `npm run report`)
- Honest limitations (wallets can receive USDC for other reasons; partial coverage windows are disclosed in every response)
- Payerproof: /score ($0.02) and /revenue ($0.01), paid via x402, listed in the Bazaar
- Ask for feedback on the scoring weights — people love correcting a methodology, and every reply is distribution
