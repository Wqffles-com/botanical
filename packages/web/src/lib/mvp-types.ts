import type { DeploymentMode, ModelProfile } from "@botanical/core";

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

export interface AgentIdentity {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: AgentColor;
}

export interface CatalogTool {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "mcp";
  serverId: string | null;
  risk: string | null;
}

export type McpServerState = "ready" | "error" | "closed" | "disabled" | "connecting" | "unknown";

export interface McpServerRow {
  id: string;
  transport: string;
  state: McpServerState;
  toolCount: number;
  serverName: string | null;
  error: string | null;
}

export interface McpSnapshot {
  disabled: boolean;
  source: string;
  configError: string | null;
  servers: McpServerRow[];
}

export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  body: string;
  status: AgentMessageStatus;
  createdAt: string;
}

export interface AppSettings {
  deploymentMode: DeploymentMode | null;
  brandName: string | null;
  version: string | null;
  features: Record<string, boolean>;
  providers: ProviderKeyStatus[];
}

export interface ProviderKeyStatus {
  id: string;
  label: string;
  configured: boolean;
}

export interface ProfileRow extends ModelProfile {
  configured: boolean;
}

export const KNOWN_PROVIDERS: readonly ProviderKeyStatus[] = [
  { id: "openai", label: "OpenAI", configured: false },
  { id: "anthropic", label: "Anthropic", configured: false },
  { id: "xai", label: "xAI", configured: false },
  { id: "deepseek", label: "DeepSeek", configured: false },
  { id: "openrouter", label: "OpenRouter", configured: false },
  { id: "openai-compat", label: "OpenAI-compatible", configured: false },
  { id: "mock", label: "Mock", configured: true },
] as const;
