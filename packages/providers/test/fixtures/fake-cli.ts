#!/usr/bin/env bun
/**
 * Fixture CLI for provider tests. Mode comes from FAKE_CLI_MODE.
 * `models`, `--version`, and `login status` answer availability probes.
 */
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
