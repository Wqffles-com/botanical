import { spawn } from "node:child_process";

import {
  childEnv,
  claudeHasLogin,
  grokHasLogin,
  CliInstaller,
  cliHomeFrom,
  cliRootFrom,
  fileHasCredential,
  isCliName,
  LoginBusyError,
  LoginManager,
  type CliName,
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
}

export interface CliListItem {
  id: string;
  label: string;
  cli: CliName;
  status: "not_installed" | "installing" | "installed" | "failed";
  version: string | null;
  arch: string | null;
  loggedIn: boolean | "unknown";
  lastError: string | null;
  logTail: string | null;
}

export interface CliService {
  list(): Promise<CliListItem[]>;
  describe(cli: string): EnabledCli | null;
  install(cli: string, update: boolean): Promise<CliListItem>;
  loginStart(cli: string): LoginView;
  loginGet(cli: string): LoginView;
  loginInput(cli: string, value: string): Promise<LoginView>;
  loginCancel(cli: string): LoginView;
  installEnabled(): Promise<void>;
  close(): void;
}

export interface CliServiceOptions {
  env: Record<string, string | undefined>;
  profiles: () => readonly CliProfileSource[];
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
  const installer = new CliInstaller(io, { root, home });
  const login = new LoginManager({
    timeoutMs: options.loginTimeoutMs,
    resolveBin: (cli) => {
      const installed = installer.binPath(cli);
      return io.exists(installed) ? installed : null;
    },
    envFor: (cli) => childEnv(env, home, root, cli),
    spawn: options.spawnLogin ?? spawnLoginProcess,
    isLoggedIn: (cli) => loggedIn(io, installer, env, home, root, cli),
    persistClaudeToken: (token) => writeClaudeToken(io, home, token),
  });

  function enabled(): EnabledCli[] {
    const seen = new Set<CliName>();
    const list: EnabledCli[] = [];
    for (const profile of options.profiles()) {
      const kind = profile.kind ?? (profile.provider === "cli" ? "cli" : "api");
      if (kind !== "cli" || !profile.cli || !isCliName(profile.cli) || seen.has(profile.cli)) continue;
      seen.add(profile.cli);
      list.push({ id: profile.id, label: profile.name, cli: profile.cli });
    }
    return list;
  }

  function describe(cli: string): EnabledCli | null {
    if (!isCliName(cli)) return null;
    return enabled().find((item) => item.cli === cli) ?? null;
  }

  async function row(item: EnabledCli): Promise<CliListItem> {
    const view = await installer.view(item.cli);
    let logged: boolean | "unknown" = "unknown";
    try {
      logged = await loggedIn(io, installer, env, home, root, item.cli);
    } catch {
      logged = "unknown";
    }
    return {
      id: item.id,
      label: item.label,
      cli: item.cli,
      status: view.status,
      version: view.version,
      arch: view.arch,
      loggedIn: logged,
      lastError: view.lastError,
      logTail: view.logTail,
    };
  }

  return {
    describe,
    async list() {
      const items = [];
      for (const item of enabled()) items.push(await row(item));
      return items;
    },
    async install(cli, update) {
      const item = describe(cli);
      if (!item) throw new Error("CLI is not enabled");
      await installer.install(item.cli, { update });
      return row(item);
    },
    loginStart(cli) {
      const item = describe(cli);
      if (!item) throw new Error("CLI is not enabled");
      return login.start(item.cli);
    },
    loginGet(cli) {
      const item = describe(cli);
      if (!item) throw new Error("CLI is not enabled");
      return login.view(item.cli);
    },
    loginInput(cli, value) {
      const item = describe(cli);
      if (!item) throw new Error("CLI is not enabled");
      return login.input(item.cli, value);
    },
    loginCancel(cli) {
      const item = describe(cli);
      if (!item) throw new Error("CLI is not enabled");
      return login.cancel(item.cli);
    },
    async installEnabled() {
      await installer.installMany(enabled().map((item) => item.cli));
    },
    close() {
      login.close();
    },
  };
}

export { LoginBusyError };

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
