import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport, type SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { McpServerError } from "./errors.js";
import type { RawToolResult } from "./format.js";
import { formatToolResult } from "./format.js";
import type { McpLogger } from "./logger.js";
import { canonicalToolName, providerToolName, PROVIDER_TOOL_NAME_MAX } from "./names.js";
import type { AgentToolResult, JsonObject, McpServerConfig, McpServerStatus, McpToolInfo } from "./types.js";

const CLIENT_INFO = { name: "botanical", version: "0.1.0" };
const MAX_TOOL_PAGES = 100;
const EMPTY_SCHEMA: JsonObject = { type: "object", properties: {} };

interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  title?: string;
}

/**
 * One configured MCP server. A failed server stays in `error` so the rest of
 * the runtime can keep serving tools from servers that did connect.
 */
export class McpConnection {
  private client: Client | undefined;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | undefined;
  private tools: McpToolInfo[] = [];
  private state: McpServerStatus["state"];
  private error: string | undefined;
  private serverName: string | undefined;
  private serverVersion: string | undefined;
  private instructions: string | undefined;
  private connectPromise: Promise<void> | undefined;

  constructor(
    readonly config: McpServerConfig,
    private readonly logger: McpLogger,
    private readonly defaultConnectTimeoutMs: number,
    private readonly defaultToolTimeoutMs: number,
  ) {
    this.state = config.enabled === false ? "disabled" : "closed";
  }

  status(): McpServerStatus {
    return {
      id: this.config.id,
      transport: this.config.transport,
      state: this.state,
      toolCount: this.tools.length,
      ...(this.serverName ? { serverName: this.serverName } : {}),
      ...(this.serverVersion ? { serverVersion: this.serverVersion } : {}),
      ...(this.instructions ? { instructions: this.instructions } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  listTools(): McpToolInfo[] {
    return this.tools;
  }

  async connect(): Promise<void> {
    if (this.config.enabled === false) {
      this.state = "disabled";
      return;
    }
    if (this.state === "ready") return;
    if (!this.connectPromise) {
      this.connectPromise = this.connectOnce().finally(() => {
        this.connectPromise = undefined;
      });
    }
    await this.connectPromise;
  }

  async call(toolName: string, args: JsonObject, options: { signal?: AbortSignal; timeoutMs?: number }): Promise<AgentToolResult> {
    if (this.state !== "ready" || !this.client) {
      try {
        await this.connect();
      } catch (error) {
        return formatToolResult({
          isError: true,
          content: [{ type: "text", text: errorMessage(error) }],
        });
      }
    }
    if (!this.client || this.state !== "ready") {
      return formatToolResult({
        isError: true,
        content: [{ type: "text", text: this.error ?? `MCP server "${this.config.id}" is not connected.` }],
      });
    }
    const timeout = options.timeoutMs ?? this.config.timeoutMs ?? this.defaultToolTimeoutMs;
    try {
      const result = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout, ...(options.signal ? { signal: options.signal } : {}) },
      );
      return formatToolResult(result as RawToolResult);
    } catch (error) {
      if (options.signal?.aborted) {
        return formatToolResult({ isError: true, content: [{ type: "text", text: "Tool call aborted." }] });
      }
      this.logger.error("MCP tool call failed", { serverId: this.config.id, tool: toolName, error: errorMessage(error) });
      if (isConnectionFailure(error)) {
        await this.failAndReset(error);
        try {
          await this.connect();
          const retried = await this.client?.callTool(
            { name: toolName, arguments: args },
            undefined,
            { timeout, ...(options.signal ? { signal: options.signal } : {}) },
          );
          if (retried) return formatToolResult(retried as RawToolResult);
        } catch (retryError) {
          return formatToolResult({
            isError: true,
            content: [{ type: "text", text: `MCP tool ${toolName} failed: ${errorMessage(retryError)}` }],
          });
        }
      }
      return formatToolResult({
        isError: true,
        content: [{ type: "text", text: `MCP tool ${toolName} failed: ${errorMessage(error)}` }],
      });
    }
  }

  async close(): Promise<void> {
    const transport = this.transport;
    const client = this.client;
    this.transport = undefined;
    this.client = undefined;
    this.tools = [];
    if (this.state !== "disabled" && this.state !== "error") this.state = "closed";
    if (transport instanceof StreamableHTTPClientTransport) {
      try {
        await transport.terminateSession();
      } catch {
        // Servers may reject session termination. Closing the client is enough.
      }
    }
    try {
      await client?.close();
    } catch (error) {
      this.logger.warn("Error closing MCP server", { serverId: this.config.id, error: errorMessage(error) });
    }
  }

  private async connectOnce(): Promise<void> {
    try {
      if (this.config.transport === "stdio") await this.openStdio(this.config);
      else if (this.config.transport === "sse") await this.openSse(this.config.url, this.config.headers);
      else await this.openHttp(this.config);
      await this.refreshTools();
      this.state = "ready";
      this.error = undefined;
      this.logger.info("MCP server connected", {
        serverId: this.config.id,
        transport: this.config.transport,
        tools: this.tools.length,
        server: this.serverName,
      });
    } catch (error) {
      await this.failAndReset(error);
      throw new McpServerError(this.config.id, errorMessage(error), { cause: error });
    }
  }

  private async openStdio(config: Extract<McpServerConfig, { transport: "stdio" }>): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      ...(config.args ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: "pipe",
    });
    const stderr = transport.stderr;
    if (stderr) {
      stderr.on("data", (chunk: Buffer | string) => {
        const line = String(chunk).trim();
        if (line) this.logger.debug?.("MCP server stderr", { serverId: config.id, line: line.slice(0, 500) });
      });
    }
    await this.attach(transport);
  }

  private async openHttp(config: Extract<McpServerConfig, { transport: "http" }>): Promise<void> {
    try {
      await this.openStreamable(config.url, config.headers);
    } catch (error) {
      if (!config.sseFallback) throw error;
      this.logger.warn("Streamable HTTP failed; trying SSE", { serverId: config.id, error: errorMessage(error) });
      await this.closeQuiet();
      await this.openSse(config.url, config.headers);
    }
  }

  private async openStreamable(url: string, headers: Record<string, string> | undefined): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      ...(headers ? { requestInit: { headers } } : {}),
    });
    await this.attach(transport);
  }

  private async openSse(url: string, headers: Record<string, string> | undefined): Promise<void> {
    // The `eventsource` package accepts `headers` here. TypeScript's DOM
    // EventSourceInit does not, so the option is checked at the transport boundary.
    const eventSourceInit = headers
      ? { headers } as SSEClientTransportOptions["eventSourceInit"]
      : undefined;
    const transport = new SSEClientTransport(new URL(url), {
      ...(headers ? { requestInit: { headers } } : {}),
      ...(eventSourceInit ? { eventSourceInit } : {}),
    });
    await this.attach(transport);
  }

  private async attach(transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport): Promise<void> {
    const client = new Client(CLIENT_INFO, {
      capabilities: {},
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (error || !tools) {
              this.logger.warn("MCP tool list refresh failed", { serverId: this.config.id, error: error ? errorMessage(error) : "empty" });
              return;
            }
            this.tools = indexTools(this.config.id, tools as ListedTool[], this.logger);
          },
        },
      },
    });
    this.client = client;
    this.transport = transport;
    const timeout = this.config.connectTimeoutMs ?? this.defaultConnectTimeoutMs;
    await client.connect(transport, { timeout });
    const version = client.getServerVersion();
    this.serverName = version?.name;
    this.serverVersion = version?.version;
    this.instructions = client.getInstructions();
  }

  private async refreshTools(): Promise<void> {
    if (!this.client) return;
    if (!this.client.getServerCapabilities()?.tools) {
      this.tools = [];
      return;
    }
    const timeout = this.config.connectTimeoutMs ?? this.defaultConnectTimeoutMs;
    const collected: ListedTool[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const listed = await this.client.listTools(cursor ? { cursor } : {}, { timeout });
      collected.push(...(listed.tools as ListedTool[]));
      if (!listed.nextCursor || seenCursors.has(listed.nextCursor)) break;
      seenCursors.add(listed.nextCursor);
      cursor = listed.nextCursor;
    }
    this.tools = indexTools(this.config.id, collected, this.logger);
  }

  private async failAndReset(error: unknown): Promise<void> {
    this.state = "error";
    this.error = errorMessage(error);
    this.tools = [];
    this.logger.error("MCP server unavailable", { serverId: this.config.id, transport: this.config.transport, error: this.error });
    await this.closeQuiet();
    this.state = "error";
  }

  private async closeQuiet(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.transport = undefined;
    try {
      await client?.close();
    } catch {
      // The caller records the original connection error.
    }
  }
}

