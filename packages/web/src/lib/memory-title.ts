const MAX_TITLE = 80;

/**
 * Short label for a collapsed memory row. Memories have no title field, so this
 * is the first non-empty line of the content, without Markdown heading or list
 * markers, cut to fit one line.
 */
export function memoryTitle(content: string): string {
  const line = content
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find((row) => row.length > 0);
  if (!line) return "Untitled memory";
  const text = line.replace(/^(#{1,6}\s+|[-*+]\s+|>\s+)/, "").trim() || line;
  if (text.length <= MAX_TITLE) return text;
  return `${text.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

