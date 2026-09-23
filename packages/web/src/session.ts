const STORAGE_KEY = "botanical.session.v1";

export interface StoredSession {
  token: string;
  expiresAt: string | null;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSession(store: KeyValueStore = localStorage, now = Date.now()): StoredSession | null {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!parsed || typeof parsed.token !== "string" || parsed.token.trim() === "") {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    if (typeof parsed.expiresAt === "string" && Number.isFinite(Date.parse(parsed.expiresAt)) && Date.parse(parsed.expiresAt) <= now) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      token: parsed.token,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
    };
  } catch {
    store.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveSession(session: StoredSession, store: KeyValueStore = localStorage): void {
  if (session.token.trim() === "") {
    store.removeItem(STORAGE_KEY);
    return;
  }
  store.setItem(STORAGE_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }));
}

export function clearSession(store: KeyValueStore = localStorage): void {
  store.removeItem(STORAGE_KEY);
}
