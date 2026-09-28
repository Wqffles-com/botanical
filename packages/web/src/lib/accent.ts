import { ACCENT_COLORS, DEFAULT_ACCENT, isAccentColor, type AccentColor } from "@botanical/core";

export const ACCENT_STORAGE_KEY = "botanical.accent";

export const ACCENT_LABEL: Record<AccentColor, string> = {
  neutral: "Neutral",
  blue: "Blue",
  red: "Red",
  green: "Green",
  orange: "Orange",
  violet: "Violet",
};

/** Swatch fills for the settings picker. Neutral follows the current primary. */
export const ACCENT_SWATCH: Record<Exclude<AccentColor, "neutral">, string> = {
  blue: "oklch(0.52 0.17 255)",
  red: "oklch(0.55 0.19 25)",
  green: "oklch(0.55 0.14 150)",
  orange: "oklch(0.64 0.16 55)",
  violet: "oklch(0.52 0.18 300)",
};

export function readStoredAccent(): AccentColor {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentColor(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function writeStoredAccent(accent: AccentColor): void {
  if (typeof window === "undefined") return;
  try {
    if (accent === DEFAULT_ACCENT) window.localStorage.removeItem(ACCENT_STORAGE_KEY);
    else window.localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Private mode can reject storage. The server value still applies this session.
  }
}

export function applyAccent(accent: AccentColor): void {
  if (typeof document === "undefined") return;
  if (accent === DEFAULT_ACCENT) delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
}

export { ACCENT_COLORS, DEFAULT_ACCENT };
export type { AccentColor };
