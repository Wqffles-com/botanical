import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "bun:test";

import {
  checkCliAvailability,
  childEnv,
  claudeAuthStatusLoggedIn,
  claudePackageName,
  clearCliAvailabilityCache,
  CliInstaller,
  codexPlatformVersion,
  codexTriple,
  cpuArch,
  detectLibc,
  grokDownloadUrls,
  GROK_VERSION_URL,
  LoginBusyError,
  LoginManager,
  machineArch,
  parseLoginOutput,
  redactSecrets,
  runChildEnv,
  stripAnsi,
  verifySha512Sri,
  type CpuArch,
  type InstallIo,
  type Libc,
  type LoginProcess,
} from "../src/index.ts";
import type { CliAvailabilityProbe } from "../src/cli/availability.ts";

const ROOT = "/opt/botanical-cli";
const HOME = "/home/botanical";
const SECRET = "sk-ant-api03-super-secret-token-value";

describe("CLI artifact mapping", () => {
  test("maps arch and libc onto each CLI's published artifact", () => {
    expect(cpuArch("x64")).toBe("x64");
    expect(cpuArch("amd64")).toBe("x64");
    expect(cpuArch("arm64")).toBe("arm64");
    expect(cpuArch("aarch64")).toBe("arm64");
    expect(() => cpuArch("ia32")).toThrow(/Unsupported/);
    expect(machineArch("x64")).toBe("x86_64");
    expect(machineArch("arm64")).toBe("aarch64");

    expect(detectLibc({ alpineRelease: true })).toBe("musl");
    expect(detectLibc({ alpineRelease: false, lddText: "musl libc" })).toBe("musl");
    expect(detectLibc({ alpineRelease: false, lddText: "GNU libc" })).toBe("glibc");

    expect(claudePackageName("x64", "musl")).toBe("@anthropic-ai/claude-code-linux-x64-musl");
    expect(claudePackageName("arm64", "musl")).toBe("@anthropic-ai/claude-code-linux-arm64-musl");
    expect(claudePackageName("x64", "glibc")).toBe("@anthropic-ai/claude-code-linux-x64");
    expect(claudePackageName("arm64", "glibc")).toBe("@anthropic-ai/claude-code-linux-arm64");

    expect(codexTriple("x64")).toBe("x86_64-unknown-linux-musl");
    expect(codexTriple("arm64")).toBe("aarch64-unknown-linux-musl");
    expect(codexPlatformVersion("0.157.1", "x64")).toBe("0.157.1-linux-x64");
    expect(codexPlatformVersion("0.157.1", "arm64")).toBe("0.157.1-linux-arm64");

    expect(grokDownloadUrls("1.2.3", "x86_64")[0]).toBe("https://x.ai/cli/grok-1.2.3-linux-x86_64.gz");
    expect(grokDownloadUrls("1.2.3", "aarch64").some((url) => url.includes("grok-1.2.3-linux-aarch64"))).toBe(true);
    expect(grokDownloadUrls("1.2.3", "x86_64").some((url) => url.includes("storage.googleapis.com"))).toBe(true);
  });

  test("sha512 SRI accepts the matching bytes and rejects a mismatch", () => {
    const bytes = new TextEncoder().encode("botanical-cli");
    const good = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    expect(verifySha512Sri(bytes, good)).toBe(true);
    const flipped = new Uint8Array(bytes);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(verifySha512Sri(flipped, good)).toBe(false);
    expect(verifySha512Sri(bytes, "sha256-aaaa")).toBe(false);
  });
});

