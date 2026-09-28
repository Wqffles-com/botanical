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

/**
 * Swatch fills for the settings picker. They read the same `--swatch-*` tokens the
 * accent overrides use (`@botanical/ui/styles.css`), so picker and theme cannot drift.
 */
export function accentSwatch(accent: Exclude<AccentColor, "neutral">): string {
  return `var(--swatch-${accent})`;
}

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
