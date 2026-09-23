import { afterAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  createAgentMessageBus,
  createAgentSchema,
  createBuiltinToolSource,
  createRuntimeToolSource,
  runAgentTurn,
  staticProfileResolver,
  type ExecutableTool,
} from "@botanical/core";
import { createScriptedProvider } from "@botanical/core/testing";
import postgres from "postgres";
import { createPostgresStore } from "../src/postgres";
import { splitSqlStatements } from "../src/sql";

const schemaUrl = new URL("../sql/001_runtime.sql", import.meta.url);

test("runtime SQL script splits into executable statements", async () => {
  const statements = splitSqlStatements(await readFile(schemaUrl, "utf8"));
  expect(statements.length).toBeGreaterThanOrEqual(9);
  expect(statements.some((statement) => statement.includes("CREATE TABLE") && statement.includes("agent_messages"))).toBe(
    true,
  );
  expect(statements.some((statement) => statement.includes("one agent per chat"))).toBe(true);
  for (const statement of statements) expect(statement.endsWith(";")).toBe(false);
});

describe("postgres store", () => {
  const container = `botanical-rt-${crypto.randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await Bun.spawn(["docker", "rm", "-f", container], { stdout: "ignore", stderr: "ignore" }).exited;
  });

  test("persists a tool turn and delivers A2A mail", async () => {
    const databaseUrl = await startPostgres(container);
    await waitForPostgres(databaseUrl);

    const handle = createPostgresStore(databaseUrl, { max: 4 });
    try {
      await handle.migrate();
      await handle.migrate();

      const store = handle.store;
      const bus = createAgentMessageBus(store.agents, store.agentMessages);
      const ada = await store.agents.create(
        createAgentSchema.parse({
          id: "ada",
          name: "Ada",
          prompt: "You are Ada.",
          toolAllowlist: ["echo"],
        }),
      );
      const bea = await store.agents.create(
        createAgentSchema.parse({ id: "bea", name: "Bea", prompt: "You are Bea.", toolAllowlist: [] }),
      );
      expect((await store.agents.get(ada.id))?.toolAllowlist).toEqual(["echo"]);
      await expect(store.chats.create({ agentId: "missing" })).rejects.toThrow(/Agent not found/);

      const chat = await store.chats.create({ agentId: ada.id });
      const echo: ExecutableTool = {
        name: "echo",
        description: "Echo",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        async execute(args) {
          const text =
            args && typeof args === "object" && "text" in args ? String((args as { text: unknown }).text) : "";
          return { output: `echo:${text}` };
        },
      };
      const provider = createScriptedProvider([
        () => [
          { type: "tool-call", id: "call_1", name: "echo", arguments: { text: "root" } },
          { type: "done" },
        ],
        () => [{ type: "text-delta", text: "echoed" }, { type: "done" }],
        () => [
          {
            type: "tool-call",
            id: "send_1",
            name: "agent_send",
            arguments: { toAgentId: bea.id, body: "postgres mail" },
          },
          { type: "done" },
        ],
        () => [{ type: "text-delta", text: "sent" }, { type: "done" }],
        (req) => {
          const inbox = req.messages.find((message) => message.name === "a2a-inbox");
          const seen = typeof inbox?.content === "string" && inbox.content.includes("postgres mail");
          return [{ type: "text-delta", text: seen ? "delivered" : "missing" }, { type: "done" }];
        },
      ]);
      const deps = {
        store,
        bus,
        profiles: staticProfileResolver({ fast: { provider, model: "pg-model" } }),
        toolSources: [createRuntimeToolSource(bus), createBuiltinToolSource([echo])],
      };

      const first: string[] = [];
      for await (const event of runAgentTurn(deps, { chatId: chat.id, content: "Echo root", profileId: "fast" })) {
        if (event.type === "tool-result") first.push(String(event.result));
      }
      expect(first).toEqual(["echo:root"]);

      const saved = await store.messages.listByChat(chat.id);
      expect(saved.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant"]);
      expect(saved[1]?.toolCalls?.[0]?.name).toBe("echo");
      expect(saved[0]?.profileId).toBe("fast");

      for await (const event of runAgentTurn(deps, { chatId: chat.id, content: "Tell Bea", profileId: "fast" })) {
        if (event.type === "a2a-sent") expect(event.toAgentId).toBe(bea.id);
      }
      const pending = await bus.listInbox(bea.id, { status: ["pending"] });
      expect(pending).toHaveLength(1);
      expect(pending[0]?.fromChatId).toBe(chat.id);

      const beaChat = await store.chats.create({ agentId: bea.id, title: "inbox" });
      let reply = "";
      for await (const event of runAgentTurn(deps, {
        chatId: beaChat.id,
        content: "Mail?",
        profileId: "fast",
      })) {
        if (event.type === "text-delta") reply += event.text;
      }
      expect(reply).toBe("delivered");
      expect((await bus.get(pending[0]!.id))?.status).toBe("read");
      await expect(store.agents.delete(ada.id)).rejects.toThrow(/cannot be deleted/);
    } finally {
      await handle.close();
    }
  }, 120_000);
});

async function startPostgres(name: string): Promise<string> {
  const run = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_USER=botanical",
      "-e",
      "POSTGRES_PASSWORD=botanical",
      "-e",
      "POSTGRES_DB=botanical",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stderr = await new Response(run.stderr).text();
  const stdout = await new Response(run.stdout).text();
  if ((await run.exited) !== 0) throw new Error(`docker run failed: ${stderr || stdout}`);
  const ports = Bun.spawn(["docker", "port", name, "5432"], { stdout: "pipe", stderr: "pipe" });
  const mapping = (await new Response(ports.stdout).text()).trim();
  const port = mapping.split(":").at(-1);
  if (!port) throw new Error(`could not read published port from "${mapping}"`);
  return `postgres://botanical:botanical@127.0.0.1:${port}/botanical`;
}

async function waitForPostgres(databaseUrl: string): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 2 });
    try {
      await sql`select 1 as ok`;
      await sql.end({ timeout: 1 });
      return;
    } catch (error) {
      last = error;
      await sql.end({ timeout: 1 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw last instanceof Error ? last : new Error("postgres did not become ready");
}