describe("CLI login output", () => {
  test("extracts a URL and code, strips ANSI, and redacts tokens", () => {
    const grok = `
To sign in, open this URL in your browser:

  https://auth.x.ai/device?user_code=ABCD-EFGH

Then enter this code:

  ABCD-EFGH
`;
    expect(parseLoginOutput(grok)).toMatchObject({
      verificationUrl: "https://auth.x.ai/device?user_code=ABCD-EFGH",
      userCode: "ABCD-EFGH",
    });

    const codex = [
      "Follow these steps to sign in with ChatGPT using device code authorization:",
      "1. Open this link in your browser and sign in to your account",
      "   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m",
      "2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m",
      "   \u001b[94mWDJB-MJHT\u001b[0m",
      `leaked ${SECRET}`,
    ].join("\n");
    const parsed = parseLoginOutput(codex);
    expect(parsed.verificationUrl).toBe("https://auth.openai.com/codex/device");
    expect(parsed.userCode).toBe("WDJB-MJHT");
    expect(stripAnsi(codex)).not.toContain("\u001b");
    const redacted = redactSecrets(codex);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain("WDJB-MJHT");
    expect(redacted).toContain("[redacted]");
  });

  test("a Claude token is stored and is absent from the login view", async () => {
    let saved = "";
    const proc = fakeProcess();
    const manager = new LoginManager({
      resolveBin: () => `${ROOT}/bin/claude`,
      envFor: () => ({ HOME }),
      spawn: () => proc,
      isLoggedIn: async () => saved.length > 0,
      persistClaudeToken: async (token) => {
        saved = token;
      },
    });
    const started = manager.start("claude");
    expect(started.state).toBe("needs_input");
    expect(started.prompt).toContain("setup-token");
    proc.emit(`paste this\n${SECRET}\n`);
    await manager.input("claude", SECRET);
    const view = manager.view("claude");
    expect(saved).toBe(SECRET);
    expect(view.state).toBe("done");
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view.lines.join("\n")).not.toContain(SECRET);
    expect(() => manager.start("claude")).not.toThrow();
  });

  test("a second login is rejected, cancel kills the child, and timeout expires it", async () => {
    const proc = fakeProcess();
    const manager = new LoginManager({
      resolveBin: () => `${ROOT}/bin/grok`,
      envFor: () => ({ HOME }),
      spawn: () => proc,
      isLoggedIn: async () => false,
      persistClaudeToken: async () => undefined,
      timeoutMs: 30,
    });
    manager.start("grok");
    expect(() => manager.start("grok")).toThrow(LoginBusyError);
    proc.emit("https://auth.x.ai/device\nABCD-EFGH\n");
    expect(manager.view("grok").userCode).toBe("ABCD-EFGH");
    manager.cancel("grok");
    expect(manager.view("grok").state).toBe("cancelled");
    expect(proc.killed).toBe(true);

    const slow = fakeProcess();
    const expiring = new LoginManager({
      resolveBin: () => `${ROOT}/bin/grok`,
      envFor: () => ({ HOME }),
      spawn: () => slow,
      isLoggedIn: async () => false,
      persistClaudeToken: async () => undefined,
      timeoutMs: 20,
    });
    expiring.start("grok");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(expiring.view("grok").state).toBe("expired");
    expect(slow.killed).toBe(true);
  });
});

