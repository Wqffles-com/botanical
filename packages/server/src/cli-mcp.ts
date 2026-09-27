import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  collectTools,
  dispatchToolCall,
  toolAccess,
  toolResultToContent,
  type AgentRecord,
  type ListedTool,
  type RuntimeDeps,
  type ToolResult,
} from "@botanical/agent-runtime";
import { parseToolName, providerToolName } from "@botanical/mcp";
import type { CliToolCallEvent, CliToolEventSource } from "@botanical/providers";

import type { ServerConfig } from "./config.ts";
import { HttpError, isRecord, json, readJson } from "./http.ts";
import type { Router } from "./router.ts";

/**
 * Per-run streamable HTTP MCP endpoint. Not a public API route and not
 * accepted with the session cookie — only the run's bearer token.
 * v0 has one operator and no tenant id, so the principal is `"local"`.
 */
export const CLI_MCP_PATH = "/internal/mcp/runs";

const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL = "2025-03-26";
const PRINCIPAL = "local";

interface ToolRun {
  runId: string;
  token: string;
  agentId: string;
  chatId: string;
  principal: typeof PRINCIPAL;
  signal?: AbortSignal;
  listeners: Set<(event: CliToolCallEvent) => void>;
}

export interface CliToolSession {
  runId: string;
  token: string;
  url: string;
  events: CliToolEventSource;
  close(): void;
}

export interface CliToolHost {
  open(input: { agentId: string; chatId: string; signal?: AbortSignal }): CliToolSession;
  size(): number;
  handle(request: Request, runId: string, config: ServerConfig): Promise<Response>;
}

export function internalMcpBaseUrl(port: number, env: Record<string, string | undefined> = process.env): string {
  const configured = env.BOTANICAL_INTERNAL_URL?.trim();
  if (!configured) return `http://127.0.0.1:${port}`;
  return configured.replace(/\/$/, "");
}

export function createCliToolHost(options: {
  getDeps: () => RuntimeDeps;
  port: number;
  env?: Record<string, string | undefined>;
}): CliToolHost {
  const runs = new Map<string, ToolRun>();

  return {
    open(input) {
      const runId = randomUUID();
      const token = randomBytes(32).toString("base64url");
      const run: ToolRun = {
        runId,
        token,
        agentId: input.agentId,
        chatId: input.chatId,
        principal: PRINCIPAL,
        ...(input.signal ? { signal: input.signal } : {}),
        listeners: new Set(),
      };
      runs.set(runId, run);
      const base = internalMcpBaseUrl(options.port, {
        ...options.env,
        ...(process.env.BOTANICAL_INTERNAL_URL ? { BOTANICAL_INTERNAL_URL: process.env.BOTANICAL_INTERNAL_URL } : {}),
      });
      return {
        runId,
        token,
        url: `${base}${CLI_MCP_PATH}/${runId}`,
        events: {
          subscribe(listener) {
            run.listeners.add(listener);
            return () => run.listeners.delete(listener);
          },
        },
        close() {
          run.listeners.clear();
          runs.delete(runId);
        },
      };
    },
    size() {
      return runs.size;
    },
    handle(request, runId, config) {
      return handleRun(options.getDeps, runs, request, runId, config);
    },
  };
}

export function registerCliMcp(router: Router, host: CliToolHost): void {
  const handle = (ctx: { request: Request; params: Readonly<Record<string, string>>; config: ServerConfig }) =>
    host.handle(ctx.request, ctx.params.runId ?? "", ctx.config);
  router.add("POST", `${CLI_MCP_PATH}/:runId`, handle);
  router.add("GET", `${CLI_MCP_PATH}/:runId`, handle);
  router.add("DELETE", `${CLI_MCP_PATH}/:runId`, handle);
}

async function handleRun(
  getDeps: () => RuntimeDeps,
  runs: Map<string, ToolRun>,
  request: Request,
  runId: string,
  config: ServerConfig,
): Promise<Response> {
  const auth = authorize(runs, request, runId);
  if (auth instanceof Response) return auth;
  if (request.method === "GET" || request.method === "DELETE") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }
  let body: unknown;
  try {
    body = await readJson(request, config);
  } catch (error) {
    if (error instanceof HttpError) return rpcError(error.status, null, -32700, error.message);
    throw error;
  }
  if (!isRecord(body)) return rpcError(400, null, -32600, "Invalid Request");
  const method = typeof body.method === "string" ? body.method : "";
  const id = "id" in body ? body.id : undefined;
  if (!method) return rpcError(400, id, -32600, "Invalid Request");
  if (method.startsWith("notifications/")) return new Response(null, { status: 202 });

  try {
    if (method === "initialize") {
      const params = isRecord(body.params) ? body.params : {};
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "botanical", version: "0.1.0" },
      });
    }
    if (method === "ping") return rpcResult(id, {});
    if (method === "tools/list") return rpcResult(id, { tools: await listTools(getDeps(), auth) });
    if (method === "tools/call") return rpcResult(id, await callTool(getDeps(), auth, body.params));
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Tool host failed";
    return rpcError(200, id, -32603, message);
  }
  return rpcError(200, id, -32601, `Method not found: ${method}`);
}

