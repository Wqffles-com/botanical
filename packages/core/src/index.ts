export {
  AGENT_COLORS,
  AGENT_ICON_PATTERN,
  AGENT_NAME_MAX,
  DEFAULT_AGENT_COLOR,
  DEFAULT_AGENT_ICON,
  EXAMPLE_AGENTS,
  EXAMPLE_AGENTS_CREATED_AT,
  isAgentColor,
  isAgentIcon,
} from "./agents";
export type { AgentColor, ExampleAgent } from "./agents";
export { BotanicalClient } from "./client";
export type { BotanicalClientOptions } from "./client";
export {
  AgentRequiredError,
  BotanicalApiError,
  ProfileRequiredError,
  isAbortError,
  isUnauthorized,
  requireAgentId,
  requireProfileId,
} from "./errors";
export { normalizeAgent, normalizeChat, normalizeMessage, normalizeProfile } from "./normalize";
export { API } from "./paths";
export { parseNdjsonLine, parseSseFrame, readChatStream } from "./sse";
export { CLIENT_CONTRACT_VERSION } from "./types";
export type {
  Agent,
  Chat,
  ChatMessage,
  ChatStreamEvent,
  CreateAgentInput,
  CreateChatInput,
  DeploymentMode,
  Health,
  LoginResult,
  Me,
  MessageRole,
  ModelProfile,
  SendMessageInput,
  TokenUsage,
  ToolCall,
  UpdateAgentInput,
  UpdateChatInput,
} from "./types";
