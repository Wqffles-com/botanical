import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { scrubEnv } from "./env.ts";
import { isInside, resolveWorkspaceCwd } from "./paths.ts";
import { ENTER_JAIL_SCRIPT } from "./script.ts";

const REQUIRED_BINARIES = [
  "/usr/bin/unshare",
  "/bin/bash",
  "/usr/sbin/pivot_root",
  "/bin/sh",
  "/usr/bin/mount",
  "/usr/bin/mountpoint",
] as const;

export interface SandboxCheck {
  ok: boolean;
  missing: string[];
  prlimit: boolean;
}

/** Linux user-namespace jail prerequisites. Does not try to start a jail. */
export function checkShellSandbox(): SandboxCheck {
  if (process.platform !== "linux") {
    return { ok: false, missing: ["linux"], prlimit: false };
  }
  const missing = REQUIRED_BINARIES.filter((bin) => !existsSync(bin));
  return {
    ok: missing.length === 0,
    missing: [...missing],
    prlimit: existsSync("/usr/bin/prlimit"),
  };
}

export interface SandboxRequest {
  workspaceRoot: string;
  cwd?: string;
  /** argv executed inside the jail after pivot_root. Not a shell string. */
  argv: readonly string[];
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxStdinBytes: number;
  /** When false, unshare gets `--net` (no host network). */
  network: boolean;
  extraEnv?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  scratchFiles?: readonly { name: string; contents: string }[];
  maxFileBytes: number;
  nofile: number;
}

export interface SandboxResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  aborted: boolean;
  jailCwd: string;
  durationMs: number;
  /** Set when the jail never reached the user command. */
  sandboxError?: string;
  /** Setup stderr with host paths removed. Not for the model. */
  operatorDiagnostic?: string;
}

export function buildLauncherArgv(opts: {
  network: boolean;
  scriptPath: string;
  command: readonly string[];
  cpuSeconds: number;
  maxFileBytes: number;
  nofile: number;
  prlimit: boolean;
}): string[] {
  const argv: string[] = [];
  if (opts.prlimit) {
    argv.push(
      "/usr/bin/prlimit",
      `--fsize=${opts.maxFileBytes}`,
      `--nofile=${opts.nofile}`,
      "--core=0",
      `--cpu=${opts.cpuSeconds}`,
      "--",
    );
  }
  argv.push(
    "/usr/bin/unshare",
    "--user",
    "--map-root-user",
    "--mount",
    "--fork",
    "--kill-child=SIGKILL",
    "--pid",
    "--mount-proc",
  );
  if (!opts.network) argv.push("--net");
  argv.push("--", "/bin/bash", opts.scriptPath, "--", ...opts.command);
  return argv;
}

function killProcessGroup(pid: number | undefined): void {
  if (pid == null) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function redactPaths(text: string, secretPaths: readonly string[]): string {
  const secrets = [...secretPaths].filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join("[redacted-path]");
  }
  return out;
}

function collectStream(
  stream: Readable | null,
  budget: { remaining: number },
  onTruncated: () => void,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return Promise.resolve({ text: "", truncated: false });
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let truncated = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ text: Buffer.concat(chunks).toString("utf8"), truncated });
    };
    stream.on("data", (chunk: Buffer | string) => {
      if (truncated) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (buf.length > budget.remaining) {
        if (budget.remaining > 0) chunks.push(buf.subarray(0, budget.remaining));
        budget.remaining = 0;
        truncated = true;
        onTruncated();
        return;
      }
      chunks.push(buf);
      budget.remaining -= buf.length;
    });
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  });
}

