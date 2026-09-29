import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";

import { runCliChildEnv } from "./child-env.ts";
import { claudeUserMessage, prepareCliLaunch, type CliMcpTarget } from "./launch.ts";
import { cliLineMarker, parseCliLine } from "./parse.ts";
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
/** A Botanical tool call that already ran on the per-run MCP endpoint. */
export interface CliToolCallEvent {
  type: "tool-call";
  id: string;
  name: string;
  arguments: unknown;
  output: unknown;
  isError?: boolean;
}
export type CliStreamEvent = CliTextEvent | CliErrorEvent | CliDoneEvent | CliToolCallEvent;

export interface CliToolEventSource {
  subscribe(listener: (event: CliToolCallEvent) => void): () => void;
}

/** User messages sent while the CLI runs. `take` removes and returns the waiting text. */
export interface CliLiveInput {
  take(): string[];
  subscribe(listener: () => void): () => void;
}

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
  /**
   * Per-run Botanical MCP endpoint. Omitted when the profile sets
   * `botanicalTools: false`. The token is placed only in the child env.
   */
  mcp?: CliMcpTarget;
  /** Tool calls the MCP handler pushes while this process is running. */
  toolEvents?: CliToolEventSource;
  /**
   * Messages to hand the CLI while it runs. Only Claude Code takes them: its
   * stdin stays open until it reports a result. Other CLIs ignore this, and
   * the agent loop answers the messages after the run.
   */
  input?: CliLiveInput;
}

const STDERR_LIMIT = 4_000;

/**
 * Run a coding-agent CLI and yield text-delta / tool-call / error / done.
 * The prompt is a temp file (Grok) or stdin (Claude Code, Codex), never argv.
 * Claude Code also gets `input` messages on stdin while it runs.
 * Cancellation and timeout kill the process group. Config files are removed
 * on every exit path, and a pre-existing Grok project config is restored.
 */
export async function* runCli(input: RunCliInput): AsyncGenerator<CliStreamEvent> {
  const prompt = renderCliPrompt(input.messages, {
    botanicalTools: Boolean(input.mcp),
    ...(input.mcp?.tools ? { toolNames: input.mcp.tools } : {}),
  });
  const plan = prepareCliLaunch({
    cli: input.cli,
    cwd: input.cwd,
    prompt,
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.mcp ? { mcp: input.mcp } : {}),
  });
  const sink = createSink<CliStreamEvent>();
  const unsubscribe = input.toolEvents?.subscribe((event) => sink.push(event));
  let child: ChildProcess | undefined;
  let timedOut = false;
  let cancelled = false;
  let spawnError: Error | null = null;
  const stderr: string[] = [];
  let stderrChars = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closeInput: (() => void) | undefined;
  const onAbort = () => {
    cancelled = true;
    if (child) killProcessTree(child);
  };

  try {
    child = spawn(input.bin, plan.args, {
      cwd: input.cwd,
      env: runCliChildEnv(input.env, plan.env, input.cli),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const spawned = child;
    const live = input.cli === "claude" ? input.input : undefined;
    if (live && spawned.stdin) closeInput = openLiveInput(spawned.stdin, plan.stdin ?? "", live);
    else writeStdin(spawned.stdin ?? null, plan.stdin);

    const kill = () => killProcessTree(spawned);
    if (input.signal?.aborted) {
      cancelled = true;
      kill();
    } else {
      input.signal?.addEventListener("abort", onAbort);
    }
    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, input.timeoutMs);

    spawned.on("error", (error) => {
      spawnError = error;
    });
    spawned.stderr?.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stderr.push(text);
      stderrChars += text.length;
      while (stderrChars > STDERR_LIMIT && stderr.length > 0) {
        const removed = stderr.shift() ?? "";
        stderrChars -= removed.length;
      }
    });

    const exited = new Promise<number>((resolve) => {
      spawned.on("exit", (code) => resolve(code ?? 1));
      spawned.on("error", () => resolve(127));
    });

    let stdoutFinished = false;
    let exitFinished = false;
    let exitCode = 1;
    const closeSink = () => {
      if (stdoutFinished && exitFinished) sink.close();
    };
    const stdoutDone = readStdout(spawned, sink, () => closeInput?.()).then(
      () => {
        stdoutFinished = true;
        closeSink();
      },
      () => {
        stdoutFinished = true;
        closeSink();
      },
    );
    const exitDone = exited.then((code) => {
      exitCode = code;
      exitFinished = true;
      closeSink();
    });

    while (true) {
      const event = await sink.next();
      if (!event) break;
      yield event;
    }
    await stdoutDone;
    await exitDone;
    const code = exitCode;

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
  } finally {
    closeInput?.();
    unsubscribe?.();
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    plan.cleanup();
  }
}

