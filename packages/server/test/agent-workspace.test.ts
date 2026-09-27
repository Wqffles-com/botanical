import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { agentWorkspacePath } from "@botanical/tools";
import { createDefaultToolRegistry } from "../src/tools/catalog.ts";

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "botanical-dispatch-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("dispatch workspace scope", () => {
  test("file tools follow the calling agent id, not a shared root", async () => {
    const root = scratch();
    const tools = createDefaultToolRegistry();
    const ada = { agentId: "agent-ada", chatId: "chat-1", workspaceRoot: root };
    const bea = { agentId: "agent-bea", chatId: "chat-1", workspaceRoot: root };

    const wrote = await tools.call("file_write", { path: "note.txt", content: "ada-only" }, ada);
    expect(wrote.isError).toBeFalsy();
    expect(readFileSync(path.join(agentWorkspacePath(root, "agent-ada"), "note.txt"), "utf8")).toBe("ada-only");

    const readAda = await tools.call("file_read", { path: "note.txt" }, ada);
    expect(readAda.isError).toBeFalsy();
    expect(readAda.content).toContain("ada-only");

    const readBea = await tools.call("file_read", { path: "note.txt" }, bea);
    expect(readBea.isError).toBe(true);
    expect(readBea.content).not.toContain("ada-only");

    const listAda = await tools.call("file_list", { path: "." }, ada);
    expect(listAda.content).toContain("note.txt");
    const listBea = await tools.call("file_list", { path: "." }, bea);
    expect(listBea.isError).toBeFalsy();
    expect(listBea.content).not.toContain("note.txt");

    const escape = await tools.call("file_read", { path: "../agent-bea/note.txt" }, ada);
    expect(escape.isError).toBe(true);
    expect(escape.content).toContain("outside this agent's workspace");
  });

  test("shell cwd stays inside the calling agent's directory", async () => {
    const root = scratch();
    const tools = createDefaultToolRegistry();
    const ada = { agentId: "agent-ada", chatId: "chat-1", workspaceRoot: root };
    const escaped = await tools.call("shell", { command: "pwd", cwd: ".." }, ada);
    expect(escaped.isError).toBe(true);
    expect(escaped.content).toContain('path ".." is outside this agent\'s workspace');

    const code = await tools.call(
      "code_exec",
      { language: "javascript", code: "console.log(1)", cwd: ".." },
      ada,
    );
    expect(code.isError).toBe(true);
    expect(code.content).toContain('path ".." is outside this agent\'s workspace');
  });
});
