import type { Agent } from "@botanical/core";
import {
  DEFAULT_AGENT_COLOR,
  resolveAgentColor,
  type AgentColor,
} from "./agent-colors";
import {
  DEFAULT_AGENT_ICON,
  resolveAgentIconName,
  type AgentIconName,
} from "./agent-icons";

/**
 * Identity fields the MVP contract adds onto Agent. Core may not have
 * typed them yet; read them defensively so the UI still renders.
 */
export type AgentIdentity = {
  name: string;
  icon: AgentIconName;
  color: AgentColor;
  description: string;
};

type IdentitySource = Partial<Agent> & {
  icon?: string | null;
  color?: string | null;
  prompt?: string | null;
  tools?: string[] | null;
};

export function agentIdentity(agent: IdentitySource | null | undefined): AgentIdentity {
  return {
    name: agent?.name?.trim() || "Agent",
    icon: resolveAgentIconName(agent?.icon) ?? DEFAULT_AGENT_ICON,
    color: resolveAgentColor(agent?.color) ?? DEFAULT_AGENT_COLOR,
    description: agent?.description?.trim() ?? "",
  };
}