async function readStdout(
  child: ChildProcess,
  sink: Sink<CliStreamEvent>,
  onTurnResult: () => void,
): Promise<void> {
  let sawDelta = false;
  let sawFinal = false;
  let sawText = false;
  let newMessage = false;
  if (!child.stdout) return;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const marker = cliLineMarker(line);
      if (marker === "result") onTurnResult();
      // Text from separate model steps (around tool calls) would otherwise
      // run together: "…contact Jan.The tool list…" (issue #87).
      if (marker === "message-start" && sawText) newMessage = true;
      const parsed = parseCliLine(line);
      if (parsed.kind === "ignore") continue;
      if (parsed.kind === "plain" || parsed.kind === "delta") {
        if (parsed.kind === "delta") sawDelta = true;
        if (parsed.text) {
          const text = newMessage && parsed.kind === "delta" ? `\n\n${parsed.text}` : parsed.text;
          newMessage = false;
          sawText = true;
          sink.push({ type: "text-delta", text });
        }
        continue;
      }
      if (sawDelta || sawFinal) continue;
      sawFinal = true;
      if (parsed.text) sink.push({ type: "text-delta", text: parsed.text });
    }
  } finally {
    lines.close();
  }
}

/**
 * Claude Code stream-json input: write the prompt, then each message that
 * arrives, and keep stdin open. Returns the close function, called once the
 * CLI reports a result. Messages after that are left for the agent loop.
 */
function openLiveInput(stdin: Writable, first: string, live: CliLiveInput): () => void {
  stdin.on("error", () => {
    // The process group is killed on cancel. EPIPE is expected.
  });
  stdin.write(first);
  let open = true;
  const send = () => {
    if (!open) return;
    for (const text of live.take()) {
      if (text.trim()) stdin.write(claudeUserMessage(text));
    }
  };
  const unsubscribe = live.subscribe(send);
  send();
  return () => {
    if (!open) return;
    open = false;
    unsubscribe();
    stdin.end();
  };
}

function writeStdin(stdin: Writable | null, text: string | undefined): void {
  if (!stdin) return;
  stdin.on("error", () => {
    // The process group is killed on cancel. EPIPE is expected.
  });
  if (!text) {
    stdin.end();
    return;
  }
  const ok = stdin.write(text);
  if (ok) {
    stdin.end();
    return;
  }
  stdin.once("drain", () => {
    stdin.end();
  });
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

export function runChildEnv(
  env: Record<string, string | undefined> | undefined,
  extra: Record<string, string>,
  cli: CliName,
): NodeJS.ProcessEnv {
  return runCliChildEnv(env, extra, cli);
}

function stderrTail(parts: readonly string[]): string {
  return parts.join("").trim().slice(-1_500);
}

interface Sink<T> {
  push(item: T): void;
  close(): void;
  next(): Promise<T | undefined>;
}

function createSink<T>(): Sink<T> {
  const items: T[] = [];
  let waiting: ((value: T | undefined) => void) | null = null;
  let closed = false;
  return {
    push(item) {
      if (closed) return;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(item);
        return;
      }
      items.push(item);
    },
    close() {
      if (closed) return;
      closed = true;
      if (!waiting) return;
      const resolve = waiting;
      waiting = null;
      resolve(items.shift());
    },
    next() {
      const item = items.shift();
      if (item !== undefined) return Promise.resolve(item);
      if (closed) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
  };
}
