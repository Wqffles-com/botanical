import type { FetchLike } from "../../types.ts";
import type { Freshness, WebToolConfig } from "../config.ts";
import { requestJson, type JsonRequest } from "./http.ts";
import { parseBraveResults, parseSearxngResults, parseSerperResults, parseTavilyResults, type SearchHit } from "./parse.ts";

export interface ProviderQuery {
  count: number;
  freshness?: Freshness;
  fetchImpl: FetchLike;
  signal: AbortSignal;
}

const BRAVE_FRESHNESS: Record<Freshness, string> = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
};

const SERPER_TBS: Record<Freshness, string> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

export async function runSearch(config: WebToolConfig, query: string, options: ProviderQuery): Promise<SearchHit[]> {
  const call = {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    userAgent: config.userAgent,
    secrets: secretsOf(config),
  };
  switch (config.searchProvider) {
    case "brave":
      return searchBrave(query, options, required(config.braveApiKey, "Brave"), call);
    case "tavily":
      return searchTavily(query, options, required(config.tavilyApiKey, "Tavily"), call);
    case "serper":
      return searchSerper(query, options, required(config.serperApiKey, "Serper"), call);
    case "searxng":
      return searchSearxng(query, options, required(config.searxngUrl, "SearXNG"), config.searxngApiKey, call);
    case "stub":
      return [];
  }
}

async function searchBrave(
  query: string,
  options: ProviderQuery,
  apiKey: string,
  call: Omit<JsonRequest, "url" | "method" | "headers" | "body">,
): Promise<SearchHit[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(options.count));
  if (options.freshness) url.searchParams.set("freshness", BRAVE_FRESHNESS[options.freshness]);
  const payload = await requestJson({
    ...call,
    url: url.toString(),
    method: "GET",
    headers: { "X-Subscription-Token": apiKey },
  });
  return parseBraveResults(payload);
}

async function searchTavily(
  query: string,
  options: ProviderQuery,
  apiKey: string,
  call: Omit<JsonRequest, "url" | "method" | "headers" | "body">,
): Promise<SearchHit[]> {
  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    max_results: options.count,
    search_depth: "basic",
    include_answer: false,
  };
  if (options.freshness) body.time_range = options.freshness;
  const payload = await requestJson({
    ...call,
    url: "https://api.tavily.com/search",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return parseTavilyResults(payload);
}

async function searchSerper(
  query: string,
  options: ProviderQuery,
  apiKey: string,
  call: Omit<JsonRequest, "url" | "method" | "headers" | "body">,
): Promise<SearchHit[]> {
  const body: Record<string, unknown> = { q: query, num: options.count };
  if (options.freshness) body.tbs = SERPER_TBS[options.freshness];
  const payload = await requestJson({
    ...call,
    url: "https://google.serper.dev/search",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body,
  });
  return parseSerperResults(payload);
}

async function searchSearxng(
  query: string,
  options: ProviderQuery,
  baseUrl: string,
  apiKey: string | undefined,
  call: Omit<JsonRequest, "url" | "method" | "headers" | "body">,
): Promise<SearchHit[]> {
  const endpoint = new URL("search", `${baseUrl}/`);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("categories", "general");
  if (options.freshness) endpoint.searchParams.set("time_range", options.freshness);
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const payload = await requestJson({
    ...call,
    url: endpoint.toString(),
    method: "GET",
    headers,
  });
  return parseSearxngResults(payload);
}

function secretsOf(config: WebToolConfig): string[] {
  return [config.braveApiKey, config.tavilyApiKey, config.serperApiKey, config.searxngApiKey]
    .filter((secret): secret is string => typeof secret === "string" && secret.length >= 8);
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} credential is missing.`);
  return value;
}
