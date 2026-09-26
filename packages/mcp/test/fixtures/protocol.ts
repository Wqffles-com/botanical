/** Minimal MCP JSON-RPC handler shared by the stdio, HTTP, and SSE test servers. */

export interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface FixtureTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: FixtureTool[] = [
  {
    name: "echo",
    description: "Echo a message",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "probe_env",
    description: "List sensitive-looking environment variable names that are set",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fail",
    description: "Return a tool error",
    inputSchema: { type: "object", properties: {} },
  },
];

const SENSITIVE = /api_key|secret|password|token|explicit/i;

export function dispatch(message: RpcMessage, env: NodeJS.ProcessEnv = process.env): RpcMessage | null {
  if (message.method === undefined) return null;
  if (message.id === undefined || message.id === null) return null;

  if (message.method === "initialize") {
    const params = message.params ?? {};
    const protocolVersion = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "botanical-fixture", version: "0.0.1" },
        instructions: "Fixture server. Prefer the echo tool.",
      },
    };
  }

  if (message.method === "ping") {
    return { jsonrpc: "2.0", id: message.id, result: {} };
  }

  if (message.method === "tools/list") {
    const cursor = typeof message.params?.cursor === "string" ? message.params.cursor : undefined;
    if (cursor === "2") {
      return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS.slice(2) } };
    }
    return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS.slice(0, 2), nextCursor: "2" } };
  }

  if (message.method === "tools/call") {
    const name = typeof message.params?.name === "string" ? message.params.name : "";
    const args = isRecord(message.params?.arguments) ? message.params.arguments : {};
    return { jsonrpc: "2.0", id: message.id, result: callTool(name, args, env) };
  }

  return {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `method not found: ${message.method}` },
  };
}

function callTool(name: string, args: Record<string, unknown>, env: NodeJS.ProcessEnv): unknown {
  if (name === "echo") {
    return { content: [{ type: "text", text: `echo:${String(args.message ?? "")}` }], isError: false };
  }
  if (name === "add") {
    const sum = Number(args.a) + Number(args.b);
    return { content: [{ type: "text", text: String(sum) }], isError: false };
  }
  if (name === "probe_env") {
    const keys = Object.keys(env).filter((key) => SENSITIVE.test(key)).sort();
    return { content: [{ type: "text", text: JSON.stringify({ keys }) }], isError: false };
  }
  if (name === "fail") {
    return { content: [{ type: "text", text: "nope" }], isError: true };
  }
  if (name === "slow") {
    return { content: [{ type: "text", text: "late" }], isError: false };
  }
  return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
