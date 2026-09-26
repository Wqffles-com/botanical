import type { AgentToolResult, JsonObject } from "./types.js";

const MAX_TOOL_RESULT_CHARS = 100_000;

interface ContentBlock {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string; blob?: string; mimeType?: string };
}

export interface RawToolResult {
  content?: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Turn an MCP tools/call result into text the model can read. */
export function formatToolResult(result: RawToolResult): AgentToolResult {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    const rendered = renderBlock(block);
    if (rendered) parts.push(rendered);
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(safeJson(result.structuredContent));
  }
  const text = parts.join("\n").trim();
  const content = cap(text.length > 0 ? text : "(empty tool result)");
  return {
    ok: !result.isError,
    isError: Boolean(result.isError),
    content,
    ...(result.structuredContent !== undefined ? { structured: result.structuredContent } : {}),
  };
}

export function parseToolArguments(raw: unknown): { ok: true; value: JsonObject } | { ok: false; error: string } {
  let value = raw;
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return { ok: true, value: {} };
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return { ok: false, error: "Tool arguments are not valid JSON." };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Tool arguments must be a JSON object." };
  }
  return { ok: true, value: value as JsonObject };
}

function renderBlock(block: ContentBlock): string {
  if (block.type === "text" && typeof block.text === "string") return block.text;
  if (block.type === "image") return `[image ${block.mimeType ?? "unknown"}]`;
  if (block.type === "audio") return `[audio ${block.mimeType ?? "unknown"}]`;
  if (block.type === "resource" || block.resource) {
    const resource = block.resource;
    if (!resource) return "[resource]";
    if (typeof resource.text === "string") return resource.text;
    return `[resource ${resource.uri ?? ""} ${resource.mimeType ?? ""}]`.trim();
  }
  if (block.type) return `[${block.type} content]`;
  return "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable structured content]";
  }
}

function cap(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated]`;
}

export function errorResult(content: string): AgentToolResult {
  return { ok: false, isError: true, content };
}

export function textResult(content: string): AgentToolResult {
  return { ok: true, content };
}
