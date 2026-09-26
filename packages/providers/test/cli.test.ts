import { chmodSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import {
  buildCliArgs,
  checkCliAvailability,
  clearCliAvailabilityCache,
  mergeCliProfiles,
  parseCliLine,
  parseCliProfileShortcut,
  runCli,
  splitProfileDocument,
  type CliAvailabilityProbe,
} from "../src/index.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-cli.ts", import.meta.url));
chmodSync(fixture, 0o755);

async function collect(mode: string, extra?: { timeoutMs?: number; signal?: AbortSignal; cli?: "grok" | "claude" | "codex" }) {
  const events = [];
  for await (const event of runCli({
    cli: extra?.cli ?? "grok",
    bin: fixture,
    cwd: "/tmp",
    messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }],
    timeoutMs: extra?.timeoutMs ?? 10_000,
    signal: extra?.signal,
    env: { ...process.env, FAKE_CLI_MODE: mode, HOME: "/tmp" },
  })) {
    events.push(event);
  }
  return events;
}

describe("CLI stream parsing", () => {
  test("grok streaming-messages deltas, plain lines, and no duplicate final", async () => {
    const events = await collect("grok");
    const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(text).toContain("preface");
    expect(text).toContain("Grok");
    expect(text.match(/Grok/g)?.length).toBe(1);
    expect(events.at(-1)?.type).toBe("done");
  });

  test("parses grok ACP session chunks and claude/codex shapes", () => {
    const acp = parseCliLine(
      JSON.stringify({
        method: "session/update",
        params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ACP" } } },
      }),
    );
    expect(acp).toEqual({ kind: "delta", text: "ACP" });

    const claude = parseCliLine(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
      }),
    );
    expect(claude).toEqual({ kind: "delta", text: "Hi" });

    const codex = parseCliLine(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Yo" } }),
    );
    expect(codex).toEqual({ kind: "final", text: "Yo" });

    const legacy = parseCliLine(JSON.stringify({ msg: { type: "agent_message", message: "Legacy" } }));
    expect(legacy).toEqual({ kind: "final", text: "Legacy" });

    expect(parseCliLine("just text").kind).toBe("plain");
    expect(parseCliLine(JSON.stringify({ type: "thread.started" })).kind).toBe("ignore");
  });

  test("claude deltas win over the trailing assistant message; codex emits the agent message once", async () => {
    const claude = await collect("claude", { cli: "claude" });
    const claudeText = claude.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(claudeText).toContain("note: not json");
    expect(claudeText).toContain("Hello Claude");
    expect(claudeText.match(/Hello Claude/g)?.length).toBe(1);

    const codex = await collect("codex", { cli: "codex" });
    const codexText = codex.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(codexText).toBe("Codex says hi");
  });

  test("plain stdout is forwarded when the stream is not JSON", async () => {
    const events = await collect("plain");
    const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(text).toContain("hello from stdout");
    expect(text).toContain("second line");
  });

  test("non-zero exit is an error with the stderr tail", async () => {
    const events = await collect("fail");
    const error = events.find((event) => event.type === "error");
    expect(error && error.type === "error" ? error.error.message : "").toContain("exited 2");
    expect(error && error.type === "error" ? error.error.message : "").toContain("disk on fire");
    expect(events.some((event) => event.type === "text-delta" && event.text.includes("not json"))).toBe(true);
  });

  test("timeout kills a slow CLI", async () => {
    const events = await collect("slow", { timeoutMs: 400 });
    const error = events.find((event) => event.type === "error");
    expect(error && error.type === "error" ? error.error.message : "").toContain("timed out");
  });

  test("cancellation kills the process", async () => {
    const controller = new AbortController();
    const events = [];
    for await (const event of runCli({
      cli: "grok",
      bin: fixture,
      cwd: "/tmp",
      messages: [{ role: "user", content: "Hi" }],
      timeoutMs: 20_000,
      signal: controller.signal,
      env: { ...process.env, FAKE_CLI_MODE: "slow", HOME: "/tmp" },
    })) {
      events.push(event);
      if (event.type === "text-delta") controller.abort();
    }
    const error = events.find((event) => event.type === "error");
    expect(error && error.type === "error" ? error.error.message : "").toContain("cancelled");
  });

  test("grok argv opts into incremental text, approval, and cwd", async () => {
    const events = await collect("args");
    const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(text).toContain("--output-format");
    expect(text).toContain("streaming-messages-json");
    expect(text).toContain("--include-partial-messages");
    expect(text).toContain("--always-approve");
    expect(text).toContain("--cwd");
    expect(text).toContain("-p");
    expect(buildCliArgs({ cli: "claude", prompt: "x", cwd: "/work" })).toContain("bypassPermissions");
    expect(buildCliArgs({ cli: "codex", prompt: "x", cwd: "/work", model: "gpt-5" })).toEqual(
      expect.arrayContaining(["exec", "--json", "--skip-git-repo-check", "-m", "gpt-5", "--", "x"]),
    );
  });
});

