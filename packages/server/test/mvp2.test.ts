import { describe, expect, test } from "bun:test";
import { BUILTIN_ROLE_IDS } from "@botanical/agent-runtime";

import { createMemoryStore } from "../src/db/memory.ts";
import { createAgentAdminContributor } from "../src/tools/agent-admin.ts";
import { createMemoryContributor } from "../src/tools/memory.ts";
import { bearer, login, readJson, setup } from "./helpers.ts";

describe("memories", () => {
  test("operator CRUD and agent scope isolation", async () => {
    const store = createMemoryStore();
    const ada = await store.agents.create({
      name: "Ada",
      description: "",
      systemPrompt: "Ada",
      toolIds: ["memory_write", "memory_search", "memory_list", "memory_delete"],
    });
    const bea = await store.agents.create({
      name: "Bea",
      description: "",
      systemPrompt: "Bea",
      toolIds: ["memory_write", "memory_search", "memory_list", "memory_delete"],
    });
    const tools = createMemoryContributor(store);
    const ctx = (agentId: string) => ({ agentId, chatId: "chat" });

    const shared = await tools.callTool(
      "memory_write",
      { scope: "shared", content: "The fern likes shade.", tags: ["plants"] },
      ctx(ada.id),
    );
    expect(shared.isError).toBeFalsy();
    const priv = await tools.callTool(
      "memory_write",
      { scope: "agent", content: "Ada's private note about ferns." },
      ctx(ada.id),
    );
    expect(priv.isError).toBeFalsy();
    const privateId = JSON.parse(shared.content).id as string;
    void privateId;
    const adaPrivateId = JSON.parse(priv.content).id as string;

    const adaSearch = JSON.parse((await tools.callTool("memory_search", { query: "fern" }, ctx(ada.id))).content) as {
      memories: { id: string }[];
    };
    expect(adaSearch.memories.map((memory) => memory.id).sort()).toEqual([adaPrivateId, JSON.parse(shared.content).id].sort());

    const beaSearch = JSON.parse((await tools.callTool("memory_search", { query: "fern" }, ctx(bea.id))).content) as {
      memories: { content: string }[];
    };
    expect(beaSearch.memories.map((memory) => memory.content)).toEqual(["The fern likes shade."]);

    const blocked = await tools.callTool("memory_delete", { id: adaPrivateId }, ctx(bea.id));
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toContain("another agent");
    expect(await store.memories.get(adaPrivateId)).not.toBeNull();

    const { app } = setup({}, { store });
    const { token } = await login(app);
    const listed = await readJson<{ memories: { id: string; scope: string }[] }>(
      await app.fetch(new Request("http://localhost/api/memories?q=fern", { headers: bearer(token) })),
    );
    expect(listed.memories).toHaveLength(2);

    const removed = await app.fetch(
      new Request(`http://localhost/api/memories/${adaPrivateId}`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(removed.status).toBe(204);
  });
});

describe("roles", () => {
  test("seeds builtin roles, assigns them, and refuses to delete a builtin", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const headers = { "content-type": "application/json", ...bearer(token) };
    const listed = await readJson<{ roles: { id: string; name: string; builtin: boolean }[] }>(
      await app.fetch(new Request("http://localhost/api/roles", { headers: bearer(token) })),
    );
    expect(listed.roles.map((role) => role.name).sort()).toEqual(["Coder", "Orchestrator", "Reviewer"]);

    const created = await app.fetch(
      new Request("http://localhost/api/roles", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Scribe",
          description: "Notes only",
          permissions: { capabilities: ["memory.read", "memory.write"], mcp: [] },
        }),
      }),
    );
    expect(created.status).toBe(201);
    const scribe = (await readJson<{ role: { id: string } }>(created)).role;

    const agentResponse = await app.fetch(
      new Request("http://localhost/api/agents", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Ada", prompt: "Be brief.", roleIds: ["Reviewer"] }),
      }),
    );
    expect(agentResponse.status).toBe(201);
    const agent = (await readJson<{
      agent: {
        id: string;
        roleIds: string[];
        roles: { name: string }[];
        effectivePermissions: { unrestricted: boolean; capabilities: string[]; roleNames: string[] };
        createdByAgentId: string | null;
      };
    }>(agentResponse)).agent;
    expect(agent.roleIds).toEqual([BUILTIN_ROLE_IDS.Reviewer]);
    expect(agent.roles.map((role) => role.name)).toEqual(["Reviewer"]);
    expect(agent.effectivePermissions.unrestricted).toBe(false);
    expect(agent.effectivePermissions.capabilities).toEqual(["file.read", "web", "memory.read"]);
    expect(agent.effectivePermissions.roleNames).toEqual(["Reviewer"]);
    expect(agent.createdByAgentId).toBeNull();

    const replaced = await app.fetch(
      new Request(`http://localhost/api/agents/${agent.id}/roles`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ roleIds: [scribe.id, "Coder"] }),
      }),
    );
    expect(replaced.status).toBe(200);
    const body = await readJson<{ roleIds: string[] }>(replaced);
    expect(body.roleIds.sort()).toEqual([BUILTIN_ROLE_IDS.Coder, scribe.id].sort());

    const builtinDelete = await app.fetch(
      new Request(`http://localhost/api/roles/${BUILTIN_ROLE_IDS.Reviewer}`, { method: "DELETE", headers: bearer(token) }),
    );
    expect(builtinDelete.status).toBe(409);
  });
});

