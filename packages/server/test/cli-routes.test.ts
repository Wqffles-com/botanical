import { describe, expect, test } from "bun:test";

import { LoginBusyError } from "@botanical/providers";
import { createCliService, type CliService } from "../src/cli-install/service.ts";
import type { InstallIo } from "@botanical/providers";
import { loadConfig } from "../src/config.ts";
import { bearer, login, readJson, setup, baseEnv } from "./helpers.ts";

const SECRET = "super-secret-token-value";

describe("coding CLI routes", () => {
  test("install accepts an empty body and an update flag", async () => {
    const updates: boolean[] = [];
    const cli = recording((next) => {
      updates.push(next);
    });
    const { app } = setup({ BOTANICAL_CLI_PROFILES: "grok-build" }, { cli });
    const { token } = await login(app);
    const empty = await app.fetch(
      new Request("http://localhost/api/cli/grok/install", { method: "POST", headers: bearer(token) }),
    );
    expect(empty.status).toBe(200);
    expect(updates).toEqual([false]);
    const again = await app.fetch(
      new Request("http://localhost/api/cli/grok/install", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ update: true }),
      }),
    );
    expect(again.status).toBe(200);
    expect(updates).toEqual([false, true]);
    const body = await readJson<{ cli: { version: string; lastError: string | null } }>(again);
    expect(body.cli.version).toBe("1.2.3");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test("require a session and reject unknown or disabled CLIs", async () => {
    const calls: string[] = [];
    const cli = stub((name) => {
      calls.push(name);
      return null;
    });
    const { app } = setup({ BOTANICAL_CLI_PROFILES: "grok-build" }, { cli });
    const anonymous = await app.fetch(new Request("http://localhost/api/cli"));
    expect(anonymous.status).toBe(401);

    const { token } = await login(app);
    const unknown = await app.fetch(
      new Request("http://localhost/api/cli/not-a-cli/install", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: "{}",
      }),
    );
    expect(unknown.status).toBe(404);

    const disabled = await app.fetch(
      new Request("http://localhost/api/cli/claude/install", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(token) },
        body: JSON.stringify({ update: true }),
      }),
    );
    expect(disabled.status).toBe(404);
    expect(calls).toEqual([]);

    const busy = stub(() => {
      throw new LoginBusyError();
    });
    const second = setup({ BOTANICAL_CLI_PROFILES: "grok-build" }, { cli: busy.service });
    const session = await login(second.app);
    const conflict = await second.app.fetch(
      new Request("http://localhost/api/cli/grok/login", {
        method: "POST",
        headers: bearer(session.token),
      }),
    );
    expect(conflict.status).toBe(409);
  });

  test("status reports logged-in without returning credential bytes", async () => {
    const env = baseEnv({ BOTANICAL_CLI_PROFILES: "grok-build,claude-code" });
    const config = loadConfig(env);
    const home = "/home/botanical";
    const root = "/opt/botanical-cli";
    const files = new Map<string, Uint8Array>();
    const secretBody = new TextEncoder().encode(`{"access_token":"${SECRET}","refresh":"${SECRET}"}`);
    files.set(`${home}/.grok/auth.json`, secretBody);
    files.set(`${root}/bin/claude`, new Uint8Array([1, 2, 3]));
    const io = memory(files);
    io.spawn = async () => ({ code: 0, stdout: `logged in ${SECRET}`, stderr: SECRET });
    const cli = createCliService({
      env,
      profiles: () => config.profiles,
      io,
      homeDir: home,
      rootDir: root,
      spawnLogin: () => {
        throw new Error("login spawn");
      },
    });
    const { app } = setup(env, { cli });
    const { token } = await login(app);
    const response = await app.fetch(new Request("http://localhost/api/cli", { headers: bearer(token) }));
    expect(response.status).toBe(200);
    const body = await readJson<{ clis: { cli: string; loggedIn: boolean | string; lastError: string | null }[] }>(response);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("access_token");
    expect(body.clis.find((item) => item.cli === "grok")?.loggedIn).toBe(true);
    expect(body.clis.find((item) => item.cli === "claude")?.loggedIn).toBe(true);
    expect(body.clis.find((item) => item.cli === "codex")).toBeUndefined();
  });

  test("grok login is the auth file or a non-empty XAI_API_KEY", async () => {
    const home = "/home/botanical";
    const root = "/opt/botanical-cli";
    const files = new Map<string, Uint8Array>();
    files.set(`${root}/bin/grok`, new Uint8Array([1]));
    const blank = baseEnv({ BOTANICAL_CLI_PROFILES: "grok-build", XAI_API_KEY: "   " });
    const blankConfig = loadConfig(blank);
    const blankIo = memory(files);
    blankIo.spawn = async () => ({ code: 0, stdout: "You are not authenticated.\n", stderr: "" });
    expect(await cliLoggedIn(blank, blankConfig.profiles, blankIo, home, root, "grok")).toBe(false);

    const keyed = baseEnv({ BOTANICAL_CLI_PROFILES: "grok-build", XAI_API_KEY: "xai-status-key" });
    const keyedConfig = loadConfig(keyed);
    const keyedIo = memory(files);
    expect(await cliLoggedIn(keyed, keyedConfig.profiles, keyedIo, home, root, "grok")).toBe(true);
  });

  test("a fresh .claude.json is not a login and a settings token is", async () => {
    const env = baseEnv({ BOTANICAL_CLI_PROFILES: "claude-code" });
    const config = loadConfig(env);
    const home = "/home/botanical";
    const root = "/opt/botanical-cli";
    const freshFiles = new Map<string, Uint8Array>();
    freshFiles.set(
      `${home}/.claude.json`,
      new TextEncoder().encode(JSON.stringify({ firstStartTime: "2026-09-27", machineID: "machine", userID: "user" })),
    );
    freshFiles.set(`${root}/bin/claude`, new Uint8Array([1]));
    const freshIo = memory(freshFiles);
    freshIo.spawn = async () => ({ code: 1, stdout: '{"loggedIn":false,"authMethod":"none"}', stderr: "" });
    const fresh = await cliLoggedIn(env, config.profiles, freshIo, home, root, "claude");
    expect(fresh).toBe(false);

    const tokenFiles = new Map(freshFiles);
    tokenFiles.set(
      `${home}/.claude/settings.json`,
      new TextEncoder().encode(JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: SECRET } })),
    );
    const tokenIo = memory(tokenFiles);
    tokenIo.spawn = async () => ({ code: 1, stdout: '{"loggedIn":false}', stderr: SECRET });
    const authed = await cliLoggedIn(env, config.profiles, tokenIo, home, root, "claude");
    expect(authed).toBe(true);
  });
});

