export const DEFAULT_MAX_OUTPUT_CHARS = 32_000;
export const DEFAULT_FILE_TIMEOUT_MS = 30_000;

export interface LimitedToolResult {
  content: string;
  isError?: boolean;
  data?: unknown;
  truncated?: boolean;
}

/**
 * Read a positive integer env var. Unset uses `fallback`.
 * A set but invalid value throws so a bad deploy fails when tools are built.
 */
export function readBoundedInt(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

export function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  const cap = Math.max(1, maxChars);
  if (content.length <= cap) return { content, truncated: false };
  const note = `\n\n[output truncated to ${cap} characters]`;
  if (note.length >= cap) return { content: content.slice(0, cap), truncated: true };
  return { content: content.slice(0, cap - note.length) + note, truncated: true };
}

export function withLimitNote(description: string, timeoutMs: number, maxOutputChars: number): string {
  return `${description}\n\nLimits: aborted after ${timeoutMs} ms; text output truncated to ${maxOutputChars} characters.`;
}

/**
 * Wall-clock cap around a tool call. Aborts `signal` passed to `run` when the
 * timer fires, and still settles if `run` ignores the signal.
 */
export async function executeWithLimits(
  run: (signal: AbortSignal) => Promise<LimitedToolResult>,
  options: { timeoutMs: number; maxOutputChars: number; signal?: AbortSignal; toolName: string },
): Promise<LimitedToolResult> {
  if (options.signal?.aborted) return abortedResult();

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  let settled = false;
  let resolveLimit: (result: LimitedToolResult) => void = () => {};
  const limited = new Promise<LimitedToolResult>((resolve) => {
    resolveLimit = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
  });
  const onAbort = () => {
    resolveLimit(options.signal?.aborted ? abortedResult() : timeoutResult(options.toolName, options.timeoutMs));
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await Promise.race([
      run(controller.signal).then((value) => {
        if (!value || typeof value.content !== "string") {
          return {
            content: `Tool "${options.toolName}" returned an invalid result.`,
            isError: true,
          } satisfies LimitedToolResult;
        }
        return value;
      }),
      limited,
    ]);
    return applyTruncation(result, options.maxOutputChars);
  } catch (error) {
    if (options.signal?.aborted) return abortedResult();
    if (controller.signal.aborted) return timeoutResult(options.toolName, options.timeoutMs);
    const message = error instanceof Error && error.message ? error.message : "Tool failed";
    return applyTruncation({ content: message, isError: true }, options.maxOutputChars);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
    // Settle the loser so a completed call does not retain the abort promise.
    resolveLimit(abortedResult());
  }
}

function applyTruncation(result: LimitedToolResult, maxChars: number): LimitedToolResult {
  const next = truncateContent(result.content, maxChars);
  if (!next.truncated) return result;
  return { ...result, content: next.content, truncated: true };
}

function abortedResult(): LimitedToolResult {
  return { content: "Tool call was aborted.", isError: true };
}

function timeoutResult(name: string, timeoutMs: number): LimitedToolResult {
  return { content: `Tool "${name}" timed out after ${timeoutMs}ms.`, isError: true };
}
