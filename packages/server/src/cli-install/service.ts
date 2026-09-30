import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { currentUserId } from "@botanical/db";

import {
  checkCliAvailability,
  childEnv,
  CLI_NAMES,
  cliPresetSpec,
  claudeHasLogin,
  grokHasLogin,
  CliInstaller,
  cliCacheFrom,
  cliHomeFrom,
  cliRootFrom,
  fileHasCredential,
  isCliName,
  LoginBusyError,
  LoginManager,
  type CliAvailability,
  type CliName,
  type CliProfileSpec,
  type InstallIo,
  type LoginProcess,
  type LoginView,
} from "@botanical/providers";

import { createNodeInstallIo } from "./node-io.ts";

export interface CliProfileSource {
  id: string;
  name: string;
  provider: string;
  kind?: string;
  cli?: string;
}

export interface EnabledCli {
  id: string;
  label: string;
  cli: CliName;
  /** A profile uses this CLI. Otherwise installing it adds the preset profile. */
  enabled: boolean;
}

export interface CliListItem {
  id: string;
  label: string;
  cli: CliName;
  enabled: boolean;
  status: "not_installed" | "installing" | "installed" | "failed";
  version: string | null;
  arch: string | null;
  loggedIn: boolean | "unknown";
  lastError: string | null;
  logTail: string | null;
}

export interface CliService {
  list(userId: string): Promise<CliListItem[]>;
  install(cli: string, update: boolean, userId: string): Promise<CliListItem>;
  loginStart(cli: string, userId: string): LoginView;
  loginGet(cli: string, userId: string): LoginView;
  loginInput(cli: string, userId: string, value: string): Promise<LoginView>;
  loginCancel(cli: string, userId: string): LoginView;
  installEnabled(): Promise<void>;
  close(): void;
}

export interface CliServiceOptions {
  env: Record<string, string | undefined>;
  profiles: () => readonly CliProfileSource[] | Promise<readonly CliProfileSource[]>;
  /** Adds the preset profile for a CLI installed from settings that no profile used yet. */
  enable?: (cli: CliName) => Promise<void>;
  io?: InstallIo;
  spawnLogin?: (bin: string, args: readonly string[], env: Record<string, string | undefined>) => LoginProcess;
  loginTimeoutMs?: number;
  rootDir?: string;
  homeDir?: string;
}

export function createCliService(options: CliServiceOptions): CliService {
  const env = options.env;
  const root = options.rootDir ?? cliRootFrom(env);
  const home = options.homeDir ?? cliHomeFrom(env);
  const io = options.io ?? createNodeInstallIo(env);
  const installer = new CliInstaller(io, { root, home, cache: cliCacheFrom(env) });
  const logins = new Map<string, LoginManager>();

  function userHome(userId: string): string {
    return cliUserHome(home, userId);
  }

  function loginFor(userId: string): LoginManager {
    const existing = logins.get(userId);
    if (existing) return existing;
    const userDir = userHome(userId);
    void io.mkdir(userDir);
    const manager = new LoginManager({
      timeoutMs: options.loginTimeoutMs,
      resolveBin: (cli) => {
        const installed = installer.binPath(cli);
        return io.exists(installed) ? installed : null;
      },
      envFor: (cli) => childEnv(env, userDir, root, cli),
      spawn: options.spawnLogin ?? spawnLoginProcess,
      isLoggedIn: (cli) => loggedIn(io, installer, env, userDir, root, cli),
      persistClaudeToken: (token) => writeClaudeToken(io, userDir, token),
    });
    logins.set(userId, manager);
    return manager;
  }

  async function enabled(): Promise<EnabledCli[]> {
    const seen = new Set<CliName>();
    const list: EnabledCli[] = [];
    for (const profile of await options.profiles()) {
      const kind = profile.kind ?? (profile.provider === "cli" ? "cli" : "api");
      if (kind !== "cli" || !profile.cli || !isCliName(profile.cli) || seen.has(profile.cli)) continue;
      seen.add(profile.cli);
      list.push({ id: profile.id, label: profile.name, cli: profile.cli, enabled: true });
    }
    return list;
  }

  /** Every known CLI: enabled ones first, then the rest as installable presets. */
  async function all(): Promise<EnabledCli[]> {
    const list = await enabled();
    for (const cli of CLI_NAMES) {
      if (list.some((item) => item.cli === cli)) continue;
      const preset = cliPresetSpec(cli);
      list.push({ id: preset.id, label: preset.label, cli, enabled: false });
    }
    return list;
  }

  async function describe(cli: string): Promise<EnabledCli> {
    if (!isCliName(cli)) throw new Error("Unknown CLI");
    const item = (await all()).find((entry) => entry.cli === cli);
    if (!item) throw new Error("Unknown CLI");
    return item;
  }

  async function row(item: EnabledCli, userId: string): Promise<CliListItem> {
    const view = await installer.view(item.cli);
    let logged: boolean | "unknown" = "unknown";
    const userDir = userHome(userId);
    try {
      await io.mkdir(userDir);
      logged = await loggedIn(io, installer, env, userDir, root, item.cli);
    } catch {
      logged = "unknown";
    }
    return {
      id: item.id,
      label: item.label,
      cli: item.cli,
      enabled: item.enabled,
      status: view.status,
      version: view.version,
      arch: view.arch,
      loggedIn: logged,
      lastError: view.lastError,
      logTail: view.logTail,
    };
  }

  function known(cli: string): CliName {
    if (!isCliName(cli)) throw new Error("Unknown CLI");
    return cli;
  }

  return {
    async list(userId) {
      const items = [];
      for (const item of await all()) items.push(await row(item, userId));
      return items;
    },
    async install(cli, update, userId) {
      const item = await describe(cli);
      await installer.install(item.cli, { update });
      if (!item.enabled && options.enable && (await installer.view(item.cli)).status === "installed") {
        await options.enable(item.cli);
        return row(await describe(cli), userId);
      }
      return row(item, userId);
    },
    loginStart(cli, userId) {
      return loginFor(userId).start(known(cli));
    },
    loginGet(cli, userId) {
      return loginFor(userId).view(known(cli));
    },
    loginInput(cli, userId, value) {
      return loginFor(userId).input(known(cli), value);
    },
    loginCancel(cli, userId) {
      return loginFor(userId).cancel(known(cli));
    },
    async installEnabled() {
      await installer.installMany((await enabled()).map((item) => item.cli));
    },
    close() {
      for (const manager of logins.values()) manager.close();
    },
  };
}

