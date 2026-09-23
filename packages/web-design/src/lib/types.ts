export type DeploymentMode = 'self-host' | 'saas'

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'deepseek'
  | 'openrouter'
  | 'custom'

export type ToolId = 'web-search' | 'web-fetch' | 'shell' | 'files' | 'mcp'

export type CostTier = 'low' | 'mid' | 'high'

export interface Profile {
  id: string
  name: string
  description: string
  provider: ProviderId
  model: string
  costTier: CostTier
  capabilities: {
    tools: boolean
    vision: boolean
    streaming: boolean
  }
}

export interface Agent {
  id: string
  name: string
  description: string
  prompt: string
  tools: ToolId[]
  color: string
  createdAt: string
}

export interface Chat {
  id: string
  title: string
  agentId: string
  profileId: string
  updatedAt: string
  preview: string
  unreadA2A: number
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: string
  status: 'running' | 'done' | 'error'
  result?: string
}

export interface ChatMessage {
  id: string
  chatId: string
  role: MessageRole
  content: string
  createdAt: string
  toolCalls?: ToolCall[]
}

export interface A2AMessage {
  id: string
  fromAgentId: string
  toAgentId: string
  preview: string
  createdAt: string
  read: boolean
}

export interface ServerMeta {
  mode: DeploymentMode
  version: string
  serverName: string
}

export type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: unknown }
  | { type: 'tool-result'; id: string; result: string; status: 'done' | 'error' }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done' }
