import { describe, expect, test } from "bun:test";

import { createAgentSchema } from "../src/agent";
import { createAgentMessageBus } from "../src/bus";
import { createMemoryStore } from "../src/memory";
import { selectMemories } from "../src/memories";
import {
  BUILTIN_ROLES,
  escalationError,
  type AgentRoleGrant,
} from "../src/permissions";
import { staticProfileResolver } from "../src/profiles";
import { runAgentTurn, type RuntimeDeps } from "../src/loop";
import { createScriptedProvider } from "../src/testing";
import { createBuiltinToolSource, type ExecutableTool, type RuntimeEvent } from "../src/index";

const reviewer = role("Reviewer");
const coder = role("Coder");
const orchestrator = role("Orchestrator");

const fileWrite: ExecutableTool = {
  name: "file_write",
  description: "Write a file",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { output: "wrote" };
  },
};

const agentCreate: ExecutableTool = {
  name: "agent_create",
  description: "Create an agent",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { output: { id: "child" } };
  },
};

describe("permission dispatch", () => {
  test("agents with no roles keep allowlist-only behavior", async () => {
    const { events, provider } = await turn({
      allow: ["file_write"],
      tools: [fileWrite],
      call: "file_write",
    });
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual(["file_write"]);
    expect(resultText(events)).toContain("wrote");
    expect(events.some((event) => event.type === "tool-result" && event.isError)).toBe(false);
  });

  test("Reviewer file_write is denied at dispatch and hidden from the model", async () => {
    const { events, provider } = await turn({
      allow: ["file_write"],
      roles: [reviewer],
      tools: [fileWrite],
      call: "file_write",
    });
    expect(provider.requests[0]?.tools ?? []).toEqual([]);
    const message = resultText(events);
    expect(message).toContain("lacks capability");
    expect(message).toContain("file.write");
    expect(message).toContain("roles: Reviewer");
  });

  test("Coder cannot call agent_create; Orchestrator can", async () => {
    const denied = await turn({
      allow: ["agent_create"],
      roles: [coder],
      tools: [agentCreate],
      call: "agent_create",
    });
    expect(resultText(denied.events)).toContain("agent.create");
    expect(resultText(denied.events)).toContain("roles: Coder");

    const allowed = await turn({
      allow: ["agent_create"],
      roles: [orchestrator],
      tools: [agentCreate],
      call: "agent_create",
    });
    expect(resultText(allowed.events)).toContain("child");
    expect(allowed.events.some((event) => event.type === "tool-result" && event.isError)).toBe(false);
  });

  test("MCP tools follow the role allow list even if the model names one", async () => {
    const mcp: ExecutableTool = {
      name: "mcp.docs.delete",
      description: "Delete a doc",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { output: "gone" };
      },
    };
    const { events } = await turn({
      allow: ["mcp.docs.*"],
      roles: [
        {
          id: "r1",
          name: "Docs reader",
          permissions: { capabilities: [], mcp: [{ server: "docs", tools: ["search"] }] },
        },
      ],
      tools: [mcp],
      call: "mcp.docs.delete",
      origin: "mcp",
    });
    expect(resultText(events)).toContain("mcp:docs.delete");
  });
});

describe("agent creation cannot escalate", () => {
  test("Coder cannot grant agent.create or a tool outside its allowlist", () => {
    const coderSubject = {
      name: "Ada",
      toolAllowlist: ["file_read", "file_write", "agent_create"],
      a2aEnabled: false,
      roles: [coder],
    };
    expect(
      escalationError(coderSubject, { toolIds: ["file_write"], roles: [] }),
    ).toBeNull();
    expect(escalationError(coderSubject, { toolIds: ["agent_create"], roles: [] })).toContain("agent.create");
    expect(escalationError(coderSubject, { toolIds: ["shell"], roles: [] })).toContain("outside its allowlist");
    expect(escalationError(coderSubject, { toolIds: [], roles: [orchestrator] })).toContain("cannot grant role");
  });
});

