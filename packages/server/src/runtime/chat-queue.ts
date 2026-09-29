import { randomUUID } from "node:crypto";

import type { RuntimeDeps, SteeringMessage, TurnSteering } from "@botanical/agent-runtime";
import { runAsUser } from "@botanical/db";

import { HttpError } from "../http.ts";
import { resolveProfile } from "../profiles.ts";
import { assertCliProfileReady } from "../routes/profiles.ts";
import type { SseEvent } from "../streaming.ts";
import type { Store } from "../types.ts";
import { streamChatTurn } from "./turn.ts";
import type { TurnCoordinator } from "./turns.ts";

/** A user message accepted by `POST /api/chats/:id/messages` with `async: true`, not yet in the transcript. */
export interface QueuedMessage {
  id: string;
  content: string;
  profileId: string;
  createdAt: string;
}

/**
 * Events on `GET /api/chats/:id/events`:
 * - `status` `{ running, queued }` on connect and whenever the queue or run state changes.
 * - `message` `{ message, queuedId? }` for each stored message. User messages carry the queue id they came from,
 *   including ones the running turn took mid-turn.
 * - `error` `{ error, code }` when a turn fails. A stopped turn does not report one.
 */
export type ChatListener = (event: SseEvent) => void;

interface ChatState {
  queue: QueuedMessage[];
  running: boolean;
  controller: AbortController | null;
  listeners: Set<ChatListener>;
  /** The running turn's steering listeners, told when a message joins the queue. */
  steerers: Set<() => void>;
}

const QUEUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Async chat messaging. A posted message joins the chat's queue and the request
 * returns at once. One drain per chat runs turns on the server, detached from the
 * request, so closing the tab does not stop the agent.
 *
 * A message sent while a turn runs steers that turn: the agent loop takes it
 * before the model's next step (after pending tool results), and a CLI with live
 * input (Claude Code) reads it on stdin while it works. If the model has already
 * finished, the same turn continues to answer it. Messages the turn cannot take
 * (another profile, or the step cap was hit) are answered by the next turn,
 * together, one reply for the batch.
 *
 * Queued messages are written to the transcript only when a turn takes them, so
 * they never land between an assistant tool call and its result. The queue lives
 * in this process: a restart drops messages that were still waiting.
 */
