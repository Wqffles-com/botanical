"use client";

export type PushEventKind = "run_succeeded" | "run_failed" | "attention";
export type PushEvents = Record<PushEventKind, boolean>;

export interface PushState {
  publicKey: string | null;
  events: PushEvents;
  subscriptions: Array<{ endpoint: string; createdAt: string }>;
}

export const PUSH_EVENT_LABELS: Array<{ kind: PushEventKind; label: string; hint: string }> = [
  { kind: "run_succeeded", label: "Run finished", hint: "A routine or listener turn completed." },
  { kind: "run_failed", label: "Run failed", hint: "A routine or listener turn errored or was interrupted." },
  { kind: "attention", label: "Agent needs you", hint: "An agent called notify_user." },
];

/** Web push needs a service worker, the Push API, and Notification permission. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: { message?: string } | string };
      if (typeof body.error === "string") message = body.error;
      else if (body.error?.message) message = body.error.message;
    } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function loadPushState(): Promise<PushState> {
  return call<PushState>("/api/push");
}

export function savePushEvents(patch: Partial<PushEvents>): Promise<{ events: PushEvents }> {
  return call("/api/push/events", { method: "PATCH", body: JSON.stringify(patch) });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    }));
  const json = subscription.toJSON();
  await call("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await call("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  await subscription.unsubscribe();
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
