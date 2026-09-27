import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

import { claudeHasLogin, grokHasLogin } from "./artifact.ts";
import { scrubCliEnv } from "./child-env.ts";
import type { CliAvailability, CliName, CliProfileSpec } from "./types.ts";

const CACHE_TTL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;

interface CacheEntry {
  at: number;
  status: CliAvailability;
}

const cache = new Map<string, CacheEntry>();

export function clearCliAvailabilityCache(): void {
  cache.clear();
}

export interface CliAvailabilityProbe {
  which(name: string): string | null;
  exists(path: string): boolean;
  executable(path: string): boolean;
  home(): string;
  env: Record<string, string | undefined>;
  run(bin: string, args: readonly string[], timeoutMs: number): Promise<number | { code: number; stdout?: string }>;
  /** Size > 0. When omitted, `exists` is used. */
  nonEmpty?(path: string): boolean;
  /** File text, or null when missing. Used to notice a Claude token without returning it. */
  readText?(path: string): string | null;
}

export async function checkCliAvailability(
  spec: Pick<CliProfileSpec, "cli" | "bin">,
  options?: { env?: Record<string, string | undefined>; now?: number; probe?: CliAvailabilityProbe; cacheTtlMs?: number },
): Promise<CliAvailability> {
  const env = options?.env ?? process.env;
  const probe = options?.probe ?? defaultProbe(env, spec.cli);
  const now = options?.now ?? Date.now();
  const ttl = options?.cacheTtlMs ?? CACHE_TTL_MS;
  const key = `${spec.cli}\0${spec.bin ?? ""}\0${probe.home()}\0${flag(env.ANTHROPIC_API_KEY)}\0${flag(env.CLAUDE_CODE_OAUTH_TOKEN)}\0${flag(env.XAI_API_KEY)}\0${flag(env.OPENAI_API_KEY)}`;
  const cached = cache.get(key);
  if (cached && now - cached.at < ttl) return cached.status;
  const status = await detect(spec, probe);
  cache.set(key, { at: now, status });
  return status;
}

async function detect(spec: Pick<CliProfileSpec, "cli" | "bin">, probe: CliAvailabilityProbe): Promise<CliAvailability> {
  const resolved = resolveBinary(spec, probe);
  if (!resolved.ok) return { available: false, unavailableReason: resolved.reason };
  const login = await loginOk(spec.cli, resolved.path, probe);
  if (!login.ok) return { available: false, unavailableReason: login.reason, bin: resolved.path };
  return { available: true, bin: resolved.path };
}

function resolveBinary(
  spec: Pick<CliProfileSpec, "cli" | "bin">,
  probe: CliAvailabilityProbe,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (spec.bin) {
    if (!isAbsolute(spec.bin)) {
      return { ok: false, reason: `CLI bin for ${spec.cli} must be an absolute path` };
    }
    if (!probe.exists(spec.bin)) return { ok: false, reason: `CLI binary not found at ${spec.bin}` };
    if (!probe.executable(spec.bin)) return { ok: false, reason: `CLI binary is not executable: ${spec.bin}` };
    return { ok: true, path: spec.bin };
  }
  const found = probe.which(binaryName(spec.cli));
  if (!found) return { ok: false, reason: `${binaryName(spec.cli)} is not on PATH` };
  return { ok: true, path: found };
}

function credentialPresent(path: string, probe: CliAvailabilityProbe): boolean {
  if (probe.nonEmpty) return probe.nonEmpty(path);
  return probe.exists(path);
}

function binaryName(cli: CliName): string {
  return cli;
}

async function loginOk(
  cli: CliName,
  bin: string,
  probe: CliAvailabilityProbe,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const home = probe.home();
  if (cli === "grok") {
    if (
      grokHasLogin({
        authNonEmpty: credentialPresent(join(home, ".grok", "auth.json"), probe),
        apiKey: probe.env.XAI_API_KEY,
      })
    ) {
      return { ok: true };
    }
    return { ok: false, reason: "grok is not logged in (no ~/.grok/auth.json and XAI_API_KEY is unset)" };
  }
  if (cli === "claude") {
    const version = await probeRun(probe, bin, ["--version"]);
    if (version.code !== 0) return { ok: false, reason: "claude --version failed" };
    const settingsText = probe.readText ? probe.readText(join(home, ".claude", "settings.json")) : null;
    const signals = {
      apiKey: probe.env.ANTHROPIC_API_KEY,
      oauthToken: probe.env.CLAUDE_CODE_OAUTH_TOKEN,
      settingsText,
      credentialsNonEmpty: credentialPresent(join(home, ".claude", ".credentials.json"), probe),
    };
    if (claudeHasLogin(signals)) return { ok: true };
    const status = await probeRun(probe, bin, ["auth", "status"]);
    if (claudeHasLogin({ ...signals, authStatus: status })) return { ok: true };
    return {
      ok: false,
      reason: "claude is not logged in (no API key, token, or credentials; `claude auth status` did not report a login)",
    };
  }
  if (credentialPresent(join(home, ".codex", "auth.json"), probe)) return { ok: true };
  const status = await probeRun(probe, bin, ["login", "status"]);
  if (status.code === 0) return { ok: true };
  return { ok: false, reason: "codex is not logged in (no ~/.codex/auth.json and `codex login status` failed)" };
}

function flag(value: string | undefined): "1" | "0" {
  return value?.trim() ? "1" : "0";
}

function defaultProbe(env: Record<string, string | undefined>, cli: CliName): CliAvailabilityProbe {
  return {
    env,
    which(name: string) {
      const found = Bun.which(name);
      if (found) return found;
      const root = env.BOTANICAL_CLI_BIN?.trim() || "/opt/botanical-cli";
      const candidate = join(root, "bin", name);
      if (!existsSync(candidate)) return null;
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        return null;
      }
    },
    exists(path: string) {
      return existsSync(path);
    },
    executable(path: string) {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    home() {
      return env.BOTANICAL_CLI_HOME?.trim() || env.HOME?.trim() || "/tmp";
    },
    nonEmpty(path: string) {
      try {
        return statSync(path).size > 0;
      } catch {
        return false;
      }
    },
    readText(path: string) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    run(bin, args, timeoutMs) {
      return runProbe(bin, args, timeoutMs, env, cli);
    },
  };
}

async function probeRun(
  probe: CliAvailabilityProbe,
  bin: string,
  args: readonly string[],
): Promise<{ code: number; stdout: string }> {
  const result = await probe.run(bin, args, PROBE_TIMEOUT_MS);
  if (typeof result === "number") return { code: result, stdout: "" };
  return { code: result.code, stdout: result.stdout ?? "" };
}

function runProbe(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
  env: Record<string, string | undefined>,
  cli: CliName,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const child = spawn(bin, [...args], {
      stdio: ["ignore", "pipe", "ignore"],
      env: stringEnv(env, cli),
      detached: process.platform !== "win32",
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length >= 8_000) return;
      stdout = (stdout + chunk.toString("utf8")).slice(0, 8_000);
    });
    const timer = setTimeout(() => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
      finish(124);
    }, timeoutMs);
    child.on("error", () => finish(127));
    child.on("exit", (code) => finish(code ?? 1));
  });
}

function stringEnv(env: Record<string, string | undefined>, cli: CliName): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = scrubCliEnv(env, cli);
  const home = env.BOTANICAL_CLI_HOME?.trim() || env.HOME?.trim();
  if (home) next.HOME = home;
  return next;
}
