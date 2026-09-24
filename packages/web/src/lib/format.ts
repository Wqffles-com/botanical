import type { ModelProfile } from "@botanical/core";

export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const delta = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "now";
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;
  if (delta < 7 * day) return `${Math.floor(delta / day)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function profileLabel(profile: ModelProfile): string {
  const detail = [profile.provider, profile.model].filter(Boolean).join(" / ");
  return detail ? `${profile.name} · ${detail}` : profile.name;
}

export function formatJson(value: unknown, limit = 0): string {
  if (value == null || value === "") return "";
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
  if (limit > 0 && text.length > limit) return `${text.slice(0, limit)}…`;
  return text;
}

export function formatArgs(value: unknown): string {
  return formatJson(value, 280);
}