function indexTools(serverId: string, tools: ListedTool[], logger: McpLogger): McpToolInfo[] {
  const byName = new Map<string, McpToolInfo>();
  const usedProviderNames = new Set<string>();
  for (const tool of tools) {
    if (!tool.name || /\s/.test(tool.name)) {
      logger.warn("Skipping MCP tool with an unusable name", { serverId, tool: tool.name });
      continue;
    }
    let providerName = providerToolName(serverId, tool.name);
    if (usedProviderNames.has(providerName)) {
      providerName = `${providerName}_${byName.size}`.slice(0, PROVIDER_TOOL_NAME_MAX);
    }
    if (providerName.length > PROVIDER_TOOL_NAME_MAX) {
      logger.warn("MCP tool name exceeds 64 characters; some providers will reject it", { serverId, providerName });
    }
    usedProviderNames.add(providerName);
    const parameters = tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : EMPTY_SCHEMA;
    byName.set(tool.name, {
      serverId,
      toolName: tool.name,
      canonicalName: canonicalToolName(serverId, tool.name),
      providerName,
      description: tool.description?.trim() || tool.title?.trim() || tool.name,
      parameters,
      ...(tool.title ? { title: tool.title } : {}),
    });
  }
  return [...byName.values()];
}

function isConnectionFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("connection closed")
    || message.includes("not connected")
    || message.includes("econnreset")
    || message.includes("socket")
    || message.includes("fetch failed");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
