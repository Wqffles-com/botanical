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
};

/**
 * Each slot reads `--agent-<color>` and `--agent-<color>-ink` from `@botanical/ui/styles.css`,
 * which defines a light and a dark value so every mark keeps contrast on either page.
 */
export const AGENT_COLOR_TOKENS: Record<AgentColor, AgentColorTokens> = Object.fromEntries(
  AGENT_COLORS.map((color) => [color, { fill: `var(--agent-${color})`, ink: `var(--agent-${color}-ink)` }]),
) as Record<AgentColor, AgentColorTokens>;

export function isAgentColor(value: unknown): value is AgentColor {
  return typeof value === "string" && (AGENT_COLORS as readonly string[]).includes(value);
}

export function resolveAgentColor(value: unknown): AgentColor {
  return isAgentColor(value) ? value : DEFAULT_AGENT_COLOR;
}

export function agentColorTokens(value: unknown): AgentColorTokens {
  return AGENT_COLOR_TOKENS[resolveAgentColor(value)];
}