describe("memory prompt injection", () => {
  test("selects recent memories plus keyword overlap and renders a section", async () => {
    const chosen = selectMemories(
      [
        { id: "old", scope: "shared", content: "ancient note", tags: [], updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: "new", scope: "agent", content: "water the ferns", tags: ["plants"], updatedAt: "2026-09-01T00:00:00.000Z" },
        { id: "mid", scope: "shared", content: "buy soil", tags: [], updatedAt: "2026-06-01T00:00:00.000Z" },
      ],
      "how are the ferns",
      { recent: 1, limit: 3, maxChars: 4000 },
    );
    expect(chosen.map((item) => item.id)).toContain("new");
    expect(chosen[0]?.id).toBe("new");

    const { provider } = await turn({
      allow: [],
      tools: [],
      call: null,
      memories: [
        { id: "m1", scope: "shared", content: "The fern likes shade.", tags: ["plants"], updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
      user: "Tell me about the fern",
    });
    const system = provider.requests[0]?.messages[0]?.content;
    expect(system).toContain("## Memories");
    expect(system).toContain("The fern likes shade.");
    expect(system).toContain("[shared]");
  });
});

function role(name: "Coder" | "Reviewer" | "Orchestrator"): AgentRoleGrant {
  const found = BUILTIN_ROLES.find((item) => item.name === name);
  if (!found) throw new Error(name);
  return { id: found.id, name: found.name, permissions: found.permissions };
}

async function turn(options: {
  allow: string[];
  roles?: AgentRoleGrant[];
  tools: ExecutableTool[];
  call: string | null;
  origin?: "builtin" | "mcp";
  memories?: Array<{ id: string; scope: "shared" | "agent"; content: string; tags: string[]; updatedAt: string }>;
  user?: string;
}) {
  const store = createMemoryStore();
  const bus = createAgentMessageBus(store.agents, store.agentMessages);
  const agent = await store.agents.create(
    createAgentSchema.parse({
      name: "Ada",
      prompt: "You are Ada.",
      toolAllowlist: options.allow,
      a2aEnabled: false,
    }),
  );
  if (options.roles) {
    const get = store.agents.get.bind(store.agents);
    store.agents.get = async (id) => {
      const row = await get(id);
      if (!row || row.id !== agent.id) return row;
      return { ...row, roles: options.roles };
    };
  }
  const chat = await store.chats.create({ agentId: agent.id });
  const script = options.call
    ? [
        () => [
          { type: "tool-call" as const, id: "c1", name: options.call!, arguments: {} },
          { type: "done" as const },
        ],
        () => [{ type: "text-delta" as const, text: "done" }, { type: "done" as const }],
      ]
    : [() => [{ type: "text-delta" as const, text: "ok" }, { type: "done" as const }]];
  const provider = createScriptedProvider(script);
  const source = createBuiltinToolSource(options.tools);
  if (options.origin === "mcp") {
    Object.defineProperty(source, "id", { value: "mcp" });
  }
  const deps: RuntimeDeps = {
    store,
    bus,
    profiles: staticProfileResolver({ fast: { provider, model: "test-model" } }),
    toolSources: options.origin === "mcp"
      ? [
          {
            id: "mcp",
            async listTools() {
              return options.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
                origin: "mcp" as const,
              }));
            },
            async call(name, args, ctx) {
              const tool = options.tools.find((item) => item.name === name);
              if (!tool) return { output: { error: "missing" }, isError: true };
              return tool.execute(args, ctx);
            },
          },
        ]
      : [source],
    ...(options.memories
      ? { memories: { recall: async () => options.memories! } }
      : {}),
  };
  const events: RuntimeEvent[] = [];
  for await (const event of runAgentTurn(deps, {
    chatId: chat.id,
    content: options.user ?? "go",
    profileId: "fast",
  })) {
    events.push(event);
  }
  return { events, provider };
}

function resultText(events: RuntimeEvent[]): string {
  return events
    .filter((event) => event.type === "tool-result" || event.type === "text-delta")
    .map((event) => (event.type === "text-delta" ? event.text : JSON.stringify(event.result)))
    .join("\n");
}
