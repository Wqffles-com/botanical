/** Short list blurb plus the system prompt sent to the model. */
export type AgentToolBinding = {
  /** Built-in id (`web_search`) or MCP id (`mcp.<server>.<tool>`). */
  name: string;
  enabled?: boolean;
  /** Non-secret tool options. Never put API keys here. */
  config?: Record<string, unknown>;
};

/**
 * Model profile options. `apiKeyEnv` is the name of a server env var.
 * A check constraint rejects raw key fields (`apiKey`, `api_key`, `secret`, `token`, `password`).
 */
export type ModelProfileConfig = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** OpenAI-compatible base URL for custom providers. Not a secret. */
  baseUrl?: string;
  /** Env var NAME that holds the API key. Never the key itself. */
  apiKeyEnv?: string;
  reasoningEffort?: string;
  extra?: Record<string, unknown>;
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; mediaType?: string };

export type StoredToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export const TOOL_AUDIT_STATUSES = ['ok', 'error', 'denied', 'pending_approval'] as const;
export type ToolAuditStatus = (typeof TOOL_AUDIT_STATUSES)[number];

export const DEPLOYMENT_MODES = ['self_host', 'saas'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];