describe("CLI installer", () => {
  test("installs grok, skips the same version, and update re-resolves", async () => {
    const io = memoryIo();
    io.env = {};
    const installer = new CliInstaller(io, { root: ROOT, home: HOME });
    const first = await installer.install("grok");
    expect(first.ok).toBe(true);
    expect(first.skipped).toBe(false);
    expect(first.version).toBe("1.2.3");
    expect(io.files.has(`${ROOT}/bin/grok`)).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(io.files.get(`${ROOT}/manifests/grok.json`) ?? new Uint8Array()));
    expect(manifest).toMatchObject({ cli: "grok", version: "1.2.3", arch: "x86_64", verified: "version-probe", sha512: null });

    const fetches = io.texts.length;
    const second = await installer.install("grok");
    expect(second.skipped).toBe(true);
    expect(io.texts.length).toBe(fetches);

    const updated = await installer.install("grok", { update: true });
    expect(updated.skipped).toBe(true);
    expect(io.texts.length).toBeGreaterThan(fetches);
    expect(io.downloads.filter((url) => url.includes("grok-1.2.3")).length).toBe(1);
  });

  test("a pin skips the version lookup and a bad checksum does not block the other CLI", async () => {
    const io = memoryIo();
    io.env = { BOTANICAL_GROK_VERSION: "9.9.9", BOTANICAL_CODEX_VERSION: "0.4.2" };
    io.integrity.codex = "sha512-" + createHash("sha512").update(new Uint8Array([1, 2, 3])).digest("base64");
    const installer = new CliInstaller(io, { root: ROOT, home: HOME });
    const results = await installer.installMany(["grok", "codex"]);
    expect(results.find((result) => result.cli === "grok")?.ok).toBe(true);
    expect(io.texts.some((url) => url === GROK_VERSION_URL)).toBe(false);
    expect(io.downloads.some((url) => url.includes("grok-9.9.9-linux-x86_64"))).toBe(true);
    const codex = results.find((result) => result.cli === "codex");
    expect(codex?.ok).toBe(false);
    expect(codex?.error).toContain("Integrity");
    expect((await installer.view("grok")).status).toBe("installed");
    expect((await installer.view("codex")).status).toBe("failed");
    expect((await installer.view("codex")).lastError).not.toContain(SECRET);
  });

  test("claude install verifies sha512 and concurrent calls share one download", async () => {
    const io = memoryIo();
    const installer = new CliInstaller(io, { root: ROOT, home: HOME });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = io.download.bind(io);
    let downloads = 0;
    io.download = async (url, dest) => {
      downloads += 1;
      await gate;
      return original(url, dest);
    };
    const first = installer.install("claude");
    const second = installer.install("claude");
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.version).toBe("2.1.3");
    expect(downloads).toBe(1);
    const manifest = JSON.parse(new TextDecoder().decode(io.files.get(`${ROOT}/manifests/claude.json`) ?? new Uint8Array()));
    expect(manifest.verified).toBe("sha512");
    expect(manifest.libc).toBe("musl");
    expect(manifest.sha512).toBeTypeOf("string");
    const settings = new TextDecoder().decode(io.files.get(`${HOME}/.claude/settings.json`) ?? new Uint8Array());
    expect(settings).toContain("USE_BUILTIN_RIPGREP");
    expect(settings).not.toContain(SECRET);
  });

  test("a fresh bin volume installs from the download cache without downloading", async () => {
    const CACHE = "/var/cache/botanical-cli";
    const io = memoryIo();
    const first = await new CliInstaller(io, { root: ROOT, home: HOME, cache: CACHE }).install("claude");
    expect(first.ok).toBe(true);
    expect(io.files.has(`${CACHE}/claude/2.1.3-x86_64-musl/bin`)).toBe(true);
    const sha512 = JSON.parse(new TextDecoder().decode(io.files.get(`${ROOT}/manifests/claude.json`) ?? new Uint8Array())).sha512;

    await io.remove(ROOT);
    const downloads = io.downloads.length;
    const second = await new CliInstaller(io, { root: ROOT, home: HOME, cache: CACHE }).install("claude");
    expect(second).toMatchObject({ ok: true, skipped: false, version: "2.1.3" });
    expect(io.downloads.length).toBe(downloads);
    expect(io.files.has(`${ROOT}/bin/claude`)).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(io.files.get(`${ROOT}/manifests/claude.json`) ?? new Uint8Array()));
    expect(manifest).toMatchObject({ verified: "sha512", sha512 });
  });

  test("a cached binary that fails its probe is dropped and downloaded again", async () => {
    const CACHE = "/var/cache/botanical-cli";
    const io = memoryIo();
    await new CliInstaller(io, { root: ROOT, home: HOME, cache: CACHE }).install("grok");
    await io.remove(ROOT);
    const probe = io.spawn.bind(io);
    let probes = 0;
    io.spawn = async (bin, args, env, timeoutMs) => {
      probes += 1;
      if (probes === 1) return { code: 1, stdout: "", stderr: "broken" };
      return probe(bin, args, env, timeoutMs);
    };
    const downloads = io.downloads.length;
    const result = await new CliInstaller(io, { root: ROOT, home: HOME, cache: CACHE }).install("grok");
    expect(result.ok).toBe(true);
    expect(io.downloads.length).toBe(downloads + 1);
    expect(io.files.has(`${CACHE}/grok/1.2.3-x86_64-musl/bin`)).toBe(true);
  });

  test("arm64 codex selects the aarch64 musl vendor path", async () => {
    const io = memoryIo({ arch: "arm64", libc: "glibc" });
    const installer = new CliInstaller(io, { root: ROOT, home: HOME });
    const result = await installer.install("codex");
    expect(result.ok).toBe(true);
    expect(io.downloads.some((url) => url.includes("codex-0.4.2-linux-arm64"))).toBe(true);
    const manifest = JSON.parse(new TextDecoder().decode(io.files.get(`${ROOT}/manifests/codex.json`) ?? new Uint8Array()));
    expect(manifest.arch).toBe("aarch64");
  });
});

