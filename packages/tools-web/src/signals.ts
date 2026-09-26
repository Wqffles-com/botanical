export function combineSignals(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parent) return timeoutSignal;
  if (parent.aborted) return parent;
  return AbortSignal.any([parent, timeoutSignal]);
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted.", "AbortError");
}
