import webpush from "web-push";

import type { Notification, NotificationKind, Store } from "../types.ts";

export const PUSH_EVENT_KINDS = ["run_succeeded", "run_failed", "attention"] as const;
export type PushEvents = Record<NotificationKind, boolean>;

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

const VAPID_PUBLIC_PREF = "push.vapid_public";
const VAPID_PRIVATE_SECRET = "push-vapid-private";
const SUBSCRIPTIONS_PREF = "push.subscriptions";
const EVENTS_PREF = "push.events";
const MAX_SUBSCRIPTIONS = 20;
const DEFAULT_SUBJECT = "mailto:botanical@localhost.invalid";

export interface PushSender {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number },
  ): Promise<unknown>;
}

export interface PushService {
  /** Public VAPID key, generated on first use. Null when keys cannot be stored. */
  publicKey(): Promise<string | null>;
  listSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>;
  subscribe(userId: string, subscription: Omit<PushSubscriptionRecord, "createdAt">, now: Date): Promise<void>;
  unsubscribe(userId: string, endpoint: string): Promise<boolean>;
  events(userId: string): Promise<PushEvents>;
  setEvents(userId: string, patch: Partial<PushEvents>): Promise<PushEvents>;
  /** Push a stored notification to the owner's devices. Never throws. */
  deliver(notification: Notification): Promise<void>;
}

export function createPushService(options: {
  store: Store;
  subject?: string;
  sender?: PushSender;
}): PushService {
  const { store } = options;
  const sender = options.sender ?? (webpush as unknown as PushSender);
  const subject = options.subject?.trim() || DEFAULT_SUBJECT;
  let keys: Promise<{ publicKey: string; privateKey: string } | null> | null = null;

  async function loadKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
    try {
      const publicKey = await store.prefs.getGlobal(VAPID_PUBLIC_PREF);
      const privateKey = await store.secrets.revealGlobal(VAPID_PRIVATE_SECRET);
      if (typeof publicKey === "string" && privateKey) return { publicKey, privateKey };
      const fresh = webpush.generateVAPIDKeys();
      await store.secrets.putGlobal(VAPID_PRIVATE_SECRET, fresh.privateKey);
      await store.prefs.setGlobal(VAPID_PUBLIC_PREF, fresh.publicKey);
      return fresh;
    } catch {
      return null;
    }
  }

  function vapid() {
    keys ??= loadKeys().then((value) => {
      if (!value) keys = null;
      return value;
    });
    return keys;
  }

  async function listSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
    return readSubscriptions(await store.prefs.getUser(userId, SUBSCRIPTIONS_PREF));
  }

  async function events(userId: string): Promise<PushEvents> {
    return readEvents(await store.prefs.getUser(userId, EVENTS_PREF));
  }

  return {
    async publicKey() {
      return (await vapid())?.publicKey ?? null;
    },
    listSubscriptions,
    async subscribe(userId, subscription, now) {
      const rest = (await listSubscriptions(userId)).filter((item) => item.endpoint !== subscription.endpoint);
      const next = [...rest, { ...subscription, createdAt: now.toISOString() }].slice(-MAX_SUBSCRIPTIONS);
      await store.prefs.setUser(userId, SUBSCRIPTIONS_PREF, next);
    },
    async unsubscribe(userId, endpoint) {
      const current = await listSubscriptions(userId);
      const next = current.filter((item) => item.endpoint !== endpoint);
      if (next.length === current.length) return false;
      await store.prefs.setUser(userId, SUBSCRIPTIONS_PREF, next);
      return true;
    },
    events,
    async setEvents(userId, patch) {
      const next = { ...(await events(userId)), ...patch };
      await store.prefs.setUser(userId, EVENTS_PREF, next);
      return next;
    },
    async deliver(notification) {
      try {
        if (!(await events(notification.userId))[notification.kind]) return;
        const subscriptions = await listSubscriptions(notification.userId);
        if (subscriptions.length === 0) return;
        const details = await vapid();
        if (!details) return;
        const payload = JSON.stringify({
          id: notification.id,
          title: notification.title,
          body: notification.body.slice(0, 200),
          url: notification.chatId ? `/chats/${notification.chatId}` : "/",
        });
        const gone: string[] = [];
        await Promise.all(
          subscriptions.map(async (item) => {
            try {
              await sender.sendNotification(
                { endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } },
                payload,
                { vapidDetails: { subject, ...details }, TTL: 60 * 60 * 24 },
              );
            } catch (error) {
              const status = (error as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410) gone.push(item.endpoint);
            }
          }),
        );
        if (gone.length > 0) {
          const current = await listSubscriptions(notification.userId);
          await store.prefs.setUser(
            notification.userId,
            SUBSCRIPTIONS_PREF,
            current.filter((item) => !gone.includes(item.endpoint)),
          );
        }
      } catch {
        // A failed push must never fail the run that raised the notification.
      }
    },
  };
}

/** Sends a push after every notification the wrapped store creates, for any user. */
export function withPush(base: Store, push: PushService): Store {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "notifications") {
        return {
          ...target.notifications,
          async create(input: Parameters<Store["notifications"]["create"]>[0]) {
            const created = await target.notifications.create(input);
            void push.deliver(created);
            return created;
          },
        };
      }
      if (prop === "forUser") return (userId: string) => withPush(target.forUser(userId), push);
      return Reflect.get(target, prop, target);
    },
  });
}

function readSubscriptions(value: unknown): PushSubscriptionRecord[] {
  if (!Array.isArray(value)) return [];
  const out: PushSubscriptionRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.endpoint === "string" && typeof row.p256dh === "string" && typeof row.auth === "string") {
      out.push({
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
      });
    }
  }
  return out;
}

function readEvents(value: unknown): PushEvents {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = {} as PushEvents;
  for (const kind of PUSH_EVENT_KINDS) out[kind] = typeof row[kind] === "boolean" ? row[kind] : true;
  return out;
}
