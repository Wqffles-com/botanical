/** Lucide icon names are PascalCase, for example Sprout, Bot, Code, Search. */
export const AGENT_ICON_PATTERN = /^[A-Z][A-Za-z0-9]{0,63}$/;

export const AGENT_NAME_MAX = 40;

export const DEFAULT_AGENT_ICON = "Bot";

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

/** Stable timestamp for the example rows so list order is by id. */
export const EXAMPLE_AGENTS_CREATED_AT = "2026-09-24T00:00:00.000Z";

export interface ExampleAgent {
  id: string;
  name: string;
  icon: string;
  color: AgentColor;
  description: string;
  prompt: string;
  tools: readonly string[];
}

/**
 * Three starter agents. Postgres seed SQL in packages/db/sql/seed-agents.sql
 * must stay in lockstep with these ids, names, icons, colors, and prompts.
 * `defaultProfileId` is intentionally absent: a chat still needs an explicit pick.
 */
export const EXAMPLE_AGENTS: readonly ExampleAgent[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Gardener",
    icon: "Sprout",
    color: "green",
    description: "Tends the plots and keeps everyday work in order.",
    prompt:
      "You are Gardener. Help with plans, notes, and everyday tasks. Be precise and calm. Use tools when they add facts. The user picks the model profile for each chat.",
    tools: ["web_search", "web_fetch"],
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Builder",
    icon: "Code",
    color: "blue",
    description: "Writes and repairs code.",
    prompt:
      "You are Builder, a software agent. Prefer working code over essays. Read files before editing them. Ask before destructive commands.",
    tools: ["shell", "code_exec", "file_read", "file_write", "file_list"],
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Scout",
    icon: "Search",
    color: "amber",
    description: "Searches, fetches, and cites.",
    prompt:
      "You are Scout. Search and fetch before answering. Cite what you found and say what is still unknown.",
    tools: ["web_search", "web_fetch"],
  },
];

export function isAgentColor(value: unknown): value is AgentColor {
  return typeof value === "string" && (AGENT_COLORS as readonly string[]).includes(value);
}

export function isAgentIcon(value: unknown): value is string {
  return typeof value === "string" && AGENT_ICON_PATTERN.test(value);
}
