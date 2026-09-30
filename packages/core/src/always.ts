import { BotanicalApiError } from "./errors";
import type {
  AppNotification,
  GithubAccount,
  GithubConnection,
  GithubHookResult,
  GithubRepo,
  Listener,
  ListenerDelivery,
  AlwaysOnSettings,
  NotificationPage,
  Routine,
  RoutineRun,
  SchedulePreview,
} from "./types";

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BotanicalApiError(`Expected ${label} in the response.`, { status: 200 });
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullable(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeRoutineRun(value: unknown): RoutineRun {
  const row = record(value, "a routine run");
  const id = text(row.id);
  if (!id) throw new BotanicalApiError("Routine run is missing an id.", { status: 200 });
  const trigger = row.trigger === "manual" ? "manual" : "schedule";
  const status = text(row.status, "queued");
  return {
    id,
    routineId: text(row.routineId),
    trigger,
    scheduledFor: text(row.scheduledFor),
    startedAt: nullable(row.startedAt),
    finishedAt: nullable(row.finishedAt),
    status: status as RoutineRun["status"],
    error: nullable(row.error),
    chatId: nullable(row.chatId),
    createdAt: text(row.createdAt),
  };
}

export function normalizeRoutine(value: unknown): Routine {
  const row = record(value, "a routine");
  const id = text(row.id);
  if (!id) throw new BotanicalApiError("Routine is missing an id.", { status: 200 });
  const last = row.lastRun;
  return {
    id,
    userId: text(row.userId),
    agentId: text(row.agentId),
    name: text(row.name),
    prompt: text(row.prompt),
    cron: text(row.cron),
    timezone: text(row.timezone),
    profileId: text(row.profileId),
    enabled: bool(row.enabled, true),
    nextRunAt: text(row.nextRunAt),
    lastRunAt: nullable(row.lastRunAt),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    lastRun: last && typeof last === "object" ? normalizeRoutineRun(last) : null,
  };
}

export function normalizeSchedulePreview(value: unknown): SchedulePreview {
  const row = record(value, "a schedule preview");
  const next = Array.isArray(row.next) ? row.next.filter((item): item is string => typeof item === "string") : [];
  return {
    valid: row.valid === true,
    ...(typeof row.error === "string" ? { error: row.error } : {}),
    next,
  };
}

export function normalizeListener(value: unknown): Listener {
  const row = record(value, "a listener");
  const id = text(row.id);
  if (!id) throw new BotanicalApiError("Listener is missing an id.", { status: 200 });
  return {
    id,
    userId: text(row.userId),
    agentId: text(row.agentId),
    name: text(row.name),
    kind: text(row.kind, "webhook"),
    events: Array.isArray(row.events) ? row.events.filter((item): item is string => typeof item === "string") : [],
    profileId: text(row.profileId),
    promptTemplate: text(row.promptTemplate),
    enabled: bool(row.enabled, true),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    url: text(row.url),
  };
}

export function normalizeDelivery(value: unknown): ListenerDelivery {
  const row = record(value, "a delivery");
  const id = text(row.id);
  if (!id) throw new BotanicalApiError("Delivery is missing an id.", { status: 200 });
  return {
    id,
    listenerId: text(row.listenerId),
    receivedAt: text(row.receivedAt),
    status: text(row.status, "accepted") as ListenerDelivery["status"],
    httpStatus: integer(row.httpStatus),
    error: nullable(row.error),
    payloadBytes: integer(row.payloadBytes),
    payloadPreview: text(row.payloadPreview),
    chatId: nullable(row.chatId),
  };
}

export function normalizeGithubConnection(value: unknown): GithubConnection {
  const row = record(value, "a GitHub connection");
  const account = row.account && typeof row.account === "object" ? normalizeGithubAccount(row.account) : null;
  return {
    connected: row.connected === true,
    account,
    webUrl: text(row.webUrl, "https://github.com"),
  };
}

function normalizeGithubAccount(value: unknown): GithubAccount {
  const row = record(value, "a GitHub account");
  return {
    login: text(row.login),
    id: integer(row.id),
    name: nullable(row.name),
    avatarUrl: nullable(row.avatarUrl),
    htmlUrl: nullable(row.htmlUrl),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((item): item is string => typeof item === "string") : [],
    connectedAt: text(row.connectedAt),
  };
}

export function normalizeGithubRepo(value: unknown): GithubRepo {
  const row = record(value, "a GitHub repository");
  return {
    fullName: text(row.fullName),
    private: bool(row.private),
    defaultBranch: text(row.defaultBranch, "main"),
    htmlUrl: text(row.htmlUrl),
    description: nullable(row.description),
    canAdmin: bool(row.canAdmin),
    canPush: bool(row.canPush),
  };
}

export function normalizeGithubHook(value: unknown): GithubHookResult {
  const row = record(value, "a GitHub webhook");
  return {
    id: integer(row.id),
    repo: text(row.repo),
    events: Array.isArray(row.events) ? row.events.filter((item): item is string => typeof item === "string") : [],
    htmlUrl: text(row.htmlUrl),
  };
}

export function normalizeNotification(value: unknown): AppNotification {
  const row = record(value, "a notification");
  const id = text(row.id);
  if (!id) throw new BotanicalApiError("Notification is missing an id.", { status: 200 });
  return {
    id,
    userId: text(row.userId),
    kind: text(row.kind, "attention") as AppNotification["kind"],
    title: text(row.title),
    body: text(row.body),
    agentId: nullable(row.agentId),
    chatId: nullable(row.chatId),
    routineRunId: nullable(row.routineRunId),
    listenerDeliveryId: nullable(row.listenerDeliveryId),
    readAt: nullable(row.readAt),
    createdAt: text(row.createdAt),
  };
}

export function normalizeAlwaysOnSettings(value: unknown): AlwaysOnSettings {
  const row = record(value, "always-on settings");
  return {
    schedulerEnabled: bool(row.schedulerEnabled, true),
    schedulerIntervalMs: positive(row.schedulerIntervalMs, 15_000),
    backgroundConcurrency: positive(row.backgroundConcurrency, 2),
    listenerMaxBytes: positive(row.listenerMaxBytes, 65_536),
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function normalizeNotificationPage(value: unknown): NotificationPage {
  const row = record(value, "notifications");
  const notifications = Array.isArray(row.notifications) ? row.notifications.map(normalizeNotification) : [];
  return {
    notifications,
    unreadCount: integer(row.unreadCount),
  };
}
