import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import { buildCliArgs } from "./args.ts";
import { parseCliLine } from "./parse.ts";
import { renderCliPrompt, type CliPromptMessage } from "./prompt.ts";
import type { CliName } from "./types.ts";

export interface CliTextEvent {
  type: "text-delta";
  text: string;
}
export interface CliErrorEvent {
  type: "error";
  error: Error;
}
export interface CliDoneEvent {
  type: "done";
}
export type CliStreamEvent = CliTextEvent | CliErrorEvent | CliDoneEvent;

export interface RunCliInput {
  cli: CliName;
  /** Executable path. Spawned directly — no shell. */
  bin: string;
  messages: readonly CliPromptMessage[];
  cwd: string;
  /** Omitted or blank: the CLI's own default. Never invented here. */
  model?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

const STDERR_LIMIT = 4_000;

/**
 * Run a coding-agent CLI and yield the same text-delta / error / done events
 * the chat loop already consumes. Botanical tools are not forwarded.
 * Cancellation and timeout kill the process group.
 */
export async function* runCli(input: RunCliInput): AsyncGenerator<CliStreamEvent> {
  const prompt = renderCliPrompt(input.messages);
  const args = buildCliArgs({
    cli: input.cli,
    prompt,
    cwd: input.cwd,
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
  });
  const child = spawn(input.bin, args, {
    cwd: input.cwd,
    env: childEnv(input.env),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let timedOut = false;
  let cancelled = false;
  let spawnError: Error | null = null;
  const stderr: string[] = [];
  let stderrChars = 0;

  const kill = () => killProcessTree(child);
  const onAbort = () => {
    cancelled = true;
    kill();
  };
  if (input.signal?.aborted) {
    cancelled = true;
    kill();
  } else {
    input.signal?.addEventListener("abort", onAbort);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, input.timeoutMs);

  child.on("error", (error) => {
    spawnError = error;
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    stderr.push(text);
    stderrChars += text.length;
    while (stderrChars > STDERR_LIMIT && stderr.length > 0) {
      const removed = stderr.shift() ?? "";
      stderrChars -= removed.length;
    }
  });

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(127));
  });

  let sawDelta = false;
  let sawFinal = false;
  if (child.stdout) {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const parsed = parseCliLine(line);
        if (parsed.kind === "ignore") continue;
        if (parsed.kind === "plain" || parsed.kind === "delta") {
          if (parsed.kind === "delta") sawDelta = true;
          if (parsed.text) yield { type: "text-delta", text: parsed.text };
          continue;
        }
        if (sawDelta || sawFinal) continue;
        sawFinal = true;
        if (parsed.text) yield { type: "text-delta", text: parsed.text };
      }
    } finally {
      lines.close();
    }
  }

  const code = await exited;
  clearTimeout(timer);
  input.signal?.removeEventListener("abort", onAbort);

  if (spawnError && code !== 0) {
    const failed = spawnError as Error;
    yield { type: "error", error: new Error(`CLI failed to start (${input.bin}): ${failed.message}`) };
    yield { type: "done" };
    return;
  }
  if (cancelled || input.signal?.aborted) {
    yield { type: "error", error: new Error("CLI cancelled") };
    yield { type: "done" };
    return;
  }
  if (timedOut) {
    const tail = stderrTail(stderr);
    yield {
      type: "error",
      error: new Error(`CLI timed out after ${input.timeoutMs}ms${tail ? `: ${tail}` : ""}`),
    };
    yield { type: "done" };
    return;
  }
  if (code !== 0) {
    const tail = stderrTail(stderr);
    yield {
      type: "error",
      error: new Error(`CLI ${input.cli} exited ${code}${tail ? `: ${tail}` : ""}`),
    };
    yield { type: "done" };
    return;
  }
  yield { type: "done" };
}

export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // already exited
      }
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }
    }, 400);
    timer.unref?.();
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // already exited
  }
}

function childEnv(env: Record<string, string | undefined> | undefined): NodeJS.ProcessEnv {
  const source = env ?? process.env;
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") next[key] = value;
  }
  const home = source.BOTANICAL_CLI_HOME?.trim() || source.HOME;
  if (home) next.HOME = home;
  return next;
}

function stderrTail(parts: readonly string[]): string {
  return parts.join("").trim().slice(-1_500);
}