function authorize(runs: Map<string, ToolRun>, request: Request, runId: string): ToolRun | Response {
  const run = runs.get(runId);
  if (!run) return rpcError(404, null, -32001, "Not found");
  const token = bearer(request.headers.get("authorization"));
  if (!token || !bearerMatches(run.token, token)) return rpcError(401, null, -32001, "Unauthorized");
  return run;
}

/** Authorization header only. A session cookie is not a run token. */
function bearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function bearerMatches(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

async function listTools(deps: RuntimeDeps, run: ToolRun): Promise<Array<Record<string, unknown>>> {
  const agent = await deps.store.agents.get(run.agentId);
  if (!agent) return [];
  const catalog = await collectTools(deps.toolSources);
  const visible = catalog.filter((tool) => toolAccess(agent, tool).ok);
  const names = facingNames(visible);
  return visible.map((tool) => ({
    name: names.get(tool.name) ?? tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}

async function callTool(deps: RuntimeDeps, run: ToolRun, params: unknown): Promise<Record<string, unknown>> {
  const record = isRecord(params) ? params : {};
  const requested = typeof record.name === "string" ? record.name : "";
  if (!requested) {
    return toolError("tool name is required");
  }
  const agent = await deps.store.agents.get(run.agentId);
  if (!agent) return toolError("agent not found");
  const catalog = await collectTools(deps.toolSources);
  const resolved = resolveToolName(agent, catalog, requested);
  const result = await dispatchToolCall(
    deps,
    agent,
    catalog,
    { name: resolved, arguments: record.arguments ?? {} },
    { agentId: run.agentId, chatId: run.chatId, ...(run.signal ? { signal: run.signal } : {}) },
  );
  emit(run, {
    type: "tool-call",
    id: randomUUID(),
    name: requested,
    arguments: record.arguments ?? {},
    output: result.output,
    isError: result.isError === true,
  });
  return toolPayload(result);
}

function emit(run: ToolRun, event: CliToolCallEvent): void {
  for (const listener of run.listeners) {
    try {
      listener(event);
    } catch {
      // The chat stream must not fail the CLI's tool call.
    }
  }
}

function resolveToolName(agent: AgentRecord, catalog: readonly ListedTool[], requested: string): string {
  if (catalog.some((tool) => tool.name === requested)) return requested;
  const visible = catalog.filter((tool) => toolAccess(agent, tool).ok);
  const fromVisible = invert(facingNames(visible)).get(requested);
  if (fromVisible) return fromVisible;
  return invert(facingNames(catalog)).get(requested) ?? requested;
}

function facingNames(tools: readonly ListedTool[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const tool of tools) {
    let name = modelFacingName(tool);
    if (used.has(name)) {
      let suffix = 2;
      while (used.has(`${name}_${suffix}`)) suffix += 1;
      name = `${name}_${suffix}`;
    }
    used.add(name);
    names.set(tool.name, name);
  }
  return names;
}

function modelFacingName(tool: ListedTool): string {
  const parsed = parseToolName(tool.name);
  if (!parsed) return tool.name;
  return providerToolName(parsed.serverId, parsed.toolName);
}

function invert(names: Map<string, string>): Map<string, string> {
  const reversed = new Map<string, string>();
  for (const [catalogName, facing] of names) reversed.set(facing, catalogName);
  return reversed;
}

function toolPayload(result: ToolResult): Record<string, unknown> {
  return {
    content: [{ type: "text", text: toolResultToContent(result) }],
    isError: result.isError === true,
  };
}

function toolError(text: string): Record<string, unknown> {
  return { content: [{ type: "text", text }], isError: true };
}

function rpcResult(id: unknown, result: unknown): Response {
  return json(200, { jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(status: number, id: unknown, code: number, message: string): Response {
  return json(status, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}
