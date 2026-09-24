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

/** Tailwind-friendly tile classes for each AgentColor. */
export const AGENT_COLOR_CLASSES: Record<
  AgentColor,
  { bg: string; fg: string; ring: string }
> = {
  red: { bg: "bg-red-500/90", fg: "text-white", ring: "ring-red-400/40" },
  orange: { bg: "bg-orange-500/90", fg: "text-white", ring: "ring-orange-400/40" },
  amber: { bg: "bg-amber-500/90", fg: "text-stone-900", ring: "ring-amber-400/40" },
  green: { bg: "bg-emerald-500/90", fg: "text-emerald-950", ring: "ring-emerald-400/40" },
  teal: { bg: "bg-teal-500/90", fg: "text-teal-950", ring: "ring-teal-400/40" },
  cyan: { bg: "bg-cyan-500/90", fg: "text-cyan-950", ring: "ring-cyan-400/40" },
  blue: { bg: "bg-blue-500/90", fg: "text-white", ring: "ring-blue-400/40" },
  violet: { bg: "bg-violet-500/90", fg: "text-white", ring: "ring-violet-400/40" },
  pink: { bg: "bg-pink-500/90", fg: "text-white", ring: "ring-pink-400/40" },
  gray: { bg: "bg-zinc-500/90", fg: "text-white", ring: "ring-zinc-400/40" },
};

export function isAgentColor(value: unknown): value is AgentColor {
  return typeof value === "string" && (AGENT_COLORS as readonly string[]).includes(value);
}

export function agentColorOf(value: unknown): AgentColor {
  return isAgentColor(value) ? value : "green";
}
