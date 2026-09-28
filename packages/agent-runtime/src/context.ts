import type { ChatMessage } from "./provider";

/** Rough token estimate. Four characters is about one token for English text. */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * Drop the oldest turns until the transcript fits `maxContext`.
 * The system message and the newest turn are always kept.
 * A turn starts at a user message so tool calls stay with their assistant message.
 * `maxContext <= 0` means the caller has no budget and the transcript is unchanged.
 */
export function trimToBudget(messages: readonly ChatMessage[], maxContext: number): ChatMessage[] {
  if (!Number.isFinite(maxContext) || maxContext <= 0) return [...messages];
  const system = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  const turns: ChatMessage[][] = [];
  for (const message of rest) {
    const current = turns[turns.length - 1];
    if (message.role === "user" || !current) turns.push([message]);
    else current.push(message);
  }
  const kept: ChatMessage[][] = [];
  let used = estimateTokens(system);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) continue;
    const cost = estimateTokens(turn);
    if (kept.length > 0 && used + cost > maxContext) break;
    kept.push(turn);
    used += cost;
  }
  kept.reverse();
  return [...system, ...kept.flat()];
}
