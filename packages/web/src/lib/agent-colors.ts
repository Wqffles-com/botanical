/**
 * Agent color slots. Names stay on the shared contract
 * (red, orange, amber, green, teal, cyan, blue, violet, pink, gray).
 * Each slot is a hue used on that bot's avatar and sidebar mark.
 * The rest of the chrome stays monochrome. Default is green.
 */

export const AGENT_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "blue",
  "violet",
  "pink",
  "gray",
] as const;

export type AgentColor = (typeof AGENT_COLORS)[number];

export const DEFAULT_AGENT_COLOR: AgentColor = "green";

export type AgentColorTokens = {
  /** Fill of the avatar tile. */
  fill: string;
  /** Icon / ink on the tile. */
  ink: string;
  /** Soft wash behind selected rows and chips. */
  wash: string;
  /** Stronger ring / border accent. */
  ring: string;
};

/** Hue fills for the avatar mark. Ink is chosen for contrast on that fill. */
export const AGENT_COLOR_TOKENS: Record<AgentColor, AgentColorTokens> = {
  red: { fill: "#dc2626", ink: "#ffffff", wash: "rgba(220, 38, 38, 0.14)", ring: "#dc2626" },
  orange: { fill: "#ea580c", ink: "#ffffff", wash: "rgba(234, 88, 12, 0.14)", ring: "#ea580c" },
  amber: { fill: "#d97706", ink: "#1c1917", wash: "rgba(217, 119, 6, 0.16)", ring: "#d97706" },
  green: { fill: "#16a34a", ink: "#ffffff", wash: "rgba(22, 163, 74, 0.14)", ring: "#16a34a" },
  teal: { fill: "#0f766e", ink: "#ffffff", wash: "rgba(15, 118, 110, 0.14)", ring: "#0f766e" },
  cyan: { fill: "#0891b2", ink: "#ffffff", wash: "rgba(8, 145, 178, 0.14)", ring: "#0891b2" },
  blue: { fill: "#2563eb", ink: "#ffffff", wash: "rgba(37, 99, 235, 0.14)", ring: "#2563eb" },
  violet: { fill: "#7c3aed", ink: "#ffffff", wash: "rgba(124, 58, 237, 0.14)", ring: "#7c3aed" },
  pink: { fill: "#db2777", ink: "#ffffff", wash: "rgba(219, 39, 119, 0.14)", ring: "#db2777" },
  gray: { fill: "#525252", ink: "#fafafa", wash: "rgba(0, 0, 0, 0.06)", ring: "#525252" },
};

export function isAgentColor(value: unknown): value is AgentColor {
  return typeof value === "string" && (AGENT_COLORS as readonly string[]).includes(value);
}

export function resolveAgentColor(value: unknown): AgentColor {
  return isAgentColor(value) ? value : DEFAULT_AGENT_COLOR;
}

export function agentColorTokens(value: unknown): AgentColorTokens {
  return AGENT_COLOR_TOKENS[resolveAgentColor(value)];
}