export { LoginBusyError };

/** Per-user CLI home. Logins from the settings panel write here, and chat turns run here. */
export function cliUserHome(home: string, userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "user";
  return join(home, "users", safe);
}

/**
 * Env whose HOME is the acting user's CLI home, so availability checks and
 * chat turns see the credentials that user's settings-panel login stored.
 */
export function userCliEnv(env: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = { ...process.env, ...env };
  const userId = currentUserId();
  if (!userId) return base;
  const home = cliUserHome(cliHomeFrom(base), userId);
  try {
    mkdirSync(home, { recursive: true });
  } catch {
    return base;
  }
  return { ...base, HOME: home, BOTANICAL_CLI_HOME: home };
}

/**
 * Availability for the acting user. A login in the user's own CLI home wins.
 * A login in the shared server home (a terminal `login` inside the container)
 * still counts. `env` is the one the turn must run with to see that login.
 */
export async function userCliAvailability(
  spec: Pick<CliProfileSpec, "cli" | "bin">,
  env: Record<string, string | undefined> = {},
): Promise<{ status: CliAvailability; env: Record<string, string | undefined> }> {
  const base: Record<string, string | undefined> = { ...process.env, ...env };
  const user = userCliEnv(env);
  const status = await checkCliAvailability(spec, { env: user });
  if (status.available || user.BOTANICAL_CLI_HOME === base.BOTANICAL_CLI_HOME) return { status, env: user };
  const shared = await checkCliAvailability(spec, { env: base });
  return shared.available ? { status: shared, env: base } : { status, env: user };
}

async function loggedIn(
  io: InstallIo,
  installer: CliInstaller,
  env: Record<string, string | undefined>,
  home: string,
  root: string,
  cli: CliName,
): Promise<boolean> {
  if (cli === "grok") {
    return grokHasLogin({
      authNonEmpty: fileHasCredential(await io.read(`${home}/.grok/auth.json`)),
      apiKey: env.XAI_API_KEY,
    });
  }
  if (cli === "codex") {
    const bin = installer.binPath(cli);
    if (io.exists(bin)) {
      const result = await io.spawn(bin, ["login", "status"], childEnv(env, home, root, cli), 8_000);
      if (result.code === 0) return true;
    }
    return fileHasCredential(await io.read(`${home}/.codex/auth.json`));
  }
  const settingsBytes = await io.read(`${home}/.claude/settings.json`);
  const credentials = await io.read(`${home}/.claude/.credentials.json`);
  const signals = {
    apiKey: env.ANTHROPIC_API_KEY,
    oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN,
    settingsText: settingsBytes ? new TextDecoder().decode(settingsBytes) : null,
    credentialsNonEmpty: fileHasCredential(credentials),
  };
  if (claudeHasLogin(signals)) return true;
  const bin = installer.binPath("claude");
  if (!io.exists(bin)) return false;
  const result = await io.spawn(bin, ["auth", "status"], childEnv(env, home, root, "claude"), 8_000);
  return claudeHasLogin({ ...signals, authStatus: { code: result.code, stdout: result.stdout } });
}

async function writeClaudeToken(io: InstallIo, home: string, token: string): Promise<void> {
  const dir = `${home}/.claude`;
  const path = `${dir}/settings.json`;
  await io.mkdir(dir);
  let current: Record<string, unknown> = {};
  const existing = await io.read(path);
  if (existing) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(existing)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  const envBlock =
    current.env && typeof current.env === "object" && !Array.isArray(current.env)
      ? { ...(current.env as Record<string, unknown>) }
      : {};
  envBlock.CLAUDE_CODE_OAUTH_TOKEN = token;
  current.env = envBlock;
  await io.write(path, new TextEncoder().encode(`${JSON.stringify(current, null, 2)}\n`), 0o600);
}

function spawnLoginProcess(
  bin: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
): LoginProcess {
  const child = spawn(bin, [...args], {
    env: definedEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const buffered: string[] = [];
  let onData: ((chunk: string) => void) | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  let exitCode: number | null | undefined;
  const push = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (onData) onData(text);
    else buffered.push(text);
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("error", () => {
    if (onExit) onExit(null);
    else exitCode = null;
  });
  child.on("exit", (code) => {
    if (onExit) onExit(code);
    else exitCode = code;
  });
  return {
    write(text) {
      child.stdin?.write(text);
    },
    kill() {
      const pid = child.pid;
      if (pid && process.platform !== "win32") {
        try {
          process.kill(-pid, "SIGTERM");
          return;
        } catch {
          // Fall back to the child pid.
        }
      }
      child.kill("SIGTERM");
    },
    onData(cb) {
      onData = cb;
      for (const chunk of buffered) cb(chunk);
      buffered.length = 0;
    },
    onExit(cb) {
      onExit = cb;
      if (exitCode !== undefined) cb(exitCode);
    },
  };
}

function definedEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") next[key] = value;
  }
  return next;
}