export function createChatQueue(deps: { store: Store; runtime: RuntimeDeps; turns: TurnCoordinator }) {
  const chats = new Map<string, ChatState>();
  const drains = new Set<Promise<void>>();

  function stateFor(chatId: string): ChatState {
    let state = chats.get(chatId);
    if (!state) {
      state = { queue: [], running: false, controller: null, listeners: new Set(), steerers: new Set() };
      chats.set(chatId, state);
    }
    return state;
  }

  function prune(chatId: string, state: ChatState): void {
    if (!state.running && state.queue.length === 0 && state.listeners.size === 0) chats.delete(chatId);
  }

  function publish(state: ChatState, event: SseEvent): void {
    for (const listener of state.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[chat-queue] listener failed", error);
      }
    }
  }

  function statusEvent(state: ChatState): SseEvent {
    return { event: "status", data: { running: state.running, queued: [...state.queue] } };
  }

  async function runBatch(chatId: string, state: ChatState): Promise<void> {
    const batch = state.queue.splice(0);
    if (batch.length === 0) return;
    publish(state, statusEvent(state));
    const controller = new AbortController();
    state.controller = controller;
    const fail = (error: unknown) => {
      if (controller.signal.aborted) return;
      const body = errorBody(error);
      publish(state, { event: "error", data: body });
    };
    try {
      const chat = await deps.store.chats.get(chatId);
      if (!chat) throw new HttpError(404, "not_found", "Chat not found");
      // Store the batch first, so a profile that went away since the post fails the turn, not the messages.
      const seen = new Set((await deps.store.messages.listByChat(chatId)).map((message) => message.id));
      for (const item of batch) {
        const message = await deps.store.messages.create({
          chatId,
          role: "user",
          content: item.content,
          profileId: item.profileId,
        });
        seen.add(message.id);
        publish(state, { event: "message", data: { message, queuedId: item.id } });
      }
      const last = batch[batch.length - 1] as QueuedMessage;
      const profile = await resolveProfile(deps.store, last.profileId, chat.profileId);
      await assertCliProfileReady(profile);
      // Stored row id -> queue id, for messages the turn took mid-run.
      const steered = new Map<string, string>();
      const flush = async () => {
        const messages = await deps.store.messages.listByChat(chatId);
        for (const message of messages) {
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          const queuedId = steered.get(message.id);
          publish(state, { event: "message", data: queuedId ? { message, queuedId } : { message } });
        }
      };
      const steering: TurnSteering = {
        take() {
          // Only messages for this turn's profile. A switch waits for its own turn.
          const taken: SteeringMessage[] = [];
          while (state.queue[0] && state.queue[0].profileId === last.profileId) {
            const item = state.queue.shift() as QueuedMessage;
            taken.push({ id: item.id, content: item.content });
          }
          if (taken.length > 0) publish(state, statusEvent(state));
          return taken;
        },
        subscribe(listener) {
          state.steerers.add(listener);
          return () => state.steerers.delete(listener);
        },
      };

      const turn = streamChatTurn(deps.store, deps.runtime, {
        chat,
        content: batch.map((item) => item.content).join("\n\n"),
        profile,
        signal: controller.signal,
        appendUserMessage: false,
        steering,
      });
      for await (const event of turn) {
        // Replies go out whole. Deltas and usage stay on the server.
        if (event.event === "text-delta" || event.event === "usage") continue;
        if (event.event === "steer") {
          for (const item of steerMessages(event.data)) steered.set(item.messageId, item.id);
        }
        if (event.event === "error") fail(new TurnError(event.data));
        await flush();
      }
      await flush();
    } catch (error) {
      fail(error);
    } finally {
      state.controller = null;
      state.steerers.clear();
    }
  }

  function startDrain(chatId: string, state: ChatState, userId: string): void {
    state.running = true;
    const drain = (async () => {
      try {
        while (state.queue.length > 0) {
          try {
            await deps.turns.exclusive(chatId, () => runAsUser(userId, () => runBatch(chatId, state)));
          } catch (error) {
            console.error("[chat-queue] turn failed", error);
          }
        }
      } finally {
        state.running = false;
        publish(state, statusEvent(state));
        prune(chatId, state);
      }
    })();
    drains.add(drain);
    void drain.finally(() => drains.delete(drain));
  }

  return {
    /**
     * Queue a user message and start the chat's drain when it is idle.
     * Re-posting a queue id that is still waiting returns the existing entry, so a client retry does not double-send.
     */
    enqueue(input: { chatId: string; userId: string; content: string; profileId: string; id?: string }): QueuedMessage {
      const id = input.id ?? randomUUID();
      if (!QUEUE_ID.test(id)) {
        throw new HttpError(400, "invalid_body", "clientId must be 1-64 letters, digits, _ or -");
      }
      const state = stateFor(input.chatId);
      const existing = state.queue.find((item) => item.id === id);
      if (existing) return existing;
      const item: QueuedMessage = {
        id,
        content: input.content,
        profileId: input.profileId,
        createdAt: new Date().toISOString(),
      };
      state.queue.push(item);
      if (!state.running) startDrain(input.chatId, state, input.userId);
      publish(state, statusEvent(state));
      for (const steerer of [...state.steerers]) {
        try {
          steerer();
        } catch (error) {
          console.error("[chat-queue] steering listener failed", error);
        }
      }
      return item;
    },

    /** Abort the chat's running turn. Messages queued after it still get their turn. */
    stop(chatId: string): boolean {
      const controller = chats.get(chatId)?.controller;
      if (!controller || controller.signal.aborted) return false;
      controller.abort();
      return true;
    },

    status(chatId: string): { running: boolean; queued: QueuedMessage[] } {
      const state = chats.get(chatId);
      return { running: state?.running ?? false, queued: state ? [...state.queue] : [] };
    },

    /** Listen to a chat. The current status is sent right away. Returns the unsubscribe function. */
    subscribe(chatId: string, listener: ChatListener): () => void {
      const state = stateFor(chatId);
      state.listeners.add(listener);
      listener(statusEvent(state));
      return () => {
        state.listeners.delete(listener);
        prune(chatId, state);
      };
    },

    /** Resolves when every chat's queue has drained. Tests use it. */
    async whenIdle(): Promise<void> {
      while (drains.size > 0) await Promise.all([...drains]);
    },
  };
}

export type ChatQueue = ReturnType<typeof createChatQueue>;

class TurnError extends Error {
  readonly code: string;
  constructor(data: unknown) {
    const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    super(typeof record.error === "string" ? record.error : "The model request failed");
    this.code = typeof record.code === "string" ? record.code : "error";
  }
}

function steerMessages(data: unknown): Array<{ id: string; messageId: string }> {
  const messages = typeof data === "object" && data !== null ? (data as { messages?: unknown }).messages : undefined;
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (item): item is { id: string; messageId: string } =>
      typeof item?.id === "string" && typeof item?.messageId === "string",
  );
}

function errorBody(error: unknown): { error: string; code: string } {
  if (error instanceof TurnError || error instanceof HttpError) return { error: error.message, code: error.code };
  console.error("[chat-queue]", error);
  return { error: "The model request failed", code: "internal_error" };
}
