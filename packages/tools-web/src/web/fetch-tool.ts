import { clamp, optionalInteger, parseArgsObject, requireString } from "../args.ts";
import { htmlToMarkdown } from "../html-to-markdown.ts";
import { decodeBody, looksBinary, mediaType, readBodyLimited } from "../net/body.ts";
import { assertSafeHttpUrl, defaultDnsLookup } from "../net/ssrf.ts";
import { ToolCallError, runTool, toolError, toolOk } from "../result.ts";
import { combineSignals, throwIfAborted } from "../signals.ts";
import type { FetchLike, JsonSchema, Tool, ToolContext, ToolExecutionResult } from "../types.ts";
import { WEB_LIMITS, envFrom, loadWebToolConfig, type WebToolConfig } from "./config.ts";

const MAX_REDIRECTS = 5;

export const webFetchParameters = {
  type: "object",
  description: "Fetch a public http(s) URL and extract readable text.",
  properties: {
    url: {
      type: "string",
      description: "Absolute http or https URL to read.",
      minLength: 1,
      maxLength: WEB_LIMITS.urlLength,
    },
    max_chars: {
      type: "integer",
      description: "Maximum characters of extracted page text to return. Defaults to the server cap (20000 unless BOTANICAL_WEB_FETCH_MAX_CHARS is set).",
      minimum: WEB_LIMITS.fetchMaxChars.min,
      maximum: WEB_LIMITS.fetchMaxChars.max,
    },
  },
  required: ["url"],
  additionalProperties: false,
} satisfies JsonSchema;

export const WEB_FETCH_DESCRIPTION = "Fetch an http or https URL and return readable markdown or plain text. Use when you have a link to read. Refuses non-public hosts, embedded credentials, and non-text bodies. Pages are truncated to a size cap.";

export interface WebFetchData {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  truncated: boolean;
  bytes: number;
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: WEB_FETCH_DESCRIPTION,
  parameters: webFetchParameters,
  execute(args, ctx) {
    const config = loadWebToolConfig(envFrom(ctx));
    return runTool(() => executeWebFetch(args, ctx ?? {}, config), config.fetchTimeoutMs);
  },
};

async function executeWebFetch(raw: unknown, ctx: ToolContext, config: WebToolConfig): Promise<ToolExecutionResult> {
  const args = parseArgsObject(raw);
  const urlRaw = requireString(args, "url", WEB_LIMITS.urlLength);
  const requestedChars = optionalInteger(args, "max_chars");
  const maxChars = requestedChars === undefined
    ? config.fetchMaxChars
    : clamp(requestedChars, WEB_LIMITS.fetchMaxChars.min, Math.min(WEB_LIMITS.fetchMaxChars.max, config.fetchMaxChars));

  const signal = combineSignals(ctx.signal, config.fetchTimeoutMs);
  const fetchImpl: FetchLike = ctx.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const dnsLookup = ctx.dnsLookup ?? defaultDnsLookup;
  const safeOptions = { allowPrivate: config.allowPrivateUrls, dnsLookup };
  const start = await assertSafeHttpUrl(urlRaw, safeOptions);
  const fetched = await fetchFollowing(start, {
    fetchImpl,
    signal,
    userAgent: config.userAgent,
    maxBytes: config.fetchMaxBytes,
    safeOptions,
  });

  const mode = classify(fetched.contentType, fetched.bytes);
  const data: WebFetchData = {
    url: urlRaw,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType: fetched.contentType,
    truncated: fetched.byteTruncated,
    bytes: fetched.bytes.byteLength,
  };

  if (mode === "binary") {
    const label = fetched.contentType || "an unknown content type";
    return toolError(
      "unsupported_media_type",
      `Fetching ${fetched.finalUrl} returned ${label}, which web_fetch cannot read as text.`,
      data,
    );
  }

  const decoded = decodeBody(fetched.bytes, fetched.contentType);
  let title = "";
  let body = "";
  if (mode === "html") {
    const extracted = htmlToMarkdown(decoded, fetched.finalUrl);
    title = extracted.title;
    body = extracted.markdown;
  } else {
    body = formatPlain(decoded, fetched.contentType);
  }
  if (title) data.title = title;

  let charTruncated = false;
  if (body.length > maxChars) {
    let cut = body.lastIndexOf("\n", maxChars);
    if (cut < maxChars * 0.8) cut = maxChars;
    body = body.slice(0, cut).trimEnd();
    charTruncated = true;
  }
  data.truncated = fetched.byteTruncated || charTruncated;
  const content = renderFetchResult({
    title,
    finalUrl: fetched.finalUrl,
    body,
    byteTruncated: fetched.byteTruncated,
    charTruncated,
    maxChars,
  });

  if (fetched.status < 200 || fetched.status >= 300) {
    return toolError("http_error", `Fetching ${fetched.finalUrl} failed with HTTP ${fetched.status}.\n\n${content}`, data);
  }
  return toolOk(content, data);
}