describe("grok login", () => {
  test("a fresh volume is logged out even when grok models would exit 0", async () => {
    clearCliAvailabilityCache();
    const fresh = await checkCliAvailability(
      { cli: "grok", bin: "/opt/botanical-cli/bin/grok" },
      {
        cacheTtlMs: 0,
        env: { XAI_API_KEY: "   " },
        probe: probe({
          exists: (path) => path === "/opt/botanical-cli/bin/grok",
          executable: () => true,
          nonEmpty: () => false,
          run: async () => 0,
          env: { XAI_API_KEY: "   " },
        }),
      },
    );
    expect(fresh.available).toBe(false);
    expect(fresh.unavailableReason).toContain("XAI_API_KEY");

    clearCliAvailabilityCache();
    const keyed = await checkCliAvailability(
      { cli: "grok", bin: "/opt/botanical-cli/bin/grok" },
      {
        cacheTtlMs: 0,
        env: {},
        probe: probe({
          exists: (path) => path === "/opt/botanical-cli/bin/grok",
          executable: () => true,
          nonEmpty: () => false,
          run: async () => 1,
          env: { XAI_API_KEY: "xai-live-key" },
        }),
      },
    );
    expect(keyed.available).toBe(true);
    expect(JSON.stringify(keyed)).not.toContain("xai-live-key");
  });
});

