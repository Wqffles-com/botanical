import { readFileSync, statSync } from "node:fs";

import { McpConfigError } from "./errors.js";
import type { McpLogger } from "./logger.js";
import { silentLogger } from "./logger.js";
import { assertServerId } from "./names.js";
import type { McpFileConfig, McpServerConfig } from "./types.js";

const MAX_CONFIG_BYTES = 1_000_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

const FILE_CANDIDATES = ["config/mcp.json", "mcp.json", "botanical.mcp.json"] as const;

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export interface McpTimeouts {
  connectTimeoutMs: number;
  toolTimeoutMs: number;
}

export interface LoadedMcpConfig {
  disabled: boolean;
  source: "disabled" | "env" | "file" | "empty";
  configPath?: string;
  servers: McpServerConfig[];
  timeouts: McpTimeouts;
}

export interface LoadMcpConfigOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Explicit file path. Overrides BOTANICAL_MCP_CONFIG. */
  configPath?: string;
  logger?: McpLogger;
}

export function loadMcpConfig(options: LoadMcpConfigOptions = {}): LoadedMcpConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? silentLogger;
  const timeouts = readTimeouts(env);

  if (isDisabled(env.BOTANICAL_MCP_DISABLED)) {
    return { disabled: true, source: "disabled", servers: [], timeouts };
  }

  const explicitPath = options.configPath ?? env.BOTANICAL_MCP_CONFIG;
  const file = readConfigFile(explicitPath, cwd);
  const envServersRaw = env.BOTANICAL_MCP_SERVERS;

  if (envServersRaw !== undefined && envServersRaw.trim() !== "") {
    if (file) {
      logger.warn("BOTANICAL_MCP_SERVERS overrides the MCP config file", { configPath: file.path });
    }
    const servers = parseServers(parseJson(envServersRaw, "BOTANICAL_MCP_SERVERS"), "BOTANICAL_MCP_SERVERS");
    return {
      disabled: false,
      source: "env",
      ...(file ? { configPath: file.path } : {}),
      servers: servers.map((server) => interpolateServer(server, env)),
      timeouts,
    };
  }

  if (file) {
    const servers = parseServers(parseJson(file.text, file.path), file.path);
    return {
      disabled: false,
      source: "file",
      configPath: file.path,
      servers: servers.map((server) => interpolateServer(server, env)),
      timeouts,
    };
  }

  return { disabled: false, source: "empty", servers: [], timeouts };
}

function isDisabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new McpConfigError(
    `BOTANICAL_MCP_DISABLED must be true/false, 1/0, yes/no, or on/off. Received "${value}".`,
  );
}

function readTimeouts(env: NodeJS.ProcessEnv): McpTimeouts {
  return {
    connectTimeoutMs: readPositiveInt(env.BOTANICAL_MCP_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS, "BOTANICAL_MCP_CONNECT_TIMEOUT_MS"),
    toolTimeoutMs: readPositiveInt(env.BOTANICAL_MCP_TOOL_TIMEOUT_MS, DEFAULT_TOOL_TIMEOUT_MS, "BOTANICAL_MCP_TOOL_TIMEOUT_MS"),
  };
}

function readPositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new McpConfigError(`${name} must be a positive integer. Received "${raw}".`);
  }
  return value;
}

function readConfigFile(explicitPath: string | undefined, cwd: string): { path: string; text: string } | undefined {
  if (explicitPath !== undefined && explicitPath.trim() !== "") {
    const path = resolvePath(explicitPath, cwd);
    return { path, text: readBounded(path) };
  }
  for (const relative of FILE_CANDIDATES) {
    const path = resolvePath(relative, cwd);
    try {
      statSync(path);
    } catch {
      continue;
    }
    return { path, text: readBounded(path) };
  }
  return undefined;
}