describe("CLI availability", () => {
  test("a missing binary is unavailable with a reason", async () => {
    clearCliAvailabilityCache();
    const status = await checkCliAvailability(
      { cli: "grok" },
      { probe: probe({ which: () => null }), cacheTtlMs: 0 },
    );
    expect(status.available).toBe(false);
    expect(status.unavailableReason).toContain("not on PATH");
  });

  test("a configured missing path is unavailable", async () => {
    clearCliAvailabilityCache();
    const status = await checkCliAvailability(
      { cli: "grok", bin: "/no/such/grok" },
      { probe: probe({ exists: () => false }), cacheTtlMs: 0 },
    );
    expect(status.available).toBe(false);
    expect(status.unavailableReason).toContain("/no/such/grok");
  });

  test("grok auth file counts as logged in; claude needs a key or credentials", async () => {
    clearCliAvailabilityCache();
    const home = join("/tmp", "cli-home");
    const authed = await checkCliAvailability(
      { cli: "grok", bin: fixture },
      {
        cacheTtlMs: 0,
        probe: probe({
          exists: (path: string) => path === fixture || path.endsWith("/.grok/auth.json"),
          executable: () => true,
          home: () => home,
        }),
      },
    );
    expect(authed.available).toBe(true);

    clearCliAvailabilityCache();
    const claude = await checkCliAvailability(
      { cli: "claude", bin: fixture },
      {
        cacheTtlMs: 0,
        env: { ANTHROPIC_API_KEY: "" },
        probe: probe({
          exists: (path: string) => path === fixture,
          executable: () => true,
          run: async () => 0,
          env: {},
        }),
      },
    );
    expect(claude.available).toBe(false);
    expect(claude.unavailableReason).toContain("credentials");
  });
});

describe("CLI profile config", () => {
  test("splits kind cli entries and accepts the shortcut", () => {
    const split = splitProfileDocument({
      profiles: [
        { id: "grok", name: "Grok", provider: "xai", model: "grok-4" },
        { id: "grok-build", kind: "cli", cli: "grok", label: "Grok Build", model: "grok-4.7", timeoutMs: 5000 },
      ],
    });
    expect(Array.isArray((split.api as { profiles: unknown[] }).profiles)).toBe(true);
    expect((split.api as { profiles: { id: string }[] }).profiles.map((profile) => profile.id)).toEqual(["grok"]);
    expect(split.cli[0]).toMatchObject({ id: "grok-build", cli: "grok", model: "grok-4.7", timeoutMs: 5000 });

    const shortcut = parseCliProfileShortcut("grok-build, claude-code");
    const merged = mergeCliProfiles(split.cli, shortcut);
    expect(merged.map((spec) => spec.id)).toEqual(["grok-build", "claude-code"]);
    expect(merged[0]?.model).toBe("grok-4.7");
  });
});

function probe(overrides: Partial<CliAvailabilityProbe>): CliAvailabilityProbe {
  return {
    which: () => "/usr/bin/grok",
    exists: () => true,
    executable: () => true,
    home: () => "/tmp/cli-home",
    env: {},
    run: async () => 0,
    ...overrides,
  };
}
