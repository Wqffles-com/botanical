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
  type SteeringMessage,
  type TurnSteering,
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

function steeringQueue(): TurnSteering & { push(id: string, content: string): void } {
  const waiting: SteeringMessage[] = [];
  const listeners = new Set<() => void>();
  return {
    push(id, content) {
      waiting.push({ id, content });
      for (const listener of listeners) listener();
    },
    take: () => waiting.splice(0),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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

  test("answers user messages the caller already stored", async () => {
    const { deps, chat, store, provider } = await harness({
      script: [() => [{ type: "text-delta", text: "Both done" }, { type: "done" }]],
    });
    await store.messages.append({ chatId: chat.id, role: "user", content: "first", profileId: "fast" });
    await store.messages.append({ chatId: chat.id, role: "user", content: "second", profileId: "fast" });
    await collect(deps, { chatId: chat.id, content: "first\n\nsecond", profileId: "fast", appendUserMessage: false });
    const saved = await store.messages.listByChat(chat.id);
    expect(saved.map((message) => [message.role, message.content])).toEqual([
      ["user", "first"],
      ["user", "second"],
      ["assistant", "Both done"],
    ]);
    const sent = provider.requests[0]?.messages.filter((message) => message.role === "user");
    expect(sent?.map((message) => message.content)).toEqual(["first", "second"]);
  });

  test("a message sent during a tool step reaches the model before its next step", async () => {
    const steering = steeringQueue();
    const { deps, chat, store, provider } = await harness({
      script: [
        () => {
          steering.push("q1", "use the other folder");
          return [{ type: "tool-call", id: "call_1", name: "echo", arguments: { text: "pine" } }, { type: "done" }];
        },
        () => [{ type: "text-delta", text: "Switched" }, { type: "done" }],
      ],
    });
    const events = await collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast", steering });
    const saved = await store.messages.listByChat(chat.id);
    expect(saved.map((message) => [message.role, message.content])).toEqual([
      ["user", "Hi"],
      ["assistant", ""],
      ["tool", "echo:pine"],
      ["user", "use the other folder"],
      ["assistant", "Switched"],
    ]);
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({ role: "user", content: "use the other folder" });
    expect(events).toContainEqual({ type: "steer", messages: [{ id: "q1", messageId: saved[3]!.id }] });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  test("a message that arrives as the model finishes is answered in the same turn", async () => {
    const steering = steeringQueue();
    const { deps, chat, store } = await harness({
      allow: [],
      script: [
        () => {
          steering.push("q1", "and one more thing");
          return [{ type: "text-delta", text: "First" }, { type: "done" }];
        },
        () => [{ type: "text-delta", text: "Second" }, { type: "done" }],
      ],
    });
    const events = await collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast", steering });
    const saved = await store.messages.listByChat(chat.id);
    expect(saved.map((message) => [message.role, message.content])).toEqual([
      ["user", "Hi"],
      ["assistant", "First"],
      ["user", "and one more thing"],
      ["assistant", "Second"],
    ]);
    expect(events.filter((event) => event.type === "done")).toEqual([{ type: "done", finishReason: "stop" }]);
  });

  test("a provider with live input takes steering messages while it runs", async () => {
    const steering = steeringQueue();
    const { deps, chat, store } = await harness({
      allow: [],
      script: [
        (req) => {
          steering.push("q1", "shorter please");
          const taken = req.input?.take() ?? [];
          return [{ type: "text-delta", text: `Got ${taken.join(",")}` }, { type: "done" }];
        },
      ],
    });
    const events = await collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast", steering });
    const saved = await store.messages.listByChat(chat.id);
    expect(saved.map((message) => [message.role, message.content])).toEqual([
      ["user", "Hi"],
      ["user", "shorter please"],
      ["assistant", "Got shorter please"],
    ]);
    expect(events.some((event) => event.type === "steer")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
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

  test("a settled tool call is recorded once and does not run again", async () => {
    let calls = 0;
    const counting: ExecutableTool = {
      ...echoTool,
      async execute() {
        calls += 1;
        return { output: "ran" };
      },
    };
    const store = createMemoryStore();
    const bus = createAgentMessageBus(store.agents, store.agentMessages);
    const agent = await store.agents.create(
      createAgentSchema.parse({ name: "Ada", prompt: "You are Ada.", toolAllowlist: ["echo"] }),
    );
    const chat = await store.chats.create({ agentId: agent.id });
    const provider = createScriptedProvider([
      () => [
        {
          type: "tool-call",
          id: "ext1",
          name: "echo",
          arguments: { text: "nope" },
          settled: { output: "already", isError: false },
        },
      ],
    ]);
    const deps: RuntimeDeps = {
      store,
      bus,
      profiles: staticProfileResolver({ fast: { provider, model: "test-model" } }),
      toolSources: [createBuiltinToolSource([counting])],
    };
    const events = await collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast" });
    expect(calls).toBe(0);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.agentId).toBe(agent.id);
    expect(events.filter((event) => event.type === "tool-result")).toEqual([
      { type: "tool-result", id: "ext1", name: "echo", result: "already", isError: false },
    ]);
    const saved = await store.messages.listByChat(chat.id);
    expect(saved.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(saved[2]?.content).toBe("already");
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
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

describe("group chats", () => {
  async function group() {
    const store = createMemoryStore();
    const bus = createAgentMessageBus(store.agents, store.agentMessages);
    const make = (name: string) =>
      store.agents.create(createAgentSchema.parse({ name, prompt: `You are ${name}.`, toolAllowlist: ["echo"] }));
    const ada = await make("Ada");
    const bob = await make("Bob");
    const outsider = await make("Cy");
    const chat = await store.chats.create({ agentId: ada.id, memberIds: [bob.id] });
    const provider = createScriptedProvider([
      () => [{ type: "tool-call", id: "t1", name: "echo", arguments: { text: "x" } }, { type: "done" }],
      () => [{ type: "text-delta", text: "Ada here." }, { type: "done" }],
      () => [{ type: "text-delta", text: "Bob here." }, { type: "done" }],
    ]);
    const deps: RuntimeDeps = {
      store,
      bus,
      profiles: staticProfileResolver({ fast: { provider, model: "test-model" } }),
      toolSources: [createBuiltinToolSource([echoTool])],
    };
    return { deps, chat, ada, bob, outsider, provider };
  }

  test("a member takes a turn and sees the owner's reply as a named user message", async () => {
    const { deps, chat, ada, bob, provider } = await group();
    await collect(deps, { chatId: chat.id, content: "Hi both", profileId: "fast" });
    await collect(deps, { chatId: chat.id, content: "Hi both", profileId: "fast", agentId: bob.id, appendUserMessage: false });

    const rows = await deps.store.messages.listByChat(chat.id);
    const replies = rows.filter((row) => row.role === "assistant");
    expect(replies.map((row) => row.agentId)).toEqual([ada.id, ada.id, bob.id]);
    expect(rows.find((row) => row.role === "tool")?.agentId).toBe(ada.id);

    const bobRequest = provider.requests[2];
    expect(bobRequest?.agentId).toBe(bob.id);
    const messages = bobRequest?.messages ?? [];
    expect(messages[0]?.content).toContain("You are Bob in a group chat");
    expect(messages[0]?.content).toContain("Ada");
    // Ada's tool call and its result are not shown to Bob. Her words are, attributed.
    expect(messages.slice(1).map((message) => [message.role, message.content])).toEqual([
      ["user", "Hi both"],
      ["user", "[Ada] Ada here."],
    ]);
  });

  test("an agent outside the chat cannot take a turn", async () => {
    const { deps, chat, outsider } = await group();
    await expect(
      collect(deps, { chatId: chat.id, content: "Hi", profileId: "fast", agentId: outsider.id }),
    ).rejects.toBeInstanceOf(AgentBindingError);
  });

  test("a member cannot be deleted while it is in a chat", async () => {
    const { deps, bob } = await group();
    await expect(deps.store.agents.delete(bob.id)).rejects.toThrow();
  });
});
