import { clamp, optionalEnum, optionalInteger, parseArgsObject, requireString } from "../args.ts";
import { runTool, toolError, toolOk } from "../result.ts";
import { combineSignals, throwIfAborted } from "../signals.ts";
import type { JsonSchema, Tool, ToolContext, ToolExecutionResult } from "../types.ts";
import {
  FRESHNESS_VALUES,
  WEB_LIMITS,
  envFrom,
  loadWebToolConfig,
  type WebToolConfig,
} from "./config.ts";
import { redact } from "./providers/http.ts";
import type { SearchHit } from "./providers/parse.ts";
import { runSearch } from "./providers/search.ts";

export const webSearchParameters = {
  type: "object",
  description: "Search the public web.",
  properties: {
    query: {
      type: "string",
      description: "Search query.",
      minLength: 1,
      maxLength: WEB_LIMITS.queryLength,
    },
    count: {
      type: "integer",
      description: "How many results to return (1-10). Defaults to 5.",
      minimum: WEB_LIMITS.searchResults.min,
      maximum: WEB_LIMITS.searchResults.max,
      default: WEB_LIMITS.searchResults.default,
    },
    freshness: {
      type: "string",
      description: "Optional recency filter, used when the configured provider supports it.",
      enum: FRESHNESS_VALUES,
    },
  },
  required: ["query"],
  additionalProperties: false,
} satisfies JsonSchema;

export const WEB_SEARCH_DESCRIPTION = "Search the public web. Returns titles, URLs, and short snippets. Use for recent or sourced facts. Use web_fetch to read a specific page. The search provider is configured on the server.";

export interface WebSearchData {
  provider: string;
  query: string;
  results: SearchHit[];
}

export const webSearchTool: Tool = {
  name: "web_search",
  description: WEB_SEARCH_DESCRIPTION,
  parameters: webSearchParameters,
  execute(args, ctx) {
    const config = loadWebToolConfig(envFrom(ctx));
    return runTool(() => executeWebSearch(args, ctx ?? {}, config), config.searchTimeoutMs);
  },
};

async function executeWebSearch(raw: unknown, ctx: ToolContext, config: WebToolConfig): Promise<ToolExecutionResult> {
  const args = parseArgsObject(raw);
  const query = normalizeQuery(requireString(args, "query", 2_000));
  if (!query) {
    return toolError("invalid_arguments", "query is required and must be a non-empty string.");
  }
  if (query.length > WEB_LIMITS.queryLength) {
    return toolError("invalid_arguments", `query must be ${WEB_LIMITS.queryLength} characters or fewer.`);
  }
  const requestedCount = optionalInteger(args, "count");
  const count = requestedCount === undefined
    ? WEB_LIMITS.searchResults.default
    : clamp(requestedCount, WEB_LIMITS.searchResults.min, WEB_LIMITS.searchResults.max);
  const freshness = optionalEnum(args, "freshness", FRESHNESS_VALUES);

  if (config.invalidProvider) {
    return toolError(
      "invalid_provider",
      `BOTANICAL_SEARCH_PROVIDER=${quote(safeToken(config.invalidProvider))} is not supported. Use brave, tavily, serper, searxng, or stub.\nQuery: ${quote(query)}`,
      searchData(config, query, []),
    );
  }
  if (!config.searchLive) {
    return toolError("search_unconfigured", unconfiguredMessage(config, query), searchData(config, query, []));
  }

  const signal = combineSignals(ctx.signal, config.searchTimeoutMs);
  throwIfAborted(signal);
  const hits = presentHits(await runSearch(config, query, {
    count,
    freshness,
    fetchImpl: ctx.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    signal,
  }));
  const secrets = [config.braveApiKey, config.tavilyApiKey, config.serperApiKey, config.searxngApiKey]
    .filter((secret): secret is string => typeof secret === "string");
  const results = hits.map((hit) => ({
    title: redact(hit.title, secrets),
    url: redact(hit.url, secrets),
    snippet: redact(hit.snippet, secrets),
  }));
  const content = redact(formatSearchResults(query, config.searchProvider, results), secrets);
  return toolOk(content, searchData(config, query, results));
}

export function formatSearchResults(query: string, provider: string, hits: readonly SearchHit[]): string {
  if (hits.length === 0) return `No web results for ${quote(query)} (provider: ${provider}).`;
  const lines = [`Web search results for ${quote(query)} (provider: ${provider}):`, ""];
  hits.forEach((hit, index) => {
    const label = (hit.title || hit.url).replace(/[\[\]]/g, "") || hit.url;
    lines.push(`${index + 1}. [${label}](${hit.url})`);
    if (hit.snippet) lines.push(`   ${hit.snippet}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

function presentHits(hits: readonly SearchHit[]): SearchHit[] {
  return hits.slice(0, WEB_LIMITS.searchResults.max).map((hit) => ({
    title: hit.title.replace(/\s+/g, " ").trim().slice(0, 300),
    url: hit.url,
    snippet: hit.snippet.replace(/\s+/g, " ").trim().slice(0, 500),
  }));
}

function unconfiguredMessage(config: WebToolConfig, query: string): string {
  if (config.missingEnv) {
    return [
      `Web search provider "${config.searchProvider}" is selected but ${config.missingEnv} is not set. No request was sent.`,
      `Query: ${quote(query)}`,
    ].join("\n");
  }
  return [
    "Web search is not configured, so no request was sent.",
    `Query: ${quote(query)}`,
    "",
    "Set BOTANICAL_SEARCH_PROVIDER to brave, tavily, serper, or searxng and provide the matching credential:",
    "BRAVE_SEARCH_API_KEY (or BRAVE_API_KEY), TAVILY_API_KEY, SERPER_API_KEY, or SEARXNG_URL.",
  ].join("\n");
}

function searchData(config: WebToolConfig, query: string, results: SearchHit[]): WebSearchData {
  return { provider: config.invalidProvider ?? config.searchProvider, query, results };
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function safeToken(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 80);
}
