import { describe, expect, test } from "bun:test";

import type { FetchLike } from "../src/types.ts";
import { parseBraveResults, parseSearxngResults, parseSerperResults, parseTavilyResults } from "../src/web/providers/parse.ts";
import { webSearchTool } from "../src/web/search-tool.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function install(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return undefined;
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}

describe("result parsers", () => {
  test("keeps http(s) hits and drops other links", () => {
    expect(parseBraveResults({
      web: {
        results: [
          { title: "Botanical", url: "https://example.com/a", description: "A server." },
          { title: "Skip", url: "javascript:alert(1)", description: "nope" },
          { title: "", url: "https://example.com/b", description: "  " },
        ],
      },
    })).toEqual([
      { title: "Botanical", url: "https://example.com/a", snippet: "A server." },
      { title: "https://example.com/b", url: "https://example.com/b", snippet: "" },
    ]);
    expect(parseBraveResults(null)).toEqual([]);
    expect(parseTavilyResults({ results: [{ title: "T", url: "https://example.com", content: "C" }] })).toEqual([
      { title: "T", url: "https://example.com/", snippet: "C" },
    ]);
    expect(parseSerperResults({ organic: [{ title: "T", link: "https://example.com/s", snippet: "S" }] })).toEqual([
      { title: "T", url: "https://example.com/s", snippet: "S" },
    ]);
    expect(parseSearxngResults({ results: [{ title: "T", url: "http://example.com/x", content: "S" }] })).toEqual([
      { title: "T", url: "http://example.com/x", snippet: "S" },
    ]);
  });
});

describe("web_search", () => {
  test("returns a stub and does not call the network when no key is set", async () => {
    const { calls, fetchImpl } = install(() => {
      throw new Error("network should not be called");
    });
    const result = await webSearchTool.execute({ query: "botanical agents" }, { env: {}, fetch: fetchImpl });
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("search_unconfigured");
    expect(result.content).toContain("botanical agents");
    expect(result.content).toContain("BRAVE_SEARCH_API_KEY");
    expect(result.data).toMatchObject({ provider: "stub", query: "botanical agents", results: [] });
  });

  test("names the missing key for an explicit provider", async () => {
    const { calls, fetchImpl } = install(() => {
      throw new Error("network should not be called");
    });
    const result = await webSearchTool.execute(
      { query: "ferns" },
      { env: { BOTANICAL_SEARCH_PROVIDER: "brave" }, fetch: fetchImpl },
    );
    expect(calls).toHaveLength(0);
    expect(result.errorCode).toBe("search_unconfigured");
    expect(result.content).toContain("BRAVE_SEARCH_API_KEY");
    const invalid = await webSearchTool.execute(
      { query: "ferns" },
      { env: { BOTANICAL_SEARCH_PROVIDER: "google" }, fetch: fetchImpl },
    );
    expect(invalid.errorCode).toBe("invalid_provider");
  });

  test("calls Brave with the subscription header and formats hits", async () => {
    const key = "brave-key-123";
    const { calls, fetchImpl } = install((url) => {
      expect(url).not.toContain(key);
      return jsonResponse({
        web: { results: [{ title: "Docs", url: "https://example.com/docs", description: "Read this." }] },
      });
    });
    const result = await webSearchTool.execute(
      { query: "botanical agents", count: 2, freshness: "week" },
      { env: { BRAVE_SEARCH_API_KEY: key }, fetch: fetchImpl },
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("[Docs](https://example.com/docs)");
    expect(result.content).toContain("Read this.");
    expect(result.content).toContain("provider: brave");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.search.brave.com/res/v1/web/search");
    expect(url.searchParams.get("q")).toBe("botanical agents");
    expect(url.searchParams.get("count")).toBe("2");
    expect(url.searchParams.get("freshness")).toBe("pw");
    expect(header(calls[0]?.init, "X-Subscription-Token")).toBe(key);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  test("clamps count and redacts a provider error that echoes the key", async () => {
    const key = "brave-key-123";
    const { calls, fetchImpl } = install(() => jsonResponse({ error: `bad ${key}` }, 401));
    const result = await webSearchTool.execute(
      { query: "ferns", count: 50 },
      { env: { BOTANICAL_SEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: key }, fetch: fetchImpl },
    );
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("search_failed");
    expect(result.content).toContain("HTTP 401");
    expect(result.content).not.toContain(key);
    expect(result.content).toContain("[redacted]");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.searchParams.get("count")).toBe("10");
  });

  test("posts to Tavily and Serper and queries SearXNG without putting the key in the URL", async () => {
    const tavilyKey = "tavily-key-123";
    const tavily = install(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ api_key: tavilyKey, query: "ferns", max_results: 5, time_range: "day" });
      return jsonResponse({ results: [{ title: "Fern", url: "https://example.com/fern", content: "Green." }] });
    });
    const tavilyResult = await webSearchTool.execute(
      { query: "ferns", freshness: "day" },
      { env: { BOTANICAL_SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: tavilyKey }, fetch: tavily.fetchImpl },
    );
    expect(tavilyResult.ok).toBe(true);
    expect(tavily.calls[0]?.url).toBe("https://api.tavily.com/search");
    expect(tavilyResult.content).not.toContain(tavilyKey);

    const serperKey = "serper-key-123";
    const serper = install(async (_url, init) => {
      expect(header(init, "X-API-KEY")).toBe(serperKey);
      expect(JSON.parse(String(init?.body))).toMatchObject({ q: "ferns", num: 3, tbs: "qdr:m" });
      return jsonResponse({ organic: [] });
    });
    const serperResult = await webSearchTool.execute(
      { query: "ferns", count: 3, freshness: "month" },
      { env: { SERPER_API_KEY: serperKey }, fetch: serper.fetchImpl },
    );
    expect(serperResult.ok).toBe(true);
    expect(serperResult.content).toContain("No web results");
    expect(serper.calls[0]?.url).toBe("https://google.serper.dev/search");

    const searxKey = "searx-key-123456";
    const searx = install((url, init) => {
      expect(url).not.toContain(searxKey);
      expect(header(init, "Authorization")).toBe(`Bearer ${searxKey}`);
      return jsonResponse({ results: [{ title: "Local", url: "https://example.com/l", content: "Hit" }] });
    });
    const searxResult = await webSearchTool.execute(
      { query: "ferns" },
      {
        env: { SEARXNG_URL: "http://127.0.0.1:8080", SEARXNG_API_KEY: searxKey },
        fetch: searx.fetchImpl,
      },
    );
    expect(searxResult.ok).toBe(true);
    const searxUrl = new URL(searx.calls[0]?.url ?? "");
    expect(searxUrl.origin).toBe("http://127.0.0.1:8080");
    expect(searxUrl.pathname).toBe("/search");
    expect(searxUrl.searchParams.get("format")).toBe("json");
    expect(searxResult.content).not.toContain(searxKey);
  });

  test("rejects malformed arguments and accepts a JSON string", async () => {
    const empty = await webSearchTool.execute({ query: "   " }, { env: {} });
    expect(empty.errorCode).toBe("invalid_arguments");
    const freshness = await webSearchTool.execute({ query: "ferns", freshness: "hour" }, { env: {} });
    expect(freshness.errorCode).toBe("invalid_arguments");
    const parsed = await webSearchTool.execute('{"query":"from json"}', { env: {} });
    expect(parsed.errorCode).toBe("search_unconfigured");
    expect(parsed.content).toContain("from json");
    const broken = await webSearchTool.execute("{", { env: {} });
    expect(broken.errorCode).toBe("invalid_arguments");
  });
});
