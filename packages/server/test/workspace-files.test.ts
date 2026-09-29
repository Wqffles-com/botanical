import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { agentWorkspacePath, sanitizeAgentId } from "@botanical/tools";
import { bearer, createAgent, login, readJson, setup } from "./helpers.ts";

let root = "";
let previous: string | undefined;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "botanical-files-route-"));
  previous = process.env.BOTANICAL_WORKSPACE;
  process.env.BOTANICAL_WORKSPACE = root;
});

afterAll(() => {
  if (previous === undefined) delete process.env.BOTANICAL_WORKSPACE;
  else process.env.BOTANICAL_WORKSPACE = previous;
  rmSync(root, { recursive: true, force: true });
});

interface ListBody {
  path: string;
  entries: Array<{ name: string; path: string; type: string; size: number }>;
  truncated: boolean;
}

describe("agent workspace files", () => {
  test("lists and reads files in the agent's own directory only", async () => {
    const { app } = setup();
    const { token } = await login(app);
    const me = await readJson<{ user: { id: string } }>(
      await app.fetch(new Request("http://localhost/api/auth/me", { headers: bearer(token) })),
    );
    const agent = await createAgent(app, token);
    const dir = agentWorkspacePath(path.join(root, "users", sanitizeAgentId(me.user.id)), agent.id);
    mkdirSync(path.join(dir, "notes"), { recursive: true });
    writeFileSync(path.join(dir, "notes", "plan.md"), "# Plan\n");
    writeFileSync(path.join(root, "secret.txt"), "outside");

    const get = (url: string) => app.fetch(new Request(`http://localhost${url}`, { headers: bearer(token) }));

    const top = await get(`/api/agents/${agent.id}/files`);
    expect(top.status).toBe(200);
    const topBody = await readJson<ListBody>(top);
    expect(topBody.path).toBe(".");
    expect(topBody.entries.map((entry) => [entry.name, entry.type])).toEqual([["notes", "directory"]]);

    const nested = await readJson<ListBody>(await get(`/api/agents/${agent.id}/files?path=notes`));
    expect(nested.entries.map((entry) => entry.path)).toEqual(["notes/plan.md"]);

    const file = await get(`/api/agents/${agent.id}/files/content?path=notes/plan.md`);
    expect(file.status).toBe(200);
    expect(await readJson<{ content: string }>(file)).toMatchObject({ path: "notes/plan.md", content: "# Plan\n" });

    const escape = await get(`/api/agents/${agent.id}/files/content?path=../../../../secret.txt`);
    expect(escape.status).toBe(400);

    expect((await get(`/api/agents/${agent.id}/files/content?path=missing.txt`)).status).toBe(404);
    expect((await get(`/api/agents/${agent.id}/files/content`)).status).toBe(400);
    expect((await get(`/api/agents/${agent.id}/files/content?path=notes`)).status).toBe(400);
    expect((await get(`/api/agents/nope/files`)).status).toBe(404);
  });

  test("requires a session", async () => {
    const { app } = setup();
    const response = await app.fetch(new Request("http://localhost/api/agents/any/files"));
    expect(response.status).toBe(401);
  });
});