describe("CLI child environment", () => {
  const messy: Record<string, string> = {
    PATH: "/usr/bin",
    HOME: "/tmp/old",
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    http_proxy: "http://proxy.example:8080",
    HTTPS_PROXY: "http://proxy.example:8443",
    NO_PROXY: "localhost",
    USE_BUILTIN_RIPGREP: "0",
    BOTANICAL_PASSWORD: "passcode-secret",
    BOTANICAL_PASSWORD_HASH: "hash-secret",
    BOTANICAL_PASSCODE: "passcode-secret",
    BOTANICAL_SESSION_SECRET: "session-secret",
    DATABASE_URL: "postgres://botanical:db-secret@postgres/botanical",
    POSTGRES_PASSWORD: "db-secret",
    PGPASSWORD: "db-secret",
    BOTANICAL_MCP_SERVERS: "{\"servers\":[{\"token\":\"mcp-secret\"}]}",
    XAI_API_KEY: "   ",
    ANTHROPIC_API_KEY: "anthropic-secret",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
    OPENAI_API_KEY: "openai-secret",
    CODEX_API_KEY: "codex-secret",
    DEEPSEEK_API_KEY: "deepseek-secret",
    OPENROUTER_API_KEY: "router-secret",
    CUSTOM_OPENAI_API_KEY: "custom-secret",
    BRAVE_SEARCH_API_KEY: "brave-secret",
    BRAVE_API_KEY: "brave-secret-2",
    TAVILY_API_KEY: "tavily-secret",
  };

  test("install and login env drops blanks and secrets, and keeps each CLI's own key", () => {
    const grok = childEnv(messy, "/home/botanical", "/opt/botanical-cli", "grok");
    expect(grok.XAI_API_KEY).toBeUndefined();
    expect(grok.ANTHROPIC_API_KEY).toBeUndefined();
    expect(grok.OPENAI_API_KEY).toBeUndefined();
    expect(grok.DEEPSEEK_API_KEY).toBeUndefined();
    expect(grok.BOTANICAL_PASSWORD).toBeUndefined();
    expect(grok.DATABASE_URL).toBeUndefined();
    expect(grok.POSTGRES_PASSWORD).toBeUndefined();
    expect(grok.BOTANICAL_MCP_SERVERS).toBeUndefined();
    expect(grok.HOME).toBe("/home/botanical");
    expect(grok.PATH).toContain("/opt/botanical-cli/bin");
    expect(grok.TMPDIR).toBe("/tmp");
    expect(grok.LANG).toBe("C.UTF-8");
    expect(grok.http_proxy).toBe("http://proxy.example:8080");
    expect(grok.USE_BUILTIN_RIPGREP).toBe("0");
    expect(JSON.stringify(grok)).not.toContain("passcode-secret");
    expect(JSON.stringify(grok)).not.toContain("db-secret");

    const withKey = childEnv({ ...messy, XAI_API_KEY: "xai-real" }, "/home/botanical", "/opt/botanical-cli", "grok");
    expect(withKey.XAI_API_KEY).toBe("xai-real");
    expect(withKey.ANTHROPIC_API_KEY).toBeUndefined();

    const claude = childEnv(messy, "/home/botanical", "/opt/botanical-cli", "claude");
    expect(claude.ANTHROPIC_API_KEY).toBe("anthropic-secret");
    expect(claude.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-secret");
    expect(claude.XAI_API_KEY).toBeUndefined();
    expect(claude.OPENAI_API_KEY).toBeUndefined();
    expect(claude.DEEPSEEK_API_KEY).toBeUndefined();

    const codex = childEnv(messy, "/home/botanical", "/opt/botanical-cli", "codex");
    expect(codex.OPENAI_API_KEY).toBe("openai-secret");
    expect(codex.CODEX_API_KEY).toBe("codex-secret");
    expect(codex.ANTHROPIC_API_KEY).toBeUndefined();
    expect(codex.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(codex.TAVILY_API_KEY).toBeUndefined();
    expect(codex.BRAVE_API_KEY).toBeUndefined();
  });

  test("turn env keeps the MCP token extra and drops Botanical secrets", () => {
    const env = runChildEnv(
      { ...messy, XAI_API_KEY: "xai-real", BOTANICAL_CLI_BIN: "/opt/botanical-cli" },
      { BOTANICAL_MCP_TOKEN: "per-run-token", GROK_FOLDER_TRUST: "0" },
      "grok",
    );
    expect(env.BOTANICAL_MCP_TOKEN).toBe("per-run-token");
    expect(env.GROK_FOLDER_TRUST).toBe("0");
    expect(env.XAI_API_KEY).toBe("xai-real");
    expect(env.BOTANICAL_PASSWORD).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.PATH).toContain("/opt/botanical-cli/bin");
    expect(env.HOME).toBe("/tmp/old");
    expect(env.HTTPS_PROXY).toBe("http://proxy.example:8443");
    expect(env.NO_PROXY).toBe("localhost");
    expect(JSON.stringify(env)).not.toContain("passcode-secret");
    expect(JSON.stringify(env)).not.toContain("deepseek-secret");
  });
});

describe("pinned version lookup", () => {
  test("a missing pin names the version and the env var", async () => {
    const codexIo = memoryIo();
    codexIo.env = { BOTANICAL_CODEX_VERSION: "0.0.0-x" };
    const codex = await new CliInstaller(codexIo, { root: ROOT, home: HOME }).install("codex");
    expect(codex.ok).toBe(false);
    expect(codex.error).toBe("codex 0.0.0-x not found on npm (BOTANICAL_CODEX_VERSION)");

    const claudeIo = memoryIo();
    claudeIo.env = { BOTANICAL_CLAUDE_VERSION: "0.0.0-x" };
    const claude = await new CliInstaller(claudeIo, { root: ROOT, home: HOME }).install("claude");
    expect(claude.error).toBe("claude 0.0.0-x not found on npm (BOTANICAL_CLAUDE_VERSION)");

    const grokIo = memoryIo();
    grokIo.env = { BOTANICAL_GROK_VERSION: "9.9.9" };
    grokIo.download = async () => ({ status: 404, sha512B64: "", bytes: 0 });
    const grok = await new CliInstaller(grokIo, { root: ROOT, home: HOME }).install("grok");
    expect(grok.error).toBe("grok 9.9.9 not found (BOTANICAL_GROK_VERSION)");
  });
});

describe("availability after a stored Claude token", () => {
  test("a fresh .claude.json is not a login, a settings token is, and auth status exit 0 is", async () => {
    expect(claudeAuthStatusLoggedIn(1, '{"loggedIn":false,"authMethod":"none"}')).toBe(false);
    expect(claudeAuthStatusLoggedIn(0, '{"loggedIn":true,"authMethod":"oauth_token"}')).toBe(true);
    expect(claudeAuthStatusLoggedIn(0, "")).toBe(true);

    clearCliAvailabilityCache();
    const fresh = await checkCliAvailability(
      { cli: "claude", bin: "/opt/botanical-cli/bin/claude" },
      {
        cacheTtlMs: 0,
        env: {},
        probe: probe({
          exists: (path) => path === "/opt/botanical-cli/bin/claude" || path.endsWith("/.claude.json"),
          nonEmpty: (path) => path.endsWith("/.claude.json"),
          executable: () => true,
          readText: (path) =>
            path.endsWith("/.claude.json")
              ? JSON.stringify({ firstStartTime: "2026-09-27", machineID: "m", userID: "u" })
              : null,
          run: async (_bin, args) =>
            args[0] === "--version" ? 0 : { code: 1, stdout: '{"loggedIn":false,"authMethod":"none"}' },
          env: {},
        }),
      },
    );
    expect(fresh.available).toBe(false);
    expect(JSON.stringify(fresh)).not.toContain("machineID");

    clearCliAvailabilityCache();
    const authed = await checkCliAvailability(
      { cli: "claude", bin: "/opt/botanical-cli/bin/claude" },
      {
        cacheTtlMs: 0,
        env: {},
        probe: probe({
          exists: (path) => path === "/opt/botanical-cli/bin/claude",
          executable: () => true,
          run: async (_bin, args) => (args[0] === "--version" ? 0 : { code: 0, stdout: "" }),
          env: {},
        }),
      },
    );
    expect(authed.available).toBe(true);
  });

  test("the probe result is available and does not include the token", async () => {
    clearCliAvailabilityCache();
    const status = await checkCliAvailability(
      { cli: "claude", bin: "/opt/botanical-cli/bin/claude" },
      {
        cacheTtlMs: 0,
        env: {},
        probe: probe({
          exists: (path) => path === "/opt/botanical-cli/bin/claude",
          executable: () => true,
          run: async () => 0,
          env: {},
          readText: () => JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: SECRET } }),
        }),
      },
    );
    expect(status.available).toBe(true);
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(JSON.stringify(status)).not.toContain("super-secret");
  });
});

