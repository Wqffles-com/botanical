import type { McpTransport } from "./transport";

interface ListedMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Performs the MCP initialize handshake, then lists and calls tools.
 * The recipient model is not involved — this is a client of an MCP server.
 */
export class McpSession {
  private constructor(private readonly transport: McpTransport) {}

  static async open(transport: McpTransport): Promise<McpSession> {
    await transport.start();
    await transport.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "botanical", version: "0.0.1" },
    });
    await transport.notify("notifications/initialized", {});
    return new McpSession(transport);
  }

  async listTools(): Promise<ListedMcpTool[]> {
    const tools: ListedMcpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.transport.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: ListedMcpTool[];
        nextCursor?: string;
      };
      tools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: unknown): Promise<{ content: unknown; isError?: boolean }> {
    const result = (await this.transport.request("tools/call", {
      name,
      arguments: args ?? {},
    })) as { content?: unknown; isError?: boolean };
    return { content: result.content, isError: result.isError };
  }

  close(): Promise<void> {
    return this.transport.close();
  }
}
