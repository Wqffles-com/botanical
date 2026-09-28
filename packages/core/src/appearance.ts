/** App accent. `neutral` keeps the monochrome primary, ring, and buttons. */
export const ACCENT_COLORS = ["neutral", "blue", "red", "green", "orange", "violet"] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_ACCENT: AccentColor = "neutral";

/** `user_settings` key. The value is the accent name, stored as JSON. */
export const ACCENT_SETTING_KEY = "appearance.accent";

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && (ACCENT_COLORS as readonly string[]).includes(value);
}

export function normalizeAccent(value: unknown): AccentColor {
  return isAccentColor(value) ? value : DEFAULT_ACCENT;
}
