/**
 * Pull incremental text out of grok, Claude Code, and Codex JSONL streams.
 * Non-JSON lines are plain stdout. Recognized status events are ignored so
 * protocol noise does not enter the chat. A final assistant message is
 * returned only for the caller to use when no deltas were seen.
 */

export type ParsedCliLine =
  | { kind: "delta"; text: string }
  | { kind: "final"; text: string }
  | { kind: "ignore" }
  | { kind: "plain"; text: string };

export function parseCliLine(line: string): ParsedCliLine {
  const trimmed = line.trim();
  if (!trimmed) return { kind: "ignore" };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: "plain", text: `${line.replace(/\r$/, "")}\n` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (typeof value === "string" && value.length > 0) return { kind: "plain", text: value };
    return { kind: "plain", text: `${trimmed}\n` };
  }
  const extracted = extractEvent(value as Record<string, unknown>);
  return extracted ?? { kind: "ignore" };
}

function extractEvent(value: Record<string, unknown>): ParsedCliLine | null {
  const delta = textDelta(value);
  if (delta) return { kind: "delta", text: delta };
  const nested = nestedRecords(value);
  for (const record of nested) {
    const inner = textDelta(record);
    if (inner) return { kind: "delta", text: inner };
  }
  const finalText = finalMessage(value);
  if (finalText) return { kind: "final", text: finalText };
  for (const record of nested) {
    const inner = finalMessage(record);
    if (inner) return { kind: "final", text: inner };
  }
  return null;
}

function nestedRecords(value: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const key of ["event", "update", "params", "payload", "item", "message", "msg", "delta"]) {
    const child = value[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      out.push(child as Record<string, unknown>);
      const grandchild = (child as Record<string, unknown>).update;
      if (grandchild && typeof grandchild === "object" && !Array.isArray(grandchild)) {
        out.push(grandchild as Record<string, unknown>);
      }
      const content = (child as Record<string, unknown>).content;
      if (content && typeof content === "object" && !Array.isArray(content)) {
        out.push(content as Record<string, unknown>);
      }
    }
  }
  return out;
}

function textDelta(value: Record<string, unknown>): string | null {
  const type = stringField(value, "type");
  const sessionUpdate = stringField(value, "sessionUpdate");
  if (type === "content_block_delta" || type === "stream_event") {
    const delta = asRecord(value.delta) ?? asRecord(value.event);
    if (delta) {
      const fromDelta = deltaText(delta);
      if (fromDelta) return fromDelta;
    }
  }
  if (type === "agent_message_chunk" || sessionUpdate === "agent_message_chunk") {
    return textFromContent(value.content) ?? stringField(value, "text");
  }
  const delta = asRecord(value.delta);
  if (delta) {
    const fromDelta = deltaText(delta);
    if (fromDelta) return fromDelta;
  }
  return null;
}

function deltaText(delta: Record<string, unknown>): string | null {
  const type = stringField(delta, "type");
  if (type === "thinking_delta" || type === "signature_delta") return null;
  if (type === "text_delta" || type === "input_json_delta") {
    if (type === "input_json_delta") return null;
    return stringField(delta, "text");
  }
  if (stringField(delta, "type") === "text_delta") return stringField(delta, "text");
  const nested = asRecord(delta.delta);
  if (nested && stringField(nested, "type") === "text_delta") return stringField(nested, "text");
  return null;
}

function finalMessage(value: Record<string, unknown>): string | null {
  const type = stringField(value, "type");
  if (type === "assistant") {
    const message = asRecord(value.message) ?? value;
    return joinTextBlocks(message.content ?? value.content);
  }
  if (type === "item.completed" || type === "item.updated") {
    const item = asRecord(value.item);
    if (!item) return null;
    const itemType = stringField(item, "type");
    if (itemType !== "agent_message" && itemType !== "message") return null;
    if (type === "item.updated") return null;
    return stringField(item, "text") ?? stringField(item, "message") ?? joinTextBlocks(item.content);
  }
  const msg = asRecord(value.msg);
  if (msg && (stringField(msg, "type") === "agent_message" || stringField(msg, "type") === "text")) {
    return stringField(msg, "message") ?? stringField(msg, "text") ?? stringField(msg, "content");
  }
  if (type === "agent_message" || type === "text") {
    return stringField(value, "text") ?? stringField(value, "message") ?? joinTextBlocks(value.content);
  }
  if (type === "result") {
    return stringField(value, "result");
  }
  return null;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  const record = asRecord(content);
  if (!record) return joinTextBlocks(content);
  if (stringField(record, "type") === "text") return stringField(record, "text");
  return joinTextBlocks(content);
}

function joinTextBlocks(content: unknown): string | null {
  if (typeof content === "string" && content.length > 0) return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (!record) continue;
    const type = stringField(record, "type");
    if (type && type !== "text") continue;
    const text = stringField(record, "text");
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join("") : null;
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
