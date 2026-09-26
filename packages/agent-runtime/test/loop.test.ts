import { describe, expect, test } from "bun:test";
import { createAgentSchema } from "../src/agent";
import { createAgentMessageBus } from "../src/bus";
import { AgentBindingError, ProfileNotFoundError, ProfileRequiredError } from "../src/errors";
import { createMemoryStore } from "../src/memory";
import { staticProfileResolver } from "../src/profiles";
import { createRuntimeToolSource } from "../src/runtime-tools";
import { runAgentTurn, type RuntimeDeps } from "../src/loop";
import { createScriptedProvider } from "../src/testing";
import {
  createBuiltinToolSource,
  createMcpToolSource,
  type ExecutableTool,
  type McpToolBridge,
  type RuntimeEvent,
} from "../src/index";

const echoTool: ExecutableTool = {
  name: "echo",
  description: "Echo text",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  async execute(args) {
    const text =
      args && typeof args === "object" && "text" in args ? String((args as { text: unknown }).text) : "";
    return { output: `echo:${text}` };
  },
};

async function harness(options: {
  allow?: string[];
  a2a?: boolean;
  script: Parameters<typeof createScriptedProvider>[0];
  mcp?: McpToolBridge;
}) {
  const store = createMemoryStore();
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  const agent = await store.agents.create(
    createAgentSchema.parse({
      name: "Ada",
      prompt: "You are Ada.",
      toolAllowlist: options.allow ?? ["echo"],
      a2aEnabled: options.a2a ?? true,
    }),
  );
  const chat = await store.chats.create({ agentId: agent.id });
  const provider = createScriptedProvider(options.script);
  const sources = [createRuntimeToolSource(bus), createBuiltinToolSource([echoTool])];
  if (options.mcp) sources.push(createMcpToolSource(options.mcp));
  const deps: RuntimeDeps = {
    store,
    bus,
    profiles: staticProfileResolver({ fast: { provider, model: "test-model" } }),
    toolSources: sources,
  };
  return { store, bus, agent, chat, provider, deps };
}

async function collect(deps: RuntimeDeps, input: Parameters<typeof runAgentTurn>[1]) {
  const events: RuntimeEvent[] = [];
  for await (const event of runAgentTurn(deps, input)) events.push(event);
  return events;
}

