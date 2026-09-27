/**
 * Agent color slots. Names stay on the shared contract
 * (red, orange, amber, green, teal, cyan, blue, violet, pink, gray)
 * so stored agents keep their identity. Swatches are a grayscale ramp:
 * icons and names carry the distinction, not hue.
 * Default is green.
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

const wash = "rgba(0, 0, 0, 0.06)";
const ring = "rgba(0, 0, 0, 0.45)";

/** Equal-channel hex so each slot is a different gray, never a hue. */
export const AGENT_COLOR_TOKENS: Record<AgentColor, AgentColorTokens> = {
  red: { fill: "#171717", ink: "#fafafa", wash, ring },
  orange: { fill: "#262626", ink: "#fafafa", wash, ring },
  amber: { fill: "#333333", ink: "#fafafa", wash, ring },
  green: { fill: "#404040", ink: "#fafafa", wash, ring },
  teal: { fill: "#525252", ink: "#fafafa", wash, ring },
  cyan: { fill: "#666666", ink: "#fafafa", wash, ring },
  blue: { fill: "#737373", ink: "#111111", wash, ring },
  violet: { fill: "#8a8a8a", ink: "#111111", wash, ring },
  pink: { fill: "#a3a3a3", ink: "#111111", wash, ring },
  gray: { fill: "#d4d4d4", ink: "#111111", wash, ring },
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