function resolvePath(path: string, cwd: string): string {
  if (path.startsWith("/")) return path;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

function readBounded(path: string): string {
  let text: string;
  try {
    const size = statSync(path).size;
    if (size > MAX_CONFIG_BYTES) {
      throw new McpConfigError(`MCP config ${path} exceeds ${MAX_CONFIG_BYTES} bytes.`);
    }
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof McpConfigError) throw error;
    throw new McpConfigError(`Cannot read MCP config ${path}: ${errorMessage(error)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new McpConfigError(`MCP config ${label} is not valid JSON: ${errorMessage(error)}`);
  }
}

function parseServers(value: unknown, label: string): McpServerConfig[] {
  if (Array.isArray(value)) {
    return dedupeServers(
      value.map((entry, index) => parseServer(entry, `${label}[${index}]`)),
      label,
    );
  }
  if (!isRecord(value)) {
    throw new McpConfigError(
      `${label} must be {"mcpServers": {...}}, {"servers": [...]}, or a JSON array of servers.`,
    );
  }
  const hasServers = Object.prototype.hasOwnProperty.call(value, "servers");
  const hasClaude = Object.prototype.hasOwnProperty.call(value, "mcpServers");
  if (!hasServers && !hasClaude) {
    throw new McpConfigError(
      `${label} must be {"mcpServers": {...}}, {"servers": [...]}, or a JSON array of servers.`,
    );
  }

  const collected: McpServerConfig[] = [];
  if (hasServers) {
    if (!Array.isArray(value.servers)) {
      throw new McpConfigError(`${label}.servers must be an array.`);
    }
    value.servers.forEach((entry, index) => {
      collected.push(parseServer(entry, `${label}.servers[${index}]`));
    });
  }
  if (hasClaude) {
    collected.push(...parseClaudeServers(value.mcpServers, `${label}.mcpServers`));
  }
  return dedupeServers(collected, label);
}

/**
 * Claude Desktop config: `{ "mcpServers": { "<id>": { "command", "args" } | { "type", "url" } } }`.
 * `type` / `transport` may be stdio, http, sse, or streamable-http. Omitted type
 * means stdio when `command` is set, and streamable HTTP when only `url` is set.
 */
function parseClaudeServers(value: unknown, label: string): McpServerConfig[] {
  if (!isRecord(value)) {
    throw new McpConfigError(`${label} must be an object keyed by server id.`);
  }
  return Object.entries(value).map(([id, entry]) => parseClaudeServer(id, entry, `${label}.${id}`));
}

function parseClaudeServer(id: string, value: unknown, label: string): McpServerConfig {
  if (!isRecord(value)) throw new McpConfigError(`${label} must be an object.`);
  const transport = inferClaudeTransport(value, label);
  const enabled = readClaudeEnabled(value, label);
  const normalized: Record<string, unknown> = {
    id,
    transport,
    ...(enabled !== undefined ? { enabled } : {}),
  };
  if (value.timeoutMs !== undefined) normalized.timeoutMs = value.timeoutMs;
  if (value.connectTimeoutMs !== undefined) normalized.connectTimeoutMs = value.connectTimeoutMs;

  if (transport === "stdio") {
    if (typeof value.command !== "string") {
      throw new McpConfigError(`${label}.command is required for stdio.`);
    }
    normalized.command = value.command;
    if (value.args !== undefined) {
      if (!Array.isArray(value.args)) throw new McpConfigError(`${label}.args must be an array of strings.`);
      normalized.args = value.args;
    }
    if (value.env !== undefined) normalized.env = value.env;
    if (value.cwd !== undefined) normalized.cwd = value.cwd;
  } else {
    if (typeof value.url !== "string") {
      throw new McpConfigError(`${label}.url is required for ${transport}.`);
    }
    normalized.url = value.url;
    if (value.headers !== undefined) normalized.headers = value.headers;
    if (transport === "http" && value.sseFallback !== undefined) normalized.sseFallback = value.sseFallback;
  }
  return parseServer(normalized, label);
}

function inferClaudeTransport(value: Record<string, unknown>, label: string): "stdio" | "http" | "sse" {
  const raw = value.type ?? value.transport;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      return normalizeTransport(raw, label);
    } catch (error) {
      if (value.type !== undefined && value.transport === undefined) {
        throw new McpConfigError(
          `${label}.type must be "stdio", "http", "sse", or "streamable-http". Received "${raw}".`,
        );
      }
      throw error;
    }
  }
  if (raw !== undefined) {
    throw new McpConfigError(`${label}.type must be "stdio", "http", or "sse".`);
  }
  const hasCommand = typeof value.command === "string" && value.command.trim() !== "";
  const hasUrl = typeof value.url === "string" && value.url.trim() !== "";
  if (hasCommand && hasUrl) {
    throw new McpConfigError(`${label} sets both command and url. Set type to "stdio", "http", or "sse".`);
  }
  if (hasCommand) return "stdio";
  if (hasUrl) return "http";
  throw new McpConfigError(`${label} needs a command for stdio or a url for http/sse.`);
}

function readClaudeEnabled(value: Record<string, unknown>, label: string): boolean | undefined {
  const hasEnabled = value.enabled !== undefined;
  const hasDisabled = value.disabled !== undefined;
  if (hasEnabled && hasDisabled) {
    throw new McpConfigError(`${label} cannot set both enabled and disabled.`);
  }
  if (hasEnabled) return requiredBoolean(value.enabled, `${label}.enabled`);
  if (hasDisabled) return !requiredBoolean(value.disabled, `${label}.disabled`);
  return undefined;
}

function dedupeServers(servers: McpServerConfig[], label: string): McpServerConfig[] {
  const seen = new Set<string>();
  for (const server of servers) {
    if (seen.has(server.id)) {
      throw new McpConfigError(`Duplicate MCP server id "${server.id}" in ${label}.`);
    }
    seen.add(server.id);
  }
  return servers;
}

function parseServer(value: unknown, label: string): McpServerConfig {
  if (!isRecord(value)) throw new McpConfigError(`${label} must be an object.`);
  const id = requiredString(value.id, `${label}.id`);
  try {
    assertServerId(id);
  } catch (error) {
    throw new McpConfigError(errorMessage(error));
  }
  const transport = normalizeTransport(requiredString(value.transport, `${label}.transport`), label);
  const base = {
    id,
    ...optionalBoolean(value.enabled, `${label}.enabled`),
    ...optionalTimeout(value.timeoutMs, `${label}.timeoutMs`),
    ...optionalConnectTimeout(value.connectTimeoutMs, `${label}.connectTimeoutMs`),
  };

  if (transport === "stdio") {
    const command = requiredString(value.command, `${label}.command`);
    return {
      ...base,
      transport,
      command,
      ...(Array.isArray(value.args) ? { args: value.args.map((arg, i) => requiredString(arg, `${label}.args[${i}]`)) } : {}),
      ...(isRecord(value.env) ? { env: stringMap(value.env, `${label}.env`) } : {}),
      ...(value.cwd !== undefined ? { cwd: requiredString(value.cwd, `${label}.cwd`) } : {}),
    };
  }

  const url = requiredString(value.url, `${label}.url`);
  assertHttpUrl(url, `${label}.url`);
  const remote = {
    ...base,
    url,
    ...(isRecord(value.headers) ? { headers: stringMap(value.headers, `${label}.headers`) } : {}),
  };
  if (transport === "sse") return { ...remote, transport: "sse" };
  return {
    ...remote,
    transport: "http",
    ...(value.sseFallback !== undefined ? { sseFallback: requiredBoolean(value.sseFallback, `${label}.sseFallback`) } : {}),
  };
}

function normalizeTransport(value: string, label: string): "stdio" | "http" | "sse" {
  if (value === "streamable-http" || value === "streamable_http") return "http";
  if (value === "stdio" || value === "http" || value === "sse") return value;
  throw new McpConfigError(`${label}.transport must be "stdio", "http", or "sse". Received "${value}".`);
}

function optionalBoolean(value: unknown, label: string): { enabled?: boolean } {
  if (value === undefined) return {};
  return { enabled: requiredBoolean(value, label) };
}

function optionalTimeout(value: unknown, label: string): { timeoutMs?: number } {
  if (value === undefined) return {};
  return { timeoutMs: requiredPositiveInt(value, label) };
}

function optionalConnectTimeout(value: unknown, label: string): { connectTimeoutMs?: number } {
  if (value === undefined) return {};
  return { connectTimeoutMs: requiredPositiveInt(value, label) };
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new McpConfigError(`${label} must be a boolean.`);
  return value;
}

function requiredPositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new McpConfigError(`${label} must be a positive integer.`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpConfigError(`${label} must be a non-empty string.`);
  }
  return value;
}

function stringMap(value: Record<string, unknown>, label: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner !== "string") throw new McpConfigError(`${label}.${key} must be a string.`);
    out[key] = inner;
  }
  return out;
}

function assertHttpUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpConfigError(`${label} is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new McpConfigError(`${label} must use http or https. Received "${url.protocol}".`);
  }
}

function interpolateServer(server: McpServerConfig, env: NodeJS.ProcessEnv): McpServerConfig {
  const missing: string[] = [];
  const next: McpServerConfig = { ...server };
  if (next.transport === "stdio") {
    next.command = interpolate(next.command, env, missing);
    if (next.args) next.args = next.args.map((arg) => interpolate(arg, env, missing));
    if (next.env) next.env = mapValues(next.env, (value) => interpolate(value, env, missing));
    if (next.cwd) next.cwd = interpolate(next.cwd, env, missing);
  } else {
    next.url = interpolate(next.url, env, missing);
    if (next.headers) next.headers = mapValues(next.headers, (value) => interpolate(value, env, missing));
    assertHttpUrl(next.url, `server ${server.id} url`);
  }
  if (missing.length > 0) {
    const names = [...new Set(missing)].join(", ");
    throw new McpConfigError(`MCP server "${server.id}" references unset environment variables: ${names}.`);
  }
  return next;
}

function interpolate(input: string, env: NodeJS.ProcessEnv, missing: string[]): string {
  return input.replace(PLACEHOLDER, (_full, name: string, defaultValue: string | undefined) => {
    const value = env[name];
    if (value !== undefined) return value;
    if (defaultValue !== undefined) return defaultValue;
    missing.push(name);
    return "";
  });
}

function mapValues(record: Record<string, string>, fn: (value: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[key] = fn(value);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shape check used by tests and by callers that already parsed JSON. */
export function parseMcpFileConfig(value: unknown, label = "mcp config"): McpFileConfig {
  return { servers: parseServers(value, label) };
}
