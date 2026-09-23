import { describe, expect, test } from "bun:test";

import type { DnsLookup, FetchLike, ToolContext } from "../src/types.ts";
import { webFetchTool } from "../src/web/fetch-tool.ts";

const publicDns: DnsLookup = async () => ["93.184.216.34"];

function callsOf(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (init?.signal?.aborted) {
      throw init.signal.reason instanceof Error
        ? init.signal.reason
        : new DOMException("aborted", "AbortError");
    }
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function ctx(partial: ToolContext): ToolContext {
  return { env: {}, dnsLookup: publicDns, ...partial };
}

const article = `<!doctype html><html><head><title>Acme Docs</title><script>secret()</script></head>
<body><nav>Home</nav><article><h1>Getting started</h1><p>Read the <a href="/docs">docs</a>.</p></article></body></html>`;

describe("web_fetch", () => {
  test("extracts markdown from HTML", async () => {
    const { fetchImpl, calls } = callsOf(() => new Response(article, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    const result = await webFetchTool.execute(
      { url: "https://example.com/guide" },
      ctx({ fetch: fetchImpl }),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("# Acme Docs");
    expect(result.content).toContain("# Getting started");
    expect(result.content).toContain("[docs](https://example.com/docs)");
    expect(result.content).toContain("Source: https://example.com/guide");
    expect(result.content).not.toContain("secret()");
    expect(result.content).not.toContain("Home");
    expect(calls).toHaveLength(1);
    expect(result.data).toMatchObject({ status: 200, finalUrl: "https://example.com/guide", truncated: false });
  });

  test("does not contact private, credentialed, or non-http URLs", async () => {
    const { fetchImpl, calls } = callsOf(() => new Response("nope"));
    const blocked = await webFetchTool.execute({ url: "http://127.0.0.1/secret" }, ctx({ fetch: fetchImpl }));
    const decimal = await webFetchTool.execute({ url: "http://2130706433/" }, ctx({ fetch: fetchImpl }));
    const creds = await webFetchTool.execute({ url: "https://user:s3cret@example.com/" }, ctx({ fetch: fetchImpl }));
    const file = await webFetchTool.execute({ url: "file:///etc/passwd" }, ctx({ fetch: fetchImpl }));
    const rebind = await webFetchTool.execute(
      { url: "https://public.example/" },
      ctx({ fetch: fetchImpl, dnsLookup: async () => ["10.0.0.8"] }),
    );
    expect(calls).toHaveLength(0);
    expect(blocked.errorCode).toBe("blocked_url");
    expect(decimal.errorCode).toBe("blocked_url");
    expect(creds.errorCode).toBe("invalid_url");
    expect(creds.content).not.toContain("s3cret");
    expect(file.errorCode).toBe("invalid_url");
    expect(rebind.errorCode).toBe("blocked_url");
  });

  test("refuses a redirect onto a private address and a non-http scheme", async () => {
    const privateHop = callsOf(() => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/secret" },
    }));
    const blocked = await webFetchTool.execute({ url: "https://example.com/start" }, ctx({ fetch: privateHop.fetchImpl }));
    expect(blocked.errorCode).toBe("blocked_url");
    expect(privateHop.calls).toHaveLength(1);

    const scriptHop = callsOf(() => new Response(null, {
      status: 302,
      headers: { location: "javascript:alert(1)" },
    }));
    const script = await webFetchTool.execute({ url: "https://example.com/start" }, ctx({ fetch: scriptHop.fetchImpl }));
    expect(script.errorCode).toBe("invalid_url");
    expect(scriptHop.calls).toHaveLength(1);
  });

  test("follows up to five redirects and stops after that", async () => {
    let hops = 0;
    const followed = callsOf(() => {
      hops += 1;
      if (hops <= 5) {
        return new Response(null, { status: 302, headers: { location: `https://example.com/r${hops}` } });
      }
      return new Response("landed", { headers: { "content-type": "text/plain" } });
    });
    const ok = await webFetchTool.execute({ url: "https://example.com/start" }, ctx({ fetch: followed.fetchImpl }));
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("landed");
    expect(ok.data).toMatchObject({ finalUrl: "https://example.com/r5" });

    const loop = callsOf((url) => new Response(null, {
      status: 302,
      headers: { location: `${url}/next` },
    }));
    const stopped = await webFetchTool.execute({ url: "https://example.com/loop" }, ctx({ fetch: loop.fetchImpl }));
    expect(stopped.errorCode).toBe("too_many_redirects");
    expect(loop.calls.length).toBeLessThanOrEqual(6);
    expect(loop.calls.length).toBeGreaterThan(0);
  });

  test("returns text, json, charset decoding, http errors, and unsupported types", async () => {
    const json = callsOf(() => new Response('{"a":1,"b":"two"}', {
      headers: { "content-type": "application/json" },
    }));
    const jsonResult = await webFetchTool.execute({ url: "https://example.com/data" }, ctx({ fetch: json.fetchImpl }));
    expect(jsonResult.ok).toBe(true);
    expect(jsonResult.content).toContain('"b": "two"');

    const latin = callsOf(() => new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), {
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
    }));
    const latinResult = await webFetchTool.execute({ url: "https://example.com/cafe" }, ctx({ fetch: latin.fetchImpl }));
    expect(latinResult.content).toContain("café");

    const missing = callsOf(() => new Response("<html><body><p>Missing page</p></body></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    }));
    const missingResult = await webFetchTool.execute({ url: "https://example.com/nope" }, ctx({ fetch: missing.fetchImpl }));
    expect(missingResult.ok).toBe(false);
    expect(missingResult.errorCode).toBe("http_error");
    expect(missingResult.content).toContain("404");
    expect(missingResult.content).toContain("Missing page");

    const pdf = callsOf(() => new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }));
    const pdfResult = await webFetchTool.execute({ url: "https://example.com/file.pdf" }, ctx({ fetch: pdf.fetchImpl }));
    expect(pdfResult.errorCode).toBe("unsupported_media_type");
  });

  test("truncates extracted text and oversized bodies", async () => {
    const long = `<p>${"a".repeat(180)}SENTINEL_END</p>`;
    const chars = callsOf(() => new Response(long, { headers: { "content-type": "text/html" } }));
    const short = await webFetchTool.execute(
      { url: "https://example.com/long", max_chars: 100 },
      ctx({ fetch: chars.fetchImpl }),
    );
    expect(short.ok).toBe(true);
    expect(short.content).toContain("truncated to 100");
    expect(short.content).not.toContain("SENTINEL_END");

    const huge = `<p>${"word ".repeat(400)}</p>`;
    const bytes = callsOf(() => new Response(huge, { headers: { "content-type": "text/html" } }));
    const cut = await webFetchTool.execute(
      { url: "https://example.com/huge" },
      ctx({
        fetch: bytes.fetchImpl,
        env: { BOTANICAL_WEB_FETCH_MAX_BYTES: "200" },
      }),
    );
    expect(cut.content).toContain("byte limit");
    expect(cut.data).toMatchObject({ truncated: true });
  });

  test("times out, honors an aborted signal, and can reach loopback when allowed", async () => {
    const hanging = callsOf((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new DOMException("aborted", "AbortError"));
      });
    }));
    const timed = await webFetchTool.execute(
      { url: "https://example.com/slow" },
      ctx({ fetch: hanging.fetchImpl, env: { BOTANICAL_WEB_FETCH_TIMEOUT_MS: "50" } }),
    );
    expect(timed.errorCode).toBe("timeout");

    const controller = new AbortController();
    controller.abort();
    const live = callsOf(() => new Response("ok", { headers: { "content-type": "text/plain" } }));
    const aborted = await webFetchTool.execute(
      { url: "https://example.com/" },
      ctx({ fetch: live.fetchImpl, signal: controller.signal }),
    );
    expect(aborted.errorCode).toBe("aborted");
    expect(live.calls).toHaveLength(0);

    const local = callsOf(() => new Response("local", { headers: { "content-type": "text/plain" } }));
    const allowed = await webFetchTool.execute(
      { url: "http://127.0.0.1:9/health" },
      ctx({
        fetch: local.fetchImpl,
        env: { BOTANICAL_WEB_ALLOW_PRIVATE_URLS: "1" },
        dnsLookup: async () => {
          throw new Error("dns should not run");
        },
      }),
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.content).toContain("local");
    expect(local.calls).toHaveLength(1);
  });

  test("accepts JSON-string arguments and rejects bad ones", async () => {
    const { fetchImpl } = callsOf(() => new Response("plain", { headers: { "content-type": "text/plain" } }));
    const ok = await webFetchTool.execute('{"url":"https://example.com/p"}', ctx({ fetch: fetchImpl }));
    expect(ok.ok).toBe(true);
    const bad = await webFetchTool.execute("{", { env: {} });
    expect(bad.errorCode).toBe("invalid_arguments");
    const missing = await webFetchTool.execute({}, { env: {} });
    expect(missing.errorCode).toBe("invalid_arguments");
  });
});
