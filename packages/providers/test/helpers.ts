export interface CapturedRequest {
  url: string;
  init: RequestInit;
}

export function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

export function sseResponse(chunks: string[], status = 200): Response {
  return new Response(sseBody(chunks), {
    status,
    headers: { "content-type": status === 200 ? "text/event-stream" : "application/json" },
  });
}

export function dataEvents(payloads: string[]): string {
  return payloads.map((payload) => `data: ${payload}\n\n`).join("");
}

export function captureFetch(
  response: Response | ((url: string, init: RequestInit | undefined) => Response | Promise<Response>),
): { fetch: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      const reason = init.signal.reason;
      throw reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
    }
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return typeof response === "function" ? response(url, init) : response;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("expected a string body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

export function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers || typeof headers !== "object" || headers instanceof Headers) return undefined;
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}
