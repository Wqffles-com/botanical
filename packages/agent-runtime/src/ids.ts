/** URL-safe ids: uuids and slugs. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
