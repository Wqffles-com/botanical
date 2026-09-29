import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import {
  buildCliArgs,
  checkCliAvailability,
  clearCliAvailabilityCache,
  CLI_MCP_TOKEN_ENV,
  mergeCliProfiles,
  parseCliLine,
  expandCliModels,
  parseCliProfileShortcut,
  prepareCliLaunch,
  renderCliPrompt,
  runCli,
  splitProfileDocument,
  type CliAvailabilityProbe,
  type CliName,
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

  test("text from separate model steps is split into paragraphs", async () => {
    const events = await collect("grok-steps");
    const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(text).toBe("I'll look it up.\n\nDone.");
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

  test("claude takes messages on stdin while it runs and stdin closes after the result", async () => {
    const waiting: string[] = [];
    const listeners = new Set<() => void>();
    const events = [];
    for await (const event of runCli({
      cli: "claude",
      bin: fixture,
      cwd: "/tmp",
      messages: [{ role: "user", content: "Hi" }],
      timeoutMs: 10_000,
      env: { ...process.env, FAKE_CLI_MODE: "claude-live", HOME: "/tmp" },
      input: {
        take: () => waiting.splice(0),
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    })) {
      events.push(event);
      if (event.type === "text-delta" && event.text === "waiting\n") {
        waiting.push("steer now");
        for (const listener of listeners) listener();
      }
    }
    const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(text).toContain("got:Hi");
    expect(text).toContain("got:steer now");
    expect(text).toContain("stdin closed after 2");
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(listeners.size).toBe(0);
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

  test("grok argv opts into incremental text, approval, and a prompt file", async () => {
    const events = await collect("args");
    const text = events.filter((event) => event.type === "text-delta").map((event) => event.text).join("");
    expect(text).toContain("--output-format");
    expect(text).toContain("streaming-messages-json");
    expect(text).toContain("--include-partial-messages");
    expect(text).toContain("--always-approve");
    expect(text).toContain("--no-wait-for-background");
    expect(text).toContain("--cwd");
    expect(text).toContain("--prompt-file");
    expect(text).not.toContain("Be brief.");
    expect(text).not.toContain("\nHi");
    expect(buildCliArgs({ cli: "claude", cwd: "/work" })).toContain("bypassPermissions");
    expect(buildCliArgs({ cli: "codex", cwd: "/work", model: "gpt-5" })).toEqual(
      expect.arrayContaining(["exec", "--json", "--skip-git-repo-check", "-m", "gpt-5", "--", "-"]),
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
          run: async (_bin, args) => (args[0] === "auth" ? 1 : 0),
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
    expect(merged[1]?.botanicalTools).toBe(true);
  });

  test("botanicalTools false is an opt-out and a non-boolean is rejected", () => {
    const split = splitProfileDocument({
      profiles: [{ id: "grok-build", kind: "cli", cli: "grok", botanicalTools: false }],
    });
    expect(split.cli[0]?.botanicalTools).toBe(false);
    expect(split.cli[0]?.description).toContain("Botanical tools are off");
    expect(() =>
      splitProfileDocument({
        profiles: [{ id: "grok-build", kind: "cli", cli: "grok", botanicalTools: "no" }],
      }),
    ).toThrow(/botanicalTools/);
  });
});

describe("CLI prompt and MCP config", () => {
  test("the prompt names only the tools the endpoint lists", () => {
    const messages = [{ role: "user", content: "Hi" }];
    const listed = renderCliPrompt(messages, { botanicalTools: true, toolNames: ["web_search", "agent_list"] });
    expect(listed).toContain('has these Botanical tools: web_search, agent_list.');
    expect(listed).toContain("mcp__botanical__web_search");
    expect(listed).not.toContain("memory_write");

    const unnamed = renderCliPrompt(messages, { botanicalTools: true });
    expect(unnamed).toContain('MCP server named "botanical"');
    expect(unnamed).not.toContain("memory_write");

    const many = Array.from({ length: 45 }, (_, index) => `tool_${index}`);
    const capped = renderCliPrompt(messages, { botanicalTools: true, toolNames: many });
    expect(capped).toContain("tool_39, and 5 more.");
    expect(capped).not.toContain("tool_40");

    const off = renderCliPrompt(messages, { botanicalTools: false, toolNames: ["memory_write"] });
    expect(off).toContain("are not enabled for you");
    expect(off).not.toContain("memory_write");
  });

  const marker = "PROMPT_MARKER_XYZ_NOT_IN_ARGV";

  test("argv never contains the prompt and carries each CLI's MCP flags", () => {
    const grok = buildCliArgs({
      cli: "grok",
      cwd: "/work",
      promptFile: "/tmp/prompt.txt",
      model: "grok-4",
    });
    expect(grok).toContain("--prompt-file");
    expect(grok).not.toContain("-p");
    expect(grok.join("\0")).not.toContain(marker);

    const claude = buildCliArgs({
      cli: "claude",
      cwd: "/work",
      model: "sonnet",
      mcp: { url: "http://127.0.0.1:9/internal/mcp/runs/abc", tokenEnv: CLI_MCP_TOKEN_ENV, configPath: "/tmp/mcp.json" },
    });
    expect(claude).toEqual(
      expect.arrayContaining([
        "--mcp-config",
        "/tmp/mcp.json",
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__botanical__*",
        "-p",
      ]),
    );
    expect(claude.at(-1)).toBe("-p");
    expect(claude.join("\0")).not.toContain(marker);
    expect(claude.join("\0")).not.toContain("http://127.0.0.1:9/internal/mcp/runs/abc");

    // Issue #69: deferred MCP tools read as "unavailable" to headless turns.
    const claudePlan = prepareCliLaunch({
      cli: "claude",
      cwd: "/work",
      prompt: "hello",
      mcp: { url: "http://127.0.0.1:9/internal/mcp/runs/abc", token: "t" },
    });
    expect(claudePlan.env.ENABLE_TOOL_SEARCH).toBe("false");
    claudePlan.cleanup();
    expect(prepareCliLaunch({ cli: "claude", cwd: "/work", prompt: "hello" }).env.ENABLE_TOOL_SEARCH).toBeUndefined();

    const codex = buildCliArgs({
      cli: "codex",
      cwd: "/work",
      mcp: { url: "http://127.0.0.1:9/internal/mcp/runs/abc", tokenEnv: CLI_MCP_TOKEN_ENV },
    });
    expect(codex).toContain(`mcp_servers.botanical.url=http://127.0.0.1:9/internal/mcp/runs/abc`);
    expect(codex).toContain(`mcp_servers.botanical.bearer_token_env_var=${CLI_MCP_TOKEN_ENV}`);
    expect(codex.at(-1)).toBe("-");
    expect(codex.join("\0")).not.toContain(marker);
  });

  test("generated files keep the token in the environment and restore a previous grok config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "botanical-cli-"));
    const configPath = join(cwd, ".grok", "config.toml");
    try {
      writeFileSync(join(cwd, ".mcp.json"), "{\"keep\":true}\n", { mode: 0o644 });
      const plan = prepareCliLaunch({
        cli: "grok",
        cwd,
        prompt: "hello",
        mcp: { url: "http://127.0.0.1:9/internal/mcp/runs/abc", token: "token-not-on-disk" },
      });
      const text = readFileSync(configPath, "utf8");
      expect(text).toContain('url = "http://127.0.0.1:9/internal/mcp/runs/abc"');
      expect(text).toContain(`Bearer \${${CLI_MCP_TOKEN_ENV}}`);
      expect(text).not.toContain("token-not-on-disk");
      expect(statMode(configPath)).toBe("600");
      expect(readFileSync(join(cwd, ".mcp.json"), "utf8")).toBe("{\"keep\":true}\n");
      expect(plan.env[CLI_MCP_TOKEN_ENV]).toBe("token-not-on-disk");
      // Project-scoped MCP only starts in a trusted folder; ungate for this child only.
      expect(plan.env.GROK_FOLDER_TRUST).toBe("0");
      expect(plan.args.join("\0")).not.toContain("hello");
      plan.cleanup();
      expect(exists(configPath)).toBe(false);
      // The .grok directory this run created is removed too.
      expect(exists(join(cwd, ".grok"))).toBe(false);
      expect(readFileSync(join(cwd, ".mcp.json"), "utf8")).toBe("{\"keep\":true}\n");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("an existing grok config is merged for the run and restored", () => {
    const cwd = mkdtempSync(join(tmpdir(), "botanical-cli-"));
    const configPath = join(cwd, ".grok", "config.toml");
    const original = "user = true\n\n[mcp_servers.botanical]\nurl = \"http://old\"\n";
    try {
      mkdirSync(join(cwd, ".grok"), { recursive: true });
      writeFileSync(configPath, original, { mode: 0o640 });
      const plan = prepareCliLaunch({
        cli: "grok",
        cwd,
        prompt: "hello",
        mcp: { url: "http://127.0.0.1:9/run", token: "fresh-token" },
      });
      const during = readFileSync(configPath, "utf8");
      expect(during).toContain("user = true");
      expect(during).toContain("http://127.0.0.1:9/run");
      expect(during).not.toContain("http://old");
      expect(during).not.toContain("fresh-token");
      plan.cleanup();
      expect(readFileSync(configPath, "utf8")).toBe(original);
      expect(statMode(configPath)).toBe("640");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a long prompt is delivered by file or stdin and config is cleaned up on success, error, and cancel", async () => {
    const prompt = `Z${"y".repeat(2_000_000)}END`;
    for (const cli of ["grok", "claude", "codex"] as const) {
      const cwd = mkdtempSync(join(tmpdir(), "botanical-cli-"));
      const original = "preserved = 1\n";
      mkdirConfig(cwd, original);
      const events = await runCapture(cli, cwd, prompt, "capture");
      const text = textOf(events);
      expect(text).not.toContain("ARG_LEN:");
      expect(text).not.toContain(prompt.slice(0, 80));
      expect(text).toContain("TOKEN_ENV:ok");
      if (cli === "grok") {
        expect(text).toContain("CONFIG_URL:yes");
        expect(text).toContain("CONFIG_ENVREF:yes");
        expect(text).toContain("CONFIG_LEAK:no");
        expect(text).toContain("CONFIG_MODE:600");
        expect(Number(field(text, "PROMPT_FILE_BYTES"))).toBeGreaterThan(2_000_000);
        expect(field(text, "PROMPT_MODE")).toBe("600");
        expect(exists(field(text, "PROMPT_FILE"))).toBe(false);
      } else {
        expect(Number(field(text, "STDIN_BYTES"))).toBeGreaterThan(2_000_000);
        expect(text).toContain("CONFIG_URL:no");
      }
      if (cli === "claude") {
        expect(text).toContain("--strict-mcp-config");
        expect(text).toContain("MCP_ENVREF:yes");
        expect(text).toContain("MCP_LEAK:no");
        expect(text).toContain("MCP_MODE:600");
        expect(text).toContain("MCP_ALWAYS_LOAD:yes");
        const args = text.split("\n");
        const configArg = args[args.findIndex((line) => line === "ARG:--mcp-config") + 1]?.replace(/^ARG:/, "");
        expect(configArg && exists(configArg)).toBe(false);
      }
      if (cli === "codex") {
        expect(text).toContain(`mcp_servers.botanical.bearer_token_env_var=${CLI_MCP_TOKEN_ENV}`);
        expect(text).toContain("ARG:-");
      }
      expect(readFileSync(join(cwd, ".grok", "config.toml"), "utf8")).toBe(original);
      rmSync(cwd, { recursive: true, force: true });
    }

    const failed = mkdtempSync(join(tmpdir(), "botanical-cli-"));
    mkdirConfig(failed, "kept = 1\n");
    const failure = await runCapture("grok", failed, "short", "fail");
    expect(textOf(failure).length).toBeGreaterThan(0);
    expect(failure.some((event) => event.type === "error")).toBe(true);
    expect(readFileSync(join(failed, ".grok", "config.toml"), "utf8")).toBe("kept = 1\n");
    rmSync(failed, { recursive: true, force: true });

    const cancelled = mkdtempSync(join(tmpdir(), "botanical-cli-"));
    mkdirConfig(cancelled, "kept = 1\n");
    const controller = new AbortController();
    const events = [];
    for await (const event of runCli({
      cli: "grok",
      bin: fixture,
      cwd: cancelled,
      messages: [{ role: "user", content: "Hi" }],
      timeoutMs: 20_000,
      signal: controller.signal,
      mcp: { url: "http://127.0.0.1:9/run", token: "cancel-token" },
      env: { ...process.env, FAKE_CLI_MODE: "slow", HOME: cancelled },
    })) {
      events.push(event);
      if (event.type === "text-delta") controller.abort();
    }
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(readFileSync(join(cancelled, ".grok", "config.toml"), "utf8")).toBe("kept = 1\n");
    rmSync(cancelled, { recursive: true, force: true });
  });
});

function mkdirConfig(cwd: string, contents: string): void {
  mkdirSync(join(cwd, ".grok"), { recursive: true });
  writeFileSync(join(cwd, ".grok", "config.toml"), contents, { mode: 0o640 });
}

function textOf(events: Array<{ type: string; text?: string }>): string {
  return events.filter((event) => event.type === "text-delta").map((event) => event.text ?? "").join("");
}

function field(text: string, name: string): string {
  const match = new RegExp(`^${name}:(.*)$`, "m").exec(text);
  return match?.[1] ?? "";
}

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function statMode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}

async function runCapture(cli: CliName, cwd: string, prompt: string, mode: string) {
  const events = [];
  for await (const event of runCli({
    cli,
    bin: fixture,
    cwd,
    messages: [{ role: "user", content: prompt }],
    timeoutMs: 20_000,
    mcp: { url: "http://127.0.0.1:9/internal/mcp/runs/abc", token: "unit-token-value" },
    env: { ...process.env, FAKE_CLI_MODE: mode, HOME: cwd },
  })) {
    events.push(event);
  }
  return events;
}

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

describe("expandCliModels", () => {
  test("lists known models as sibling profiles next to the CLI default", () => {
    const [spec] = parseCliProfileShortcut("claude-code");
    const expanded = expandCliModels([spec!]);
    expect(expanded.map((s) => [s.id, s.model])).toEqual([
      ["claude-code", undefined],
      ["claude-code--opus", "opus"],
      ["claude-code--sonnet", "sonnet"],
      ["claude-code--haiku", "haiku"],
    ]);
  });

  test("uses configured models, skips the pinned one, and sanitizes ids", () => {
    const { cli } = splitProfileDocument([
      { id: "grok-build", kind: "cli", cli: "grok", model: "grok-4.7", models: ["grok-4.7", "grok-5.0"] },
      { id: "codex", kind: "cli", cli: "codex", models: [] },
    ]);
    expect(expandCliModels(cli).map((s) => [s.id, s.model])).toEqual([
      ["grok-build", "grok-4.7"],
      ["grok-build--grok-5-0", "grok-5.0"],
      ["codex", undefined],
    ]);
  });

  test("gives each sibling a distinct label so global profile names stay unique", () => {
    const [spec] = parseCliProfileShortcut("grok-build");
    const labels = expandCliModels([spec!]).map((s) => s.label);
    expect(labels[0]).toBe("Grok Build");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