interface FollowOptions {
  fetchImpl: FetchLike;
  signal: AbortSignal;
  userAgent: string;
  maxBytes: number;
  safeOptions: { allowPrivate: boolean; dnsLookup: NonNullable<ToolContext["dnsLookup"]> };
}

interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
  byteTruncated: boolean;
}

async function fetchFollowing(start: URL, options: FollowOptions): Promise<FetchedPage> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    throwIfAborted(options.signal);
    const response = await options.fetchImpl(current.href, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: options.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
        "User-Agent": options.userAgent,
        "Accept-Language": "en",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) {
        throw new ToolCallError("redirect_error", `Redirect from ${current.href} had no Location header.`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new ToolCallError("too_many_redirects", `Stopped after ${MAX_REDIRECTS} redirects while fetching ${start.href}.`);
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new ToolCallError("redirect_error", "Redirect Location was not a valid URL.");
      }
      current = await assertSafeHttpUrl(next.href, options.safeOptions);
      continue;
    }
    const body = await readBodyLimited(response, options.maxBytes);
    return {
      finalUrl: current.href,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bytes: body.bytes,
      byteTruncated: body.truncated,
    };
  }
  throw new ToolCallError("too_many_redirects", `Stopped after ${MAX_REDIRECTS} redirects while fetching ${start.href}.`);
}

function classify(contentType: string, bytes: Uint8Array): "html" | "text" | "binary" {
  const base = mediaType(contentType);
  if (base === "text/html" || base === "application/xhtml+xml") return "html";
  if (isTextualType(base)) return "text";
  if (!base || base === "application/octet-stream") {
    if (looksBinary(bytes)) return "binary";
    const sample = decodeBody(bytes.subarray(0, 256), contentType).trimStart();
    return sample.startsWith("<") ? "html" : "text";
  }
  return "binary";
}

function isTextualType(base: string): boolean {
  if (!base) return false;
  if (base.startsWith("text/")) return true;
  if (base === "application/json" || base === "application/ld+json" || base === "application/xml" || base === "application/javascript") {
    return true;
  }
  return base.endsWith("+json") || base.endsWith("+xml");
}

function formatPlain(text: string, contentType: string): string {
  const base = mediaType(contentType);
  if (base.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text.trim();
    }
  }
  return text.trim();
}

function renderFetchResult(input: {
  title: string;
  finalUrl: string;
  body: string;
  byteTruncated: boolean;
  charTruncated: boolean;
  maxChars: number;
}): string {
  const sections: string[] = [];
  const heading = input.title.trim();
  const alreadyTitled = heading.length > 0 && (input.body.startsWith(`# ${heading}\n`) || input.body === `# ${heading}`);
  if (heading && !alreadyTitled) sections.push(`# ${heading}`);
  sections.push(`Source: ${input.finalUrl}`);
  sections.push(input.body.trim() || "(No readable text on this page.)");
  if (input.byteTruncated) sections.push("[Response body was cut off because it exceeded the byte limit.]");
  if (input.charTruncated) sections.push(`[Content truncated to ${input.maxChars} characters.]`);
  return sections.join("\n\n");
}
