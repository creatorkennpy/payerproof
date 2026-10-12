/**
 * Sonda de "prova de vida": chama o recurso sem pagamento e verifica se ele
 * responde HTTP 402 com requisitos de pagamento coerentes com a listagem.
 */

export interface ProbeResult {
  reachable: boolean;
  status: number | null;
  latencyMs: number | null;
  returns402: boolean;
  /** payTo anunciado na resposta 402 (se houver). */
  advertisedPayTo: string | null;
  /** true se o payTo da resposta bate com o recipient da listagem. */
  payToMatches: boolean | null;
  error: string | null;
}

interface X402Accept {
  payTo?: string;
}

async function probeOnce(
  url: string,
  method: "GET" | "POST",
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers:
        method === "POST"
          ? { accept: "application/json", "content-type": "application/json" }
          : { accept: "application/json" },
      body: method === "POST" ? "{}" : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeResource(
  url: string,
  expectedRecipient?: string,
  timeoutMs = 6000,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    let res = await probeOnce(url, "GET", timeoutMs);
    // Endpoints POST-only costumam responder 404/405 ao GET: tenta POST.
    if (res.status === 404 || res.status === 405) {
      res = await probeOnce(url, "POST", timeoutMs);
    }
    const latencyMs = Date.now() - started;
    let advertisedPayTo: string | null = null;

    if (res.status === 402) {
      try {
        const body = (await res.json()) as { accepts?: X402Accept[] };
        advertisedPayTo = body.accepts?.[0]?.payTo?.toLowerCase() ?? null;
      } catch {
        // corpo nao-JSON: ainda conta como 402
      }
    }

    const payToMatches =
      expectedRecipient && advertisedPayTo
        ? advertisedPayTo === expectedRecipient.toLowerCase()
        : null;

    return {
      reachable: true,
      status: res.status,
      latencyMs,
      returns402: res.status === 402,
      advertisedPayTo,
      payToMatches,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      status: null,
      latencyMs: null,
      returns402: false,
      advertisedPayTo: null,
      payToMatches: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
