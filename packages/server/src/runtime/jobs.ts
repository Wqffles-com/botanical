import { randomUUID } from "node:crypto";

import type { RuntimeDeps } from "@botanical/agent-runtime";
import { RUN_LEASE_MS, RUN_LEASE_RENEW_MS } from "@botanical/db";

import type { ServerConfig } from "../config.ts";
import { HttpError } from "../http.ts";
import { listenerHandler } from "../listeners/kinds.ts";
import { resolveProfile } from "../profiles.ts";
import { assertCliProfileReady } from "../routes/profiles.ts";
import { nextFutureSlot, routineChatTitle } from "../routines/cron.ts";
import { collectChatTurn } from "./turn.ts";
import type { TurnCoordinator } from "./turns.ts";
import type { Store } from "../types.ts";

const ERROR_MAX = 2_000;
const PROCESS_ID = randomUUID();

/**
 * Runs a full agent turn for a routine slot or a listener delivery.
 * Each run opens a new chat so the transcript stays bounded to that event
 * and the run row can link to it.
 */
export function createBackgroundJobs(deps: {
  store: Store;
  runtime: RuntimeDeps;
  config: ServerConfig;
  turns: TurnCoordinator;
}) {
  async function executeRoutineRun(runId: string): Promise<void> {
    await deps.turns.runInBackground(async () => {
      const run = await deps.store.routineRuns.get(runId);
      if (!run || (run.status !== "queued" && run.status !== "running")) return;
      const held = await deps.store.routineRuns.claimLease(runId, PROCESS_ID, leaseExpiry());
      if (!held) return;
      const release = holdLease(() => deps.store.routineRuns.renewLease(runId, PROCESS_ID, leaseExpiry()));
      const routine = await deps.store.routines.get(run.routineId);
      if (!routine) {
        await deps.store.routineRuns.finishOwned(runId, PROCESS_ID, {
          status: "failed",
          error: "Routine no longer exists",
          finishedAt: new Date().toISOString(),
        });
        release();
        return;
      }
      let chatId = run.chatId;
      try {
        const profile = resolveProfile(deps.config, routine.profileId, undefined);
        await assertCliProfileReady(profile);
        if (!chatId) {
          const chat = await deps.store.chats.create({
            agentId: routine.agentId,
            profileId: profile.id,
            title: routineChatTitle(routine.name, new Date(run.scheduledFor), routine.timezone),
          });
          chatId = chat.id;
          await deps.store.routineRuns.update(runId, { chatId });
        }
        const chat = await deps.store.chats.get(chatId);
        if (!chat) throw new Error("Chat not found");
        const result = await deps.turns.exclusive(chat.id, () =>
          collectChatTurn(deps.store, deps.runtime, { chat, content: routine.prompt, profile }),
        );
        const finishedAt = new Date().toISOString();
        if (result.error) {
          await finishRoutine(runId, routine.id, routine.agentId, chatId, "failed", result.error.message, finishedAt, routine.name);
          return;
        }
        await finishRoutine(runId, routine.id, routine.agentId, chatId, "succeeded", null, finishedAt, routine.name);
      } catch (error) {
        const finishedAt = new Date().toISOString();
        await finishRoutine(
          runId,
          routine.id,
          routine.agentId,
          chatId,
          "failed",
          messageOf(error),
          finishedAt,
          routine.name,
        );
      } finally {
        release();
      }
    });
  }

  async function finishRoutine(
    runId: string,
    routineId: string,
    agentId: string,
    chatId: string | null,
    status: "succeeded" | "failed",
    error: string | null,
    finishedAt: string,
    name: string,
  ): Promise<void> {
    const finished = await deps.store.routineRuns.finishOwned(runId, PROCESS_ID, {
      status,
      error: error ? clip(error) : null,
      finishedAt,
      ...(chatId ? { chatId } : {}),
    });
    if (!finished) return;
    await deps.store.routines.update(routineId, { lastRunAt: finishedAt });
    await deps.store.notifications.create({
      kind: status === "succeeded" ? "run_succeeded" : "run_failed",
      title: status === "succeeded" ? `${name} finished` : `${name} failed`,
      body: error ? clip(error) : "Background routine finished.",
      agentId,
      chatId,
      routineRunId: runId,
    });
  }

  async function executeListenerDelivery(deliveryId: string, payload: string): Promise<void> {
    await deps.turns.runInBackground(async () => {
      const delivery = await deps.store.listenerDeliveries.get(deliveryId);
      if (!delivery || delivery.status !== "accepted") return;
      const held = await deps.store.listenerDeliveries.claimLease(deliveryId, PROCESS_ID, leaseExpiry());
      if (!held) return;
      const release = holdLease(() =>
        deps.store.listenerDeliveries.renewLease(deliveryId, PROCESS_ID, leaseExpiry()),
      );
      const listener = await deps.store.listeners.get(delivery.listenerId);
      if (!listener) {
        await deps.store.listenerDeliveries.finishOwned(deliveryId, PROCESS_ID, {
          status: "failed",
          error: "Listener no longer exists",
        });
        release();
        return;
      }
      const handler = listenerHandler(listener.kind);
      let chatId: string | null = delivery.chatId;
      try {
        if (!handler) throw new Error(`No handler for listener kind ${listener.kind}`);
        const profile = resolveProfile(deps.config, listener.profileId, undefined);
        await assertCliProfileReady(profile);
        const chat = await deps.store.chats.create({
          agentId: listener.agentId,
          profileId: profile.id,
          title: routineChatTitle(listener.name, new Date(delivery.receivedAt), "UTC"),
        });
        chatId = chat.id;
        await deps.store.listenerDeliveries.update(deliveryId, { chatId });
        const content = handler.buildPrompt({
          template: listener.promptTemplate,
          listenerName: listener.name,
          receivedAt: delivery.receivedAt,
          payload,
        });
        const result = await deps.turns.exclusive(chat.id, () =>
          collectChatTurn(deps.store, deps.runtime, { chat, content, profile }),
        );
        if (result.error) {
          await finishDelivery(deliveryId, listener.agentId, chatId, listener.name, result.error.message);
          return;
        }
        const finished = await deps.store.listenerDeliveries.finishOwned(deliveryId, PROCESS_ID, {
          status: "succeeded",
          error: null,
          chatId,
        });
        if (!finished) return;
        await deps.store.notifications.create({
          kind: "run_succeeded",
          title: `${listener.name} finished`,
          body: "Webhook listener turn finished.",
          agentId: listener.agentId,
          chatId,
          listenerDeliveryId: deliveryId,
        });
      } catch (error) {
        await finishDelivery(deliveryId, listener.agentId, chatId, listener.name, messageOf(error));
      } finally {
        release();
      }
    });
  }

  async function finishDelivery(
    deliveryId: string,
    agentId: string,
    chatId: string | null,
    name: string,
    error: string,
  ): Promise<void> {
    const finished = await deps.store.listenerDeliveries.finishOwned(deliveryId, PROCESS_ID, {
      status: "failed",
      error: clip(error),
      ...(chatId ? { chatId } : {}),
    });
    if (!finished) return;
    await deps.store.notifications.create({
      kind: "run_failed",
      title: `${name} failed`,
      body: clip(error),
      agentId,
      chatId,
      listenerDeliveryId: deliveryId,
    });
  }

  return { executeRoutineRun, executeListenerDelivery, nextFutureSlot };
}

function leaseExpiry(): string {
  return new Date(Date.now() + RUN_LEASE_MS).toISOString();
}

function holdLease(renew: () => Promise<boolean>): () => void {
  const timer = setInterval(() => {
    void renew();
  }, RUN_LEASE_RENEW_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

function messageOf(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return "Run failed";
}

function clip(value: string): string {
  const text = value.trim();
  return text.length <= ERROR_MAX ? text : `${text.slice(0, ERROR_MAX - 1)}…`;
}