async function cliLoggedIn(
  env: Record<string, string>,
  profiles: readonly { id: string; name: string; provider: string; kind?: string; cli?: string }[],
  io: InstallIo,
  home: string,
  root: string,
  cliName: "grok" | "claude",
): Promise<boolean> {
  const cli = createCliService({
    env,
    profiles: () => profiles,
    io,
    homeDir: home,
    rootDir: root,
    spawnLogin: () => {
      throw new Error("login spawn");
    },
  });
  const { app } = setup(env, { cli });
  const { token } = await login(app);
  const response = await app.fetch(new Request("http://localhost/api/cli", { headers: bearer(token) }));
  const body = await readJson<{ clis: { cli: string; loggedIn: boolean | string }[] }>(response);
  const raw = JSON.stringify(body);
  expect(raw).not.toContain(SECRET);
  expect(raw).not.toContain("machineID");
  expect(raw).not.toContain("xai-status-key");
  return body.clis.find((item) => item.cli === cliName)?.loggedIn === true;
}

function recording(onInstall: (update: boolean) => void): CliService {
  const row = {
    id: "grok-build",
    label: "Grok Build",
    cli: "grok" as const,
    status: "installed" as const,
    version: "1.2.3",
    arch: "x86_64",
    loggedIn: false as const,
    lastError: null,
    logTail: null,
  };
  return {
    describe(cli) {
      return cli === "grok" ? { id: "grok-build", label: "Grok Build", cli: "grok" } : null;
    },
    async list() {
      return [row];
    },
    async install(_cli, update) {
      onInstall(update);
      return row;
    },
    loginStart() {
      return idle();
    },
    loginGet() {
      return idle();
    },
    async loginInput() {
      return idle();
    },
    loginCancel() {
      return idle();
    },
    async installEnabled() {
      return undefined;
    },
    close() {
      return undefined;
    },
  };
}

function stub(onLogin: (name: string) => null): CliService & { service: CliService } {
  const service: CliService = {
    describe(cli) {
      if (cli !== "grok") return null;
      return { id: "grok-build", label: "Grok Build", cli: "grok" };
    },
    async list() {
      return [];
    },
    async install(cli) {
      onLogin(cli);
      throw new Error("install should not run");
    },
    loginStart(cli) {
      onLogin(cli);
      throw new LoginBusyError();
    },
    loginGet() {
      return idle();
    },
    async loginInput() {
      return idle();
    },
    loginCancel() {
      return idle();
    },
    async installEnabled() {
      return undefined;
    },
    close() {
      return undefined;
    },
  };
  return Object.assign(service, { service });
}

function idle() {
  return {
    cli: "grok" as const,
    state: "idle" as const,
    verificationUrl: null,
    userCode: null,
    prompt: null,
    error: null,
    lines: [],
  };
}

function memory(files: Map<string, Uint8Array>): InstallIo {
  return {
    env: {},
    now: () => new Date("2026-09-27T00:00:00.000Z"),
    arch: () => "x64",
    libc: () => "musl",
    async fetchText() {
      return { status: 404, text: "" };
    },
    async fetchJson() {
      return { status: 404, body: null };
    },
    async download() {
      return { status: 404, sha512B64: "", bytes: 0 };
    },
    async gunzip() {
      return undefined;
    },
    async size(path) {
      return files.get(path)?.length ?? 0;
    },
    async readAt(path, offset, length) {
      const bytes = files.get(path) ?? new Uint8Array();
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
    async rename() {
      return undefined;
    },
    async remove() {
      return undefined;
    },
    exists(path) {
      return files.has(path);
    },
    async spawn() {
      return { code: 1, stdout: "", stderr: "" };
    },
  };
}
