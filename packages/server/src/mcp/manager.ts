import { readFile } from "node:fs/promises";
import type { McpListedTool, McpToolBridge } from "@botanical/core";
import { z } from "zod";
import { HttpMcpTransport, SseMcpTransport } from "./remote";
import { McpSession } from "./session";
import { StdioMcpTransport } from "./stdio";
import type { McpTransport } from "./transport";

const serverSchema = z.discriminatedUnion("transport", [
  z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
  }).strict(),
  z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    transport: z.literal("http"),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }).strict(),
  z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    transport: z.literal("sse"),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }).strict(),
]);

export const mcpConfigSchema = z
  .object({
    servers: z.array(serverSchema).max(50).default([]),
  })
  .strict();

export type McpConfig = z.infer<typeof mcpConfigSchema>;
type McpServerConfig = McpConfig["servers"][number];

export interface McpServerStatus {
  id: string;
  ok: boolean;
  toolCount: number;
  error?: string;
}

/**
 * One lazy MCP session per configured server.
 * A server that fails to list tools is skipped so one bad process does not
 * block every chat; `status()` reports the error.
 */
export class McpManager implements McpToolBridge {
  private readonly sessions = new Map<string, Promise<McpSession>>();
  private readonly errors = new Map<string, string>();

  constructor(private readonly servers: McpServerConfig[]) {}

  static async fromFile(path: string): Promise<McpManager> {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    return McpManager.fromConfig(mcpConfigSchema.parse(raw));
  }

  static fromConfig(config: McpConfig): McpManager {
    return new McpManager(config.servers);
  }

  async listTools(): Promise<McpListedTool[]> {
    const listed: McpListedTool[] = [];
    for (const server of this.servers) {
      try {
        const session = await this.sessionFor(server);
        const tools = await session.listTools();
        this.errors.delete(server.id);
        for (const tool of tools) {
          listed.push({
            server: server.id,
            name: tool.name,
            description: tool.description ?? "",
            ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
          });
        }
      } catch (error) {
        this.errors.set(server.id, error instanceof Error ? error.message : String(error));
      }
    }
    return listed;
  }

  async callTool(server: string, name: string, args: unknown): Promise<{ content: unknown; isError?: boolean }> {
    const config = this.servers.find((candidate) => candidate.id === server);
    if (!config) return { content: `Unknown MCP server "${server}"`, isError: true };
    const session = await this.sessionFor(config);
    return session.callTool(name, args);
  }

  async status(): Promise<McpServerStatus[]> {
    const out: McpServerStatus[] = [];
    for (const server of this.servers) {
      try {
        const session = await this.sessionFor(server);
        const tools = await session.listTools();
        out.push({ id: server.id, ok: true, toolCount: tools.length });
      } catch (error) {
        out.push({
          id: server.id,
          ok: false,
          toolCount: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return out;
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      sessions.map(async (pending) => {
        try {
          const session = await pending;
          await session.close();
        } catch {
          // The session never opened; nothing to close.
        }
      }),
    );
  }

  private sessionFor(server: McpServerConfig): Promise<McpSession> {
    const existing = this.sessions.get(server.id);
    if (existing) return existing;
    const created = McpSession.open(transportFor(server)).catch((error: unknown) => {
      this.sessions.delete(server.id);
      throw error;
    });
    this.sessions.set(server.id, created);
    return created;
  }
}

function transportFor(server: McpServerConfig): McpTransport {
  if (server.transport === "stdio") return new StdioMcpTransport(server.command, server.args, server.env);
  if (server.transport === "http") return new HttpMcpTransport(server.url, server.headers);
  return new SseMcpTransport(server.url, server.headers);
}