function probe(overrides: Partial<CliAvailabilityProbe>): CliAvailabilityProbe {
  return {
    which: () => null,
    exists: () => false,
    executable: () => false,
    home: () => HOME,
    env: {},
    run: async () => 1,
    ...overrides,
  };
}

function fakeProcess(): LoginProcess & { emit(chunk: string): void; killed: boolean; written: string } {
  let onData: (chunk: string) => void = () => undefined;
  let onExit: (code: number | null) => void = () => undefined;
  return {
    killed: false,
    written: "",
    write(text) {
      this.written += text;
    },
    kill() {
      this.killed = true;
    },
    onData(cb) {
      onData = cb;
    },
    onExit(cb) {
      onExit = cb;
    },
    emit(chunk) {
      onData(chunk);
    },
  };
}

interface MemOptions {
  arch?: CpuArch;
  libc?: Libc;
}

function memoryIo(options: MemOptions = {}): InstallIo & {
  files: Map<string, Uint8Array>;
  texts: string[];
  downloads: string[];
  integrity: { codex?: string };
} {
  const files = new Map<string, Uint8Array>();
  const texts: string[] = [];
  const downloads: string[] = [];
  const integrity: { codex?: string } = {};
  const script = new TextEncoder().encode("#!/bin/sh\necho botanical-cli 1\n");
  const claudeTar = gzipSync(packTar([{ name: "package/claude", data: script }]));
  const claudeSri = `sha512-${createHash("sha512").update(claudeTar).digest("base64")}`;
  const codexTar = (cpu: CpuArch) =>
    gzipSync(
      packTar([
        {
          name: `package/vendor/${codexTriple(cpu)}/bin/codex`,
          data: script,
        },
      ]),
    );

  const io: InstallIo & {
    files: Map<string, Uint8Array>;
    texts: string[];
    downloads: string[];
    integrity: { codex?: string };
  } = {
    files,
    texts,
    downloads,
    integrity,
    env: {},
    now: () => new Date("2026-09-27T00:00:00.000Z"),
    arch: () => options.arch ?? "x64",
    libc: () => options.libc ?? "musl",
    async fetchText(url) {
      texts.push(url);
      if (url === GROK_VERSION_URL) return { status: 200, text: "1.2.3" };
      return { status: 404, text: "" };
    },
    async fetchJson(url) {
      if (url.endsWith("/claude-code/latest")) return { status: 200, body: { version: "2.1.3" } };
      if (url.includes("claude-code-linux-") && url.endsWith("/2.1.3")) {
        return { status: 200, body: { dist: { tarball: "https://registry.example/claude.tgz", integrity: claudeSri } } };
      }
      if (url.endsWith("/codex/latest")) return { status: 200, body: { version: "0.4.2" } };
      if (url.includes("/codex/0.4.2-linux-")) {
        const cpu: CpuArch = url.endsWith("linux-arm64") ? "arm64" : "x64";
        const body = codexTar(cpu);
        const sri = integrity.codex ?? `sha512-${createHash("sha512").update(body).digest("base64")}`;
        files.set(`codex-tarball:${cpu}`, body);
        return {
          status: 200,
          body: { dist: { tarball: `https://registry.example/codex-0.4.2-linux-${cpu}.tgz`, integrity: sri } },
        };
      }
      return { status: 404, body: null };
    },
    async download(url, dest) {
      downloads.push(url);
      if (url.includes("grok-") && url.endsWith(".gz")) {
        const bytes = gzipSync(script);
        files.set(dest, bytes);
        return { status: 200, sha512B64: createHash("sha512").update(bytes).digest("base64"), bytes: bytes.length };
      }
      if (url.includes("claude.tgz")) {
        files.set(dest, claudeTar);
        return { status: 200, sha512B64: createHash("sha512").update(claudeTar).digest("base64"), bytes: claudeTar.length };
      }
      if (url.includes("codex-")) {
        const cpu: CpuArch = url.includes("arm64") ? "arm64" : "x64";
        const bytes = files.get(`codex-tarball:${cpu}`) ?? codexTar(cpu);
        files.set(dest, bytes);
        return { status: 200, sha512B64: createHash("sha512").update(bytes).digest("base64"), bytes: bytes.length };
      }
      return { status: 404, sha512B64: "", bytes: 0 };
    },
    async gunzip(src, dest) {
      const bytes = files.get(src);
      if (!bytes) throw new Error("missing gzip source");
      const { gunzipSync } = await import("node:zlib");
      files.set(dest, new Uint8Array(gunzipSync(bytes)));
    },
    async size(path) {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing ${path}`);
      return bytes.length;
    },
    async readAt(path, offset, length) {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`missing ${path}`);
      return bytes.subarray(offset, offset + length);
    },
    async read(path) {
      const bytes = files.get(path);
      return bytes ? bytes.slice() : null;
    },
    async write(path, data) {
      files.set(path, data.slice());
    },
    async mkdir() {
      return undefined;
    },
    async rename(from, to) {
      const bytes = files.get(from);
      if (!bytes) throw new Error(`missing ${from}`);
      files.set(to, bytes);
      files.delete(from);
    },
    async remove(path) {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
    exists(path) {
      return files.has(path);
    },
    async spawn() {
      return { code: 0, stdout: "1.2.3\n", stderr: "" };
    },
  };
  return io;
}

function packTar(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    parts.push(tarHeader(entry.name, entry.data.length));
    parts.push(entry.data);
    const pad = (512 - (entry.data.length % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(1024));
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function tarHeader(name: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  new TextEncoder().encodeInto(name, buf.subarray(0, 100));
  writeOctal(buf, 100, 8, 0o755);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0);
  buf.fill(0x20, 148, 156);
  buf[156] = 0x30;
  new TextEncoder().encodeInto("ustar", buf.subarray(257, 263));
  buf[262] = 0;
  new TextEncoder().encodeInto("00", buf.subarray(263, 265));
  return buf;
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  new TextEncoder().encodeInto(text, buf.subarray(offset, offset + length - 1));
}