function readReady(stream: Readable | null): Promise<boolean> {
  if (!stream) return Promise.resolve(false);
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    stream.on("data", (chunk: Buffer | string) => {
      buf += chunk.toString();
      if (buf.includes("READY")) finish(true);
    });
    stream.on("end", () => finish(buf.includes("READY")));
    stream.on("close", () => finish(buf.includes("READY")));
    stream.on("error", () => finish(false));
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function removeRunDir(runDir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(runDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
}

function blank(sandboxError: string, started: number, jailCwd = "/workspace"): SandboxResult {
  return {
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    truncated: false,
    aborted: false,
    jailCwd,
    durationMs: Date.now() - started,
    sandboxError,
  };
}

/**
 * Run `argv` inside a fresh user/mount/pid namespace.
 * The host filesystem is not reachable except for the workspace bind
 * and a read-only `/usr`. See SECURITY.md.
 */
export async function runSandboxed(req: SandboxRequest): Promise<SandboxResult> {
  const started = Date.now();
  if (req.signal?.aborted) {
    return { ...blank("aborted", started), aborted: true };
  }
  if (req.argv.length === 0 || req.argv.some((part) => part.includes("\0"))) {
    return blank("refusing empty command", started);
  }
  if (req.stdin != null && Buffer.byteLength(req.stdin) > req.maxStdinBytes) {
    return blank(`stdin exceeds ${req.maxStdinBytes} bytes`, started);
  }

  const check = checkShellSandbox();
  if (!check.ok) {
    return blank(`sandbox unavailable; missing ${check.missing.join(", ")}`, started);
  }

  const { workspaceReal, jailCwd } = resolveWorkspaceCwd(req.workspaceRoot, req.cwd);
  const runDir = mkdtempSync(path.join(tmpdir(), "botanical-shell-"));
  let child: ChildProcess | undefined;
  let timedOut = false;
  let aborted = false;

  const onAbort = () => {
    aborted = true;
    killProcessGroup(child?.pid);
  };

  try {
    const runReal = realpathSync(runDir);
    if (isInside(workspaceReal, runReal) || isInside(runReal, workspaceReal)) {
      return blank("sandbox scratch collided with the workspace", started, jailCwd);
    }

    const jailRoot = path.join(runDir, "jail");
    mkdirSync(jailRoot, { mode: 0o700 });
    const scriptPath = path.join(runDir, "enter.sh");
    writeFileSync(scriptPath, ENTER_JAIL_SCRIPT, { mode: 0o700 });

    let scratchHost: string | undefined;
    if (req.scratchFiles != null && req.scratchFiles.length > 0) {
      scratchHost = path.join(runDir, "scratch");
      mkdirSync(scratchHost, { mode: 0o700 });
      for (const file of req.scratchFiles) {
        if (!/^[A-Za-z0-9._-]+$/.test(file.name)) {
          return blank("invalid scratch file name", started, jailCwd);
        }
        writeFileSync(path.join(scratchHost, file.name), file.contents, { mode: 0o644 });
      }
    }

    const cpuSeconds = Math.max(1, Math.ceil(req.timeoutMs / 1000) + 2);
    const launcher = buildLauncherArgv({
      network: req.network,
      scriptPath,
      command: req.argv,
      cpuSeconds,
      maxFileBytes: req.maxFileBytes,
      nofile: req.nofile,
      prlimit: check.prlimit,
    });
    const env = scrubEnv(req.extraEnv);
    env.BOTANICAL_JAIL_ROOT = jailRoot;
    env.BOTANICAL_WORKSPACE_HOST = workspaceReal;
    env.BOTANICAL_JAIL_CWD = jailCwd;
    if (scratchHost) env.BOTANICAL_SCRATCH_HOST = scratchHost;

    const [bin, ...args] = launcher;
    if (!bin) return blank("sandbox launcher was empty", started, jailCwd);

    child = spawn(bin, args, {
      cwd: runDir,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });

    if (req.signal) {
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child?.pid);
    }, req.timeoutMs);

    const budget = { remaining: Math.max(0, req.maxOutputBytes) };
    let truncated = false;
    const markTruncated = () => {
      if (truncated) return;
      truncated = true;
      killProcessGroup(child?.pid);
    };

    child.stdin?.on("error", () => {});
    child.stdin?.end(req.stdin ?? "");

    const readyStream = child.stdio[3];
    const readyReadable = readyStream instanceof Readable ? readyStream : null;

    let status: { code: number | null; signal: NodeJS.Signals | null };
    let stdout = "";
    let stderr = "";
    let ready = false;
    try {
      const collected = await Promise.all([
        collectStream(child.stdout, budget, markTruncated),
        collectStream(child.stderr, budget, markTruncated),
        waitForExit(child),
        readReady(readyReadable),
      ]);
      stdout = collected[0].text;
      stderr = collected[1].text;
      truncated = truncated || collected[0].truncated || collected[1].truncated;
      status = collected[2];
      ready = collected[3];
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
    }

    const secrets = [workspaceReal, runReal, runDir, jailRoot];
    if (scratchHost) secrets.push(scratchHost);
    const cleanOut = redactPaths(stdout, secrets);
    const cleanErr = redactPaths(stderr, secrets);

    if (!ready && !timedOut && !aborted) {
      return {
        exitCode: status.code,
        signal: status.signal,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated,
        aborted: false,
        jailCwd,
        durationMs: Date.now() - started,
        sandboxError: "execution jail failed to start",
        operatorDiagnostic: cleanErr.slice(0, 4000),
      };
    }

    return {
      exitCode: status.code,
      signal: status.signal,
      stdout: cleanOut,
      stderr: cleanErr,
      timedOut,
      truncated,
      aborted,
      jailCwd,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "sandbox failed";
    return {
      ...blank(`execution jail failed to start: ${message}`, started, jailCwd),
      aborted,
      timedOut,
    };
  } finally {
    if (child && child.exitCode == null && child.signalCode == null) {
      killProcessGroup(child.pid);
    }
    await removeRunDir(runDir);
  }
}
