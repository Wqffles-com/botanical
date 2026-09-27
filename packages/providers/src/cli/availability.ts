import { accessSync, constants, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

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
  run(bin: string, args: readonly string[], timeoutMs: number): Promise<number>;
}

export async function checkCliAvailability(
  spec: Pick<CliProfileSpec, "cli" | "bin">,
  options?: { env?: Record<string, string | undefined>; now?: number; probe?: CliAvailabilityProbe; cacheTtlMs?: number },
): Promise<CliAvailability> {
  const env = options?.env ?? process.env;
  const probe = options?.probe ?? defaultProbe(env);
  const now = options?.now ?? Date.now();
  const ttl = options?.cacheTtlMs ?? CACHE_TTL_MS;
  const key = `${spec.cli}\0${spec.bin ?? ""}\0${probe.home()}\0${env.ANTHROPIC_API_KEY ? "1" : "0"}`;
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
    if (probe.exists(join(home, ".grok", "auth.json"))) return { ok: true };
    const code = await probe.run(bin, ["models"], PROBE_TIMEOUT_MS);
    if (code === 0) return { ok: true };
    return { ok: false, reason: "grok is not logged in (no ~/.grok/auth.json and `grok models` failed)" };
  }
  if (cli === "claude") {
    const version = await probe.run(bin, ["--version"], PROBE_TIMEOUT_MS);
    if (version !== 0) return { ok: false, reason: "claude --version failed" };
    const key = probe.env.ANTHROPIC_API_KEY?.trim() ?? "";
    if (key) return { ok: true };
    const creds = [
      join(home, ".claude", ".credentials.json"),
      join(home, ".claude", "credentials.json"),
      join(home, ".claude.json"),
    ];
    if (creds.some((path) => probe.exists(path))) return { ok: true };
    return {
      ok: false,
      reason: "claude has no credentials (set ANTHROPIC_API_KEY or sign in so a credentials file exists)",
    };
  }
  if (probe.exists(join(home, ".codex", "auth.json"))) return { ok: true };
  const code = await probe.run(bin, ["login", "status"], PROBE_TIMEOUT_MS);
  if (code === 0) return { ok: true };
  return { ok: false, reason: "codex is not logged in (no ~/.codex/auth.json and `codex login status` failed)" };
}

function defaultProbe(env: Record<string, string | undefined>): CliAvailabilityProbe {
  return {
    env,
    which(name: string) {
      const found = Bun.which(name);
      return found ?? null;
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
    run(bin, args, timeoutMs) {
      return runProbe(bin, args, timeoutMs, env);
    },
  };
}

function runProbe(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
  env: Record<string, string | undefined>,
): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const child = spawn(bin, [...args], {
      stdio: "ignore",
      env: stringEnv(env),
      detached: process.platform !== "win32",
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

function stringEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") next[key] = value;
  }
  const home = env.BOTANICAL_CLI_HOME?.trim() || env.HOME;
  if (home) next.HOME = home;
  return next;
}
