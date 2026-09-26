/**
 * Turn-start memory selection. Recent items are always considered, then
 * keyword overlap with the latest user message fills the rest. The section
 * is capped so a long store cannot blow the system prompt.
 */

export interface MemorySnippet {
  id: string;
  scope: "shared" | "agent";
  content: string;
  tags: string[];
  updatedAt: string;
}

const DEFAULT_RECENT = 4;
const DEFAULT_LIMIT = 8;
const DEFAULT_MAX_CHARS = 4_000;

export function selectMemories(
  items: readonly MemorySnippet[],
  query: string,
  options?: { recent?: number; limit?: number; maxChars?: number },
): MemorySnippet[] {
  const recent = options?.recent ?? DEFAULT_RECENT;
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const sorted = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const keywords = tokenize(query);
  const picked: MemorySnippet[] = [];
  const seen = new Set<string>();
  for (const item of sorted.slice(0, recent)) {
    picked.push(item);
    seen.add(item.id);
  }
  const ranked = sorted
    .filter((item) => !seen.has(item.id))
    .map((item) => ({ item, score: overlapScore(item, keywords) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt));
  for (const row of ranked) {
    if (picked.length >= limit) break;
    picked.push(row.item);
    seen.add(row.item.id);
  }
  const bounded: MemorySnippet[] = [];
  let used = 0;
  for (const item of picked) {
    const next = used + item.content.length;
    if (bounded.length > 0 && next > maxChars) break;
    bounded.push(item);
    used = next;
    if (used >= maxChars) break;
  }
  return bounded;
}

export function renderMemorySection(items: readonly MemorySnippet[]): string {
  if (items.length === 0) return "";
  const lines = [
    "## Memories",
    "Relevant memories for this turn. Shared memories are visible to every agent. Agent memories are private to you.",
  ];
  for (const item of items) {
    const tags = item.tags.length > 0 ? ` (tags: ${item.tags.join(", ")})` : "";
    lines.push(`- [${item.scope}]${tags} ${item.content}`);
  }
  return lines.join("\n");
}

function tokenize(value: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || seen.has(raw)) continue;
    seen.add(raw);
    words.push(raw);
  }
  return words;
}

function overlapScore(item: MemorySnippet, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = `${item.content} ${item.tags.join(" ")}`.toLowerCase();
  let score = 0;
  for (const word of keywords) {
    if (haystack.includes(word)) score += 1;
  }
  return score;
}
