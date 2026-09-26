export interface McpLogger {
  debug?(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const SENSITIVE_KEY = /authorization|api[-_]?key|secret|password|token|credential|cookie/i;

/** Drop values operators should not see in logs. Keys are kept so the field is visible. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
  }
  return out;
}

function write(level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>): void {
  const payload = fields ? ` ${JSON.stringify(redact(fields))}` : "";
  const line = `[botanical-mcp] ${message}${payload}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const consoleLogger: McpLogger = {
  info: (message, fields) => write("info", message, fields),
  warn: (message, fields) => write("warn", message, fields),
  error: (message, fields) => write("error", message, fields),
};

export const silentLogger: McpLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