describe("agent tool loop", () => {
  test("streams text and stops without calling tools", async () => {
    const { deps, chat, store, provider } = await harness({
      script: [
        () => [
          { type: "text-delta", text: "Hel" },
          { type: "text-delta", text: "lo" },
          { type: "usage", inputTokens: 3, outputTokens: 2 },
          { type: "done" },
        ],
      ],
    });
    const events = await collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast" });
    expect(events.map((event) => event.type)).toEqual(["step", "text-delta", "text-delta", "usage", "done"]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    const saved = await store.messages.listByChat(chat.id);
    expect(saved.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(saved[1]?.content).toBe("Hello");
    expect(saved[0]?.profileId).toBe("fast");
    expect(provider.requests[0]?.model).toBe("test-model");
    expect(provider.requests[0]?.tools?.some((tool) => tool.name === "echo")).toBe(true);
    expect(provider.requests[0]?.tools?.some((tool) => tool.name === "agent_send")).toBe(true);
    const titled = await store.chats.get(chat.id);
    expect(titled?.title).toBe("Hi");
  });

  test("executes an allowed tool and feeds the result back", async () => {
    const { deps, chat, store, provider } = await harness({
      script: [
        () => [
          {
            type: "tool-call",
            id: "call_1",
            name: "echo",
            arguments: { text: "pine" },
          },
          { type: "done" },
        ],
        (req) => {
          const tool = req.messages.find((message) => message.role === "tool");
          return [
            { type: "text-delta", text: `saw ${typeof tool?.content === "string" ? tool.content : ""}` },
            { type: "done" },
          ];
        },
      ],
    });
    const events = await collect(deps, { chatId: chat.id, content: "Use echo", profileId: "fast" });
    const results = events.filter((event) => event.type === "tool-result");
    expect(results).toEqual([
      { type: "tool-result", id: "call_1", name: "echo", result: "echo:pine", isError: false },
    ]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(events.some((event) => event.type === "text-delta" && event.text === "saw echo:pine")).toBe(true);
    expect(provider.requests).toHaveLength(2);
    const transcript = await store.messages.listByChat(chat.id);
    expect(transcript.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(transcript[2]?.toolCallId).toBe("call_1");
  });

  test("does not offer or execute tools outside the allowlist", async () => {
    let calls = 0;
    const { deps, chat, provider } = await harness({
      allow: [],
      script: [
        () => [
          { type: "tool-call", id: "call_x", name: "echo", arguments: { text: "nope" } },
          { type: "done" },
        ],
        () => [{ type: "text-delta", text: "ok" }, { type: "done" }],
      ],
    });
    const guarded: ExecutableTool = {
      ...echoTool,
      async execute(args, ctx) {
        calls += 1;
        return echoTool.execute(args, ctx);
      },
    };
    deps.toolSources = [deps.toolSources[0]!, createBuiltinToolSource([guarded])];
    const events = await collect(deps, { chatId: chat.id, content: "try", profileId: "fast" });
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(["agent_send", "agent_inbox"]);
    expect(calls).toBe(0);
    const result = events.find((event) => event.type === "tool-result");
    expect(result).toMatchObject({ name: "echo", isError: true });
  });

  test("requires an explicit profile and refuses to rebind the chat", async () => {
    const { deps, chat } = await harness({
      script: [() => [{ type: "text-delta", text: "x" }, { type: "done" }]],
    });
    await expect(collect(deps, { chatId: chat.id, content: "Hi", profileId: "" })).rejects.toBeInstanceOf(
      ProfileRequiredError,
    );
    await expect(collect(deps, { chatId: chat.id, content: "Hi", profileId: "other" })).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );
    await expect(
      collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast", agentId: "someone-else" }),
    ).rejects.toBeInstanceOf(AgentBindingError);
    expect(await deps.store.messages.listByChat(chat.id)).toHaveLength(0);
  });

  test("stops at max steps while tools keep firing", async () => {
    let executions = 0;
    const toolStep = () =>
      [{ type: "tool-call" as const, id: "c", name: "echo", arguments: { text: "a" } }, { type: "done" as const }];
    const { deps, chat } = await harness({
      script: [toolStep, toolStep, toolStep],
    });
    const builtin = createBuiltinToolSource([
      {
        ...echoTool,
        async execute(args, ctx) {
          executions += 1;
          return echoTool.execute(args, ctx);
        },
      },
    ]);
    deps.toolSources = [deps.toolSources[0]!, builtin];
    const events = await collect(deps, { chatId: chat.id, content: "loop", profileId: "fast", maxSteps: 2 });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "max_steps" });
    expect(executions).toBe(2);
    expect(events.filter((event) => event.type === "step")).toHaveLength(2);
  });

  test("calls an allowlisted MCP tool by its namespaced name", async () => {
    const mcp: McpToolBridge = {
      async listTools() {
        return [
          {
            server: "fs",
            name: "read_file",
            description: "Read",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
          },
        ];
      },
      async callTool(_server, name, args) {
        return { content: [{ type: "text", text: `${name}:${JSON.stringify(args)}` }] };
      },
    };
    const { deps, chat, provider } = await harness({
      allow: ["mcp.fs.*"],
      mcp,
      script: [
        () => [
          { type: "tool-call", id: "m1", name: "mcp.fs.read_file", arguments: '{"path":"a.txt"}' },
          { type: "done" },
        ],
        () => [{ type: "text-delta", text: "done" }, { type: "done" }],
      ],
    });
    const events = await collect(deps, { chatId: chat.id, content: "read", profileId: "fast" });
    expect(provider.requests[0]?.tools?.some((tool) => tool.name === "mcp.fs.read_file")).toBe(true);
    expect(events).toContainEqual({
      type: "tool-result",
      id: "m1",
      name: "mcp.fs.read_file",
      result: 'read_file:{"path":"a.txt"}',
      isError: false,
    });
  });

  test("invalid tool JSON becomes an error result and does not execute", async () => {
    let calls = 0;
    const { deps, chat } = await harness({
      script: [
        () => [{ type: "tool-call", id: "bad", name: "echo", arguments: "{not json" }, { type: "done" }],
        () => [{ type: "text-delta", text: "recovered" }, { type: "done" }],
      ],
    });
    deps.toolSources = [
      deps.toolSources[0]!,
      createBuiltinToolSource([
        {
          ...echoTool,
          async execute(args, ctx) {
            calls += 1;
            return echoTool.execute(args, ctx);
          },
        },
      ]),
    ];
    const events = await collect(deps, { chatId: chat.id, content: "bad", profileId: "fast" });
    expect(calls).toBe(0);
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({ isError: true });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  test("a pre-aborted signal does not persist a turn", async () => {
    const { deps, chat, provider } = await harness({
      script: [() => [{ type: "text-delta", text: "no" }, { type: "done" }]],
    });
    const signal = AbortSignal.abort();
    const events = await collect(deps, { chatId: chat.id, content: "stop", profileId: "fast", signal });
    expect(events).toEqual([{ type: "done", finishReason: "aborted" }]);
    expect(provider.requests).toHaveLength(0);
    expect(await deps.store.messages.listByChat(chat.id)).toHaveLength(0);
  });

  test("hides A2A tools when the agent disables them", async () => {
    const { deps, chat, provider } = await harness({
      a2a: false,
      allow: [],
      script: [() => [{ type: "text-delta", text: "only me" }, { type: "done" }]],
    });
    await collect(deps, { chatId: chat.id, content: "hi", profileId: "fast" });
    expect(provider.requests[0]?.tools).toEqual([]);
  });
});
