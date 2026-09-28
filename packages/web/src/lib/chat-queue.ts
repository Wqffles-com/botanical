import type { ChatMessage, QueuedMessage } from "@botanical/core";

/** A sent message the transcript does not have yet. `posting` is true until the server accepts it. */
export interface PendingMessage {
  id: string;
  content: string;
  createdAt: string;
  posting: boolean;
}

/** Add a stored message once. Events and a transcript refetch can both deliver it. */
export function mergeMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((row) => row.id === message.id)) return messages;
  return [...messages, message];
}

/** A stored user message replaces the pending bubble it came from. */
export function settlePending(pending: PendingMessage[], queuedId: string | undefined): PendingMessage[] {
  if (!queuedId) return pending;
  const next = pending.filter((row) => row.id !== queuedId);
  return next.length === pending.length ? pending : next;
}

export function markAccepted(pending: PendingMessage[], id: string): PendingMessage[] {
  return pending.map((row) => (row.id === id && row.posting ? { ...row, posting: false } : row));
}

/**
 * Reconcile with the server's queue. Server entries this tab has not seen (another tab,
 * or a reload) are added. Once the server is idle with nothing queued, only messages
 * still being posted can be pending: everything accepted before has been stored.
 */
export function applyQueueStatus(
  pending: PendingMessage[],
  status: { running: boolean; queued: QueuedMessage[] },
): PendingMessage[] {
  let next = pending;
  for (const item of status.queued) {
    if (next.some((row) => row.id === item.id)) continue;
    next = [...next, { id: item.id, content: item.content, createdAt: item.createdAt, posting: false }];
  }
  if (!status.running && status.queued.length === 0) {
    const posting = next.filter((row) => row.posting);
    if (posting.length !== next.length) next = posting;
  }
  return next;
}

export function pendingToMessage(chatId: string, row: PendingMessage): ChatMessage {
  return { id: `pending-${row.id}`, chatId, role: "user", content: row.content, createdAt: row.createdAt };
}