describe("agent_create privileges", () => {
  test("a Coder cannot create agents, a builder cannot escalate, an Orchestrator can", async () => {
    const store = createMemoryStore();
    const coder = await store.agents.create({
      name: "Coder",
      description: "",
      systemPrompt: "Code.",
      toolIds: ["file_read", "file_write", "agent_create"],
      roleIds: [BUILTIN_ROLE_IDS.Coder],
    });
    const tools = createAgentAdminContributor(store);
    const deniedCoder = await tools.callTool(
      "agent_create",
      { name: "Child", prompt: "Help." },
      { agentId: coder.id, chatId: "c" },
    );
    expect(deniedCoder.isError).toBe(true);
    expect(deniedCoder.content).toContain('lacks capability \\"agent.create\\"');

    // A builder may create agents but cannot hand out more than it has.
    const builderRole = await store.roles.create({
      name: "Builder",
      description: "Creates helpers",
      permissions: { capabilities: ["agent.create", "file.read", "file.write"], mcp: [] },
    });
    const builder = await store.agents.create({
      name: "Builder",
      description: "",
      systemPrompt: "Build.",
      toolIds: ["file_read", "file_write", "agent_create"],
      roleIds: [builderRole.id],
    });
    const deniedRole = await tools.callTool(
      "agent_create",
      { name: "Child", prompt: "Help.", roles: ["Orchestrator"] },
      { agentId: builder.id, chatId: "c" },
    );
    expect(deniedRole.isError).toBe(true);
    expect(deniedRole.content).toContain("cannot grant role");

    const deniedTool = await tools.callTool(
      "agent_create",
      { name: "Child", prompt: "Help.", tools: ["shell"] },
      { agentId: builder.id, chatId: "c" },
    );
    expect(deniedTool.isError).toBe(true);
    expect(deniedTool.content).toContain('lacks capability \\"shell\\"');

    const orchestrator = await store.agents.create({
      name: "Lead",
      description: "",
      systemPrompt: "Lead.",
      toolIds: ["*"],
      roleIds: [BUILTIN_ROLE_IDS.Orchestrator],
    });
    const created = await tools.callTool(
      "agent_create",
      { name: "Helper", prompt: "Help.", tools: ["file_read"], roles: ["Reviewer"] },
      { agentId: orchestrator.id, chatId: "c" },
    );
    expect(created.isError).toBeFalsy();
    const childId = JSON.parse(created.content).id as string;
    const child = await store.agents.get(childId);
    expect(child?.createdByAgentId).toBe(orchestrator.id);
    expect(child?.roleIds).toEqual([BUILTIN_ROLE_IDS.Reviewer]);
    expect(child?.toolIds).toEqual(["file_read"]);
  });
});

describe("CLI profiles", () => {
  test("lists an unavailable CLI profile and rejects a chat turn", async () => {
    const { app } = setup({
      BOTANICAL_PROFILES: JSON.stringify([
        { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
        { id: "grok-build", kind: "cli", cli: "grok", label: "Grok Build", bin: "/no/such/grok-binary" },
      ]),
    });
    const { token } = await login(app);
    const profiles = await readJson<{
      profiles: { id: string; kind: string; available: boolean; unavailableReason?: string; provider: string }[];
      defaultProfileId: null;
    }>(await app.fetch(new Request("http://localhost/api/profiles", { headers: bearer(token) })));
    expect(profiles.defaultProfileId).toBeNull();
    const cli = profiles.profiles.find((profile) => profile.id === "grok-build");
    expect(cli).toMatchObject({ kind: "cli", provider: "cli", available: false });
    expect(cli?.unavailableReason).toContain("/no/such/grok-binary");
    expect(profiles.profiles.find((profile) => profile.id === "grok")?.available).toBe(true);

    const headers = { "content-type": "application/json", ...bearer(token) };
    const agent = await readJson<{ agent: { id: string } }>(
      await app.fetch(
        new Request("http://localhost/api/agents", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Ada", prompt: "Be brief." }),
        }),
      ),
    );
    const chat = await readJson<{ chat: { id: string } }>(
      await app.fetch(
        new Request("http://localhost/api/chats", {
          method: "POST",
          headers,
          body: JSON.stringify({ agentId: agent.agent.id, profileId: "grok-build", title: "CLI" }),
        }),
      ),
    );
    const turn = await app.fetch(
      new Request(`http://localhost/api/chats/${chat.chat.id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "Hi", profileId: "grok-build", stream: false }),
      }),
    );
    expect(turn.status).toBe(422);
    const error = await readJson<{ error: { code: string; message: string } }>(turn);
    expect(error.error.code).toBe("profile_unavailable");
    expect(error.error.message).toContain("/no/such/grok-binary");
  });
});
