import { describe, expect, test } from "bun:test";

import { WEB_LIMITS, envFrom, loadWebToolConfig } from "../src/web/config.ts";

describe("loadWebToolConfig", () => {
  test("stubs when nothing is configured", () => {
    const config = loadWebToolConfig({});
    expect(config.searchProvider).toBe("stub");
    expect(config.searchLive).toBe(false);
    expect(config.missingEnv).toBeUndefined();
    expect(config.fetchTimeoutMs).toBe(WEB_LIMITS.fetchTimeoutMs.default);
    expect(config.allowPrivateUrls).toBe(false);
  });

  test("prefers Brave, then Tavily, then Serper, then SearXNG", () => {
    expect(loadWebToolConfig({
      BRAVE_SEARCH_API_KEY: "brave-key-123",
      TAVILY_API_KEY: "tavily-key-123",
    }).searchProvider).toBe("brave");
    expect(loadWebToolConfig({ TAVILY_API_KEY: "tavily-key-123", SERPER_API_KEY: "serper-key-123" }).searchProvider)
      .toBe("tavily");
    expect(loadWebToolConfig({ SERPER_API_KEY: "serper-key-123", SEARXNG_URL: "http://127.0.0.1:8080" }).searchProvider)
      .toBe("serper");
    const searx = loadWebToolConfig({ SEARXNG_URL: "http://127.0.0.1:8080/" });
    expect(searx.searchProvider).toBe("searxng");
    expect(searx.searchLive).toBe(true);
    expect(searx.searxngUrl).toBe("http://127.0.0.1:8080");
  });

  test("accepts the Brave alias and an explicit provider", () => {
    expect(loadWebToolConfig({ BRAVE_API_KEY: "brave-key-123" })).toMatchObject({
      searchProvider: "brave",
      searchLive: true,
      braveApiKey: "brave-key-123",
    });
    expect(loadWebToolConfig({
      BOTANICAL_SEARCH_PROVIDER: "Tavily",
      BRAVE_SEARCH_API_KEY: "brave-key-123",
      TAVILY_API_KEY: "tavily-key-123",
    }).searchProvider).toBe("tavily");
    expect(loadWebToolConfig({
      BOTANICAL_SEARCH_PROVIDER: "stub",
      BRAVE_SEARCH_API_KEY: "brave-key-123",
    })).toMatchObject({ searchProvider: "stub", searchLive: false });
  });

  test("names a missing credential and rejects unknown providers and bad limits", () => {
    expect(loadWebToolConfig({ BOTANICAL_SEARCH_PROVIDER: "brave" })).toMatchObject({
      searchProvider: "brave",
      searchLive: false,
      missingEnv: "BRAVE_SEARCH_API_KEY or BRAVE_API_KEY",
    });
    expect(loadWebToolConfig({ BOTANICAL_SEARCH_PROVIDER: "google" }).invalidProvider).toBe("google");
    expect(loadWebToolConfig({ SEARXNG_URL: "ftp://files.example" })).toMatchObject({
      searchProvider: "searxng",
      searchLive: false,
    });
    const limits = loadWebToolConfig({
      BOTANICAL_WEB_FETCH_TIMEOUT_MS: "nope",
      BOTANICAL_WEB_FETCH_MAX_BYTES: "10",
      BOTANICAL_WEB_SEARCH_TIMEOUT_MS: "999999",
      BOTANICAL_WEB_ALLOW_PRIVATE_URLS: "YES",
      BRAVE_SEARCH_API_KEY: "   ",
    });
    expect(limits.fetchTimeoutMs).toBe(WEB_LIMITS.fetchTimeoutMs.default);
    expect(limits.fetchMaxBytes).toBe(WEB_LIMITS.fetchMaxBytes.min);
    expect(limits.searchTimeoutMs).toBe(WEB_LIMITS.searchTimeoutMs.max);
    expect(limits.allowPrivateUrls).toBe(true);
    expect(limits.searchProvider).toBe("stub");
  });

  test("envFrom uses the call env or process.env", () => {
    expect(envFrom(undefined)).toBe(process.env);
    expect(envFrom({})).toBe(process.env);
    expect(envFrom({ env: { A: "b" } })).toEqual({ A: "b" });
  });
});
