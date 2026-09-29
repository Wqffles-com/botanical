#!/usr/bin/env bun
/**
 * Fixture CLI for provider tests. Mode comes from FAKE_CLI_MODE.
 * `models`, `--version`, and `login status` answer availability probes.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLI_MODE ?? "grok";

if (args[0] === "models" || args[0] === "--version" || (args[0] === "login" && args[1] === "status")) {
  if (process.env.FAKE_CLI_AUTH === "0") {
    console.error("not logged in");
    process.exit(1);
  }
  console.log("ok");
  process.exit(0);
}

if (mode === "args") {
  process.stdout.write(`${args.join("\n")}\n`);
  process.exit(0);
}

if (mode === "capture") {
  const stdin = await readStdin();
  process.stdout.write(`STDIN_BYTES:${stdin.length}\n`);
  for (const arg of args) {
    process.stdout.write(arg.length > 200 ? `ARG_LEN:${arg.length}\n` : `ARG:${arg}\n`);
  }
  const promptIndex = args.indexOf("--prompt-file");
  const promptPath = promptIndex >= 0 ? args[promptIndex + 1] : undefined;
  if (promptPath) {
    const body = readFileSync(promptPath);
    process.stdout.write(`PROMPT_FILE_BYTES:${body.length}\n`);
    process.stdout.write(`PROMPT_FILE:${promptPath}\n`);
    process.stdout.write(`PROMPT_MODE:${(statSync(promptPath).mode & 0o777).toString(8)}\n`);
  }
  const configPath = join(process.cwd(), ".grok", "config.toml");
  const token = process.env.BOTANICAL_MCP_TOKEN ?? "";
  try {
    const text = readFileSync(configPath, "utf8");
    process.stdout.write("CONFIG:yes\n");
    process.stdout.write(`CONFIG_URL:${text.includes("mcp_servers.botanical") ? "yes" : "no"}\n`);
    process.stdout.write(`CONFIG_ENVREF:${text.includes("${BOTANICAL_MCP_TOKEN}") ? "yes" : "no"}\n`);
    process.stdout.write(`CONFIG_LEAK:${token.length > 0 && text.includes(token) ? "yes" : "no"}\n`);
    process.stdout.write(`CONFIG_MODE:${(statSync(configPath).mode & 0o777).toString(8)}\n`);
  } catch {
    process.stdout.write("CONFIG:no\n");
  }
  const mcpIndex = args.indexOf("--mcp-config");
  const mcpPath = mcpIndex >= 0 ? args[mcpIndex + 1] : undefined;
  if (mcpPath && !mcpPath.startsWith("-")) {
    const text = readFileSync(mcpPath, "utf8");
    process.stdout.write(`MCP_ENVREF:${text.includes("${BOTANICAL_MCP_TOKEN}") ? "yes" : "no"}\n`);
    process.stdout.write(`MCP_LEAK:${token.length > 0 && text.includes(token) ? "yes" : "no"}\n`);
    process.stdout.write(`MCP_MODE:${(statSync(mcpPath).mode & 0o777).toString(8)}\n`);
  }
  process.stdout.write(`TOKEN_ENV:${token.length > 0 ? "ok" : "missing"}\n`);
  process.exit(0);
}

if (mode === "mcp-call") {
  const configPath = join(process.cwd(), ".grok", "config.toml");
  const text = readFileSync(configPath, "utf8");
  const url = /url = "([^"]+)"/.exec(text)?.[1] ?? "";
  const token = process.env.BOTANICAL_MCP_TOKEN ?? "";
  const runId = url.split("/").filter(Boolean).pop() ?? "";
  process.stdout.write(`RUN_ID:${runId}\n`);
  if (!url || !token) {
    console.error("missing mcp url or token");
    process.exit(2);
  }
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const rpc = async (body: unknown, id?: number) => {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const payload = await response.text();
    return { status: response.status, payload, id };
  };
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fake-cli", version: "0" } },
  });
  if (init.status !== 200) {
    console.error(`initialize ${init.status}`);
    process.exit(2);
  }
  const noted = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  if (noted.status !== 202 && noted.status !== 200) {
    console.error(`initialized ${noted.status}`);
    process.exit(2);
  }
  const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  process.stdout.write(`HAS_MEMORY:${listed.payload.includes("memory_write") ? "yes" : "no"}\n`);
  const called = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "memory_write", arguments: { scope: "agent", content: "fern from cli" } },
  });
  process.stdout.write(called.payload.includes('"isError":true') ? "CALL_ERROR\n" : "CALL_OK\n");
  process.exit(called.status === 200 ? 0 : 2);
}

if (mode === "plain") {
  process.stdout.write("hello from stdout\n");
  process.stdout.write("second line\n");
  process.exit(0);
}

if (mode === "fail") {
  process.stdout.write("not json yet\n");
  console.error("disk on fire");
  process.exit(2);
}

if (mode === "slow") {
  process.stdout.write(
    `${JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } },
    })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  process.exit(0);
}

if (mode === "grok-acp") {
  process.stdout.write("status: thinking\n");
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "ACP" },
        },
      },
    })}\n`,
  );
  process.exit(0);
}

if (mode === "claude") {
  process.stdout.write("note: not json\n");
  process.stdout.write(
    `${JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
    })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: " Claude" } },
    })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello Claude" }] },
    })}\n`,
  );
  process.exit(0);
}

if (mode === "claude-live") {
  // Claude Code with --input-format stream-json: one line per user message, stdin open until EOF.
  const delta = (text: string) =>
    process.stdout.write(
      `${JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } })}\n`,
    );
  let count = 0;
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const message = JSON.parse(line) as { type: string; message: { content: Array<{ text: string }> } };
    const text = message.message.content[0]?.text ?? "";
    count += 1;
    delta(`got:${text.split("\n").at(-1)}\n`);
    if (count === 1) delta("waiting\n");
    else process.stdout.write(`${JSON.stringify({ type: "result", result: "done" })}\n`);
  }
  delta(`stdin closed after ${count}\n`);
  process.exit(0);
}

if (mode === "grok-steps") {
  // Grok 1.0.41 streaming-messages-json: one message per model step, a tool call between them.
  const line = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const step = (text: string) => {
    line({ type: "stream_event", event: { type: "message_start", message: { id: "m", role: "assistant", content: [] } } });
    line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
    line({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
    line({ type: "stream_event", event: { type: "message_stop" } });
  };
  line({ type: "system", subtype: "init", tools: [] });
  step("I'll look it up.");
  line({ type: "assistant", message: { content: [{ type: "text", text: "I'll look it up." }] } });
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "call_1", content: "{}" }] } });
  step("Done.");
  line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } });
  line({ type: "result", subtype: "success", result: "Done." });
  process.exit(0);
}

if (mode === "codex") {
  process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "t1" })}\n`);
  process.stdout.write(
    `${JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Codex says hi" },
    })}\n`,
  );
  process.stdout.write(`${JSON.stringify({ msg: { type: "agent_message", message: "Codex says hi" } })}\n`);
  process.exit(0);
}

process.stdout.write("preface\n");
process.stdout.write(
  `${JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Grok" } },
  })}\n`,
);
process.stdout.write(
  `${JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "Grok" }] },
  })}\n`,
);
process.exit(0);

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
