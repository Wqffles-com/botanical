export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export function parseBraveResults(payload: unknown): SearchHit[] {
  const web = asRecord(asRecord(payload)?.web);
  return mapRows(web?.results, (row) => ({
    title: asString(row.title),
    url: asString(row.url),
    snippet: asString(row.description),
  }));
}

export function parseTavilyResults(payload: unknown): SearchHit[] {
  return mapRows(asRecord(payload)?.results, (row) => ({
    title: asString(row.title),
    url: asString(row.url),
    snippet: asString(row.content),
  }));
}

export function parseSerperResults(payload: unknown): SearchHit[] {
  return mapRows(asRecord(payload)?.organic, (row) => ({
    title: asString(row.title),
    url: asString(row.link),
    snippet: asString(row.snippet),
  }));
}

export function parseSearxngResults(payload: unknown): SearchHit[] {
  return mapRows(asRecord(payload)?.results, (row) => ({
    title: asString(row.title),
    url: asString(row.url),
    snippet: asString(row.content),
  }));
}

function mapRows(
  list: unknown,
  pick: (row: Record<string, unknown>) => { title?: string; url?: string; snippet?: string },
): SearchHit[] {
  if (!Array.isArray(list)) return [];
  const hits: SearchHit[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const picked = pick(row);
    const url = httpUrl(picked.url);
    if (!url) continue;
    hits.push({
      title: picked.title ?? url,
      url,
      snippet: picked.snippet ?? "",
    });
  }
  return hits;
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
