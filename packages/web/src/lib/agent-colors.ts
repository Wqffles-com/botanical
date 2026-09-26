/**
 * Agent color palette. Keep in sync with the shared MVP contract:
 * red, orange, amber, green, teal, cyan, blue, violet, pink, gray.
 * Default is green (the Botanical leaf).
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

/**
 * Calm, slightly desaturated swatches that sit on the botanical dark
 * canvas and still read on the light paper theme.
 */
export const AGENT_COLOR_TOKENS: Record<AgentColor, AgentColorTokens> = {
  red: {
    fill: "#c45c4a",
    ink: "#1a0d0b",
    wash: "rgba(196, 92, 74, 0.16)",
    ring: "rgba(196, 92, 74, 0.55)",
  },
  orange: {
    fill: "#d4894a",
    ink: "#1a1008",
    wash: "rgba(212, 137, 74, 0.16)",
    ring: "rgba(212, 137, 74, 0.55)",
  },
  amber: {
    fill: "#d4b07a",
    ink: "#1a140c",
    wash: "rgba(212, 176, 122, 0.16)",
    ring: "rgba(212, 176, 122, 0.55)",
  },
  green: {
    fill: "#8fca7a",
    ink: "#10150f",
    wash: "rgba(143, 202, 122, 0.16)",
    ring: "rgba(143, 202, 122, 0.55)",
  },
  teal: {
    fill: "#5eaea0",
    ink: "#0c1412",
    wash: "rgba(94, 174, 160, 0.16)",
    ring: "rgba(94, 174, 160, 0.55)",
  },
  cyan: {
    fill: "#7eb0c4",
    ink: "#0c1418",
    wash: "rgba(126, 176, 196, 0.16)",
    ring: "rgba(126, 176, 196, 0.55)",
  },
  blue: {
    fill: "#6a8ec8",
    ink: "#0c1018",
    wash: "rgba(106, 142, 200, 0.16)",
    ring: "rgba(106, 142, 200, 0.55)",
  },
  violet: {
    fill: "#9a82c4",
    ink: "#120e18",
    wash: "rgba(154, 130, 196, 0.16)",
    ring: "rgba(154, 130, 196, 0.55)",
  },
  pink: {
    fill: "#c48aa0",
    ink: "#180c12",
    wash: "rgba(196, 138, 160, 0.16)",
    ring: "rgba(196, 138, 160, 0.55)",
  },
  gray: {
    fill: "#8f9c93",
    ink: "#10150f",
    wash: "rgba(143, 156, 147, 0.16)",
    ring: "rgba(143, 156, 147, 0.55)",
  },
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
