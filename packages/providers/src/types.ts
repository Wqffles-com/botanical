/**
 * Streaming chat contract shared with the Botanical server.
 * Profiles are named configs. Callers pass `profileId`; nothing is implied.
 */

export const PROVIDER_TYPES = [
  "openai",
  "anthropic",
  "xai",
  "deepseek",
  "openrouter",
  "openai-compat",
  "mock",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  /** Remote URL, or a `data:` URL. */
  url?: string;
  /** Base64 payload without a data-URL prefix. */
  data?: string;
  mediaType?: string;
}

export type ContentPart = TextPart | ImagePart;

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed JSON object when the model emitted JSON; otherwise the raw string. */
  arguments: unknown;
}

export interface ChatMessage {
  role: Role;
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the tool arguments. */
  parameters?: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: Error }
  | { type: "done" };

export interface ModelCapabilities {
  tools: boolean;
  parallelTools: boolean;
  vision: boolean;
  /** Hint for policy. Override per model in provider config when this is stale. */
  maxContext: number;
  streaming: boolean;
  reasoning: boolean;
}

export interface LLMProvider {
  readonly id: string;
  readonly type: ProviderType;
  /** Throws when the server env key (if required) is missing. Does not perform I/O. */
  assertReady(): void;
  complete(req: ChatRequest): AsyncIterable<ChatEvent>;
  capabilities(model: string): ModelCapabilities;
}

export interface OpenRouterRouting {
  order?: string[];
  allowFallbacks?: boolean;
  only?: string[];
  ignore?: string[];
}

export interface MockScript {
  reply?: string | ((req: ChatRequest) => string);
  events?: ChatEvent[] | ((req: ChatRequest) => ChatEvent[]);
  /** Characters per text chunk when `reply` is used. Default 12. */
  chunkSize?: number;
  capabilities?: Partial<ModelCapabilities>;
}

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  /**
   * Environment variable on the server that holds the API key.
   * The key value is never stored in config.
   * Omitted for `mock`. Optional for `openai-compat` (no Authorization header).
   * Other types default to the canonical `*_API_KEY` name.
   */
  apiKeyEnv?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  /** OpenRouter `HTTP-Referer`. */
  httpReferer?: string;
  /** OpenRouter `X-Title`. */
  appTitle?: string;
  routing?: OpenRouterRouting;
  /** Send `stream_options.include_usage`. Default true for OpenAI-compatible providers. */
  includeUsage?: boolean;
  /** Anthropic Messages API version header. Default `2023-06-01`. */
  anthropicVersion?: string;
  capabilities?: Record<string, Partial<ModelCapabilities>>;
  /** Used only when `type` is `mock`. */
  mock?: MockScript;
}

export interface ModelProfile {
  id: string;
  /** Provider config id, not the vendor type. */
  provider: string;
  model: string;
  label?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ProvidersConfig {
  providers: ProviderConfig[];
  profiles: ModelProfile[];
}

/**
 * What the server passes to run one streaming completion.
 * `profileId` is mandatory at the type level and checked again at runtime.
 */
export interface CompletionInput {
  profileId: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Replaces the profile model only when the caller sets it. */
  model?: string;
}

export interface ResolvedCompletion {
  profile: ModelProfile;
  providerId: string;
  providerType: ProviderType;
  model: string;
}

export interface ProviderStatus {
  id: string;
  type: ProviderType;
  /** True when a key is not required, or the configured env var is non-empty. */
  keyConfigured: boolean;
  apiKeyEnv?: string;
}

export interface ProviderRegistry {
  listProfiles(): readonly ModelProfile[];
  listProviders(): readonly ProviderStatus[];
  getProfile(profileId: string): ModelProfile | undefined;
  requireProfile(profileId: string): ModelProfile;
  /** Capabilities for an explicit profile. Uses `model` when the caller passes one. */
  capabilities(profileId: string, model?: string): ModelCapabilities;
  /** Validate profile, model, and server env key. Does not call the vendor. */
  resolve(input: CompletionInput): ResolvedCompletion;
  /** Stream a completion. Throws synchronously if `profileId` is missing or unknown. */
  complete(input: CompletionInput): AsyncIterable<ChatEvent>;
}
