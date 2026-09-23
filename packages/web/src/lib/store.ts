import type { A2AMessage, Agent, Chat, ChatMessage, Profile, ServerMeta, ToolId } from './types'
import { uid } from './format'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

export const ALL_TOOLS: { id: ToolId; label: string; hint: string }[] = [
  { id: 'web-search', label: 'Web search', hint: 'Query the public web' },
  { id: 'web-fetch', label: 'Fetch', hint: 'HTTP GET a URL' },
  { id: 'shell', label: 'Shell', hint: 'Run gated commands' },
  { id: 'files', label: 'Files', hint: 'Workspace read / write' },
  { id: 'mcp', label: 'MCP', hint: 'Opt-in connectors' },
]

export const profiles: Profile[] = [
  {
    id: 'fast',
    name: 'Fast',
    description: 'Low latency, cheap bulk work.',
    provider: 'deepseek',
    model: 'deepseek-chat',
    costTier: 'low',
    capabilities: { tools: true, vision: false, streaming: true },
  },
  {
    id: 'reason',
    name: 'Reason',
    description: 'Hard problems, code, long context.',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    costTier: 'high',
    capabilities: { tools: true, vision: true, streaming: true },
  },
  {
    id: 'grok',
    name: 'Grok',
    description: 'Personality and realtime flavor.',
    provider: 'xai',
    model: 'grok-4',
    costTier: 'mid',
    capabilities: { tools: true, vision: true, streaming: true },
  },
  {
    id: 'router',
    name: 'Router',
    description: 'Catalog routing with fallbacks.',
    provider: 'openrouter',
    model: 'openrouter/auto',
    costTier: 'mid',
    capabilities: { tools: true, vision: true, streaming: true },
  },
  {
    id: 'local',
    name: 'Local',
    description: 'OpenAI-compat endpoint on this host.',
    provider: 'custom',
    model: 'llama-local',
    costTier: 'low',
    capabilities: { tools: false, vision: false, streaming: true },
  },
]

const seedAgents: Agent[] = [
  {
    id: 'ag_greenhouse',
    name: 'Greenhouse',
    description: 'General operator. Routes work, keeps context.',
    prompt:
      'You are Greenhouse, the default Botanical operator. Be precise, calm, and tool-aware. Never assume a model profile — the user already picked one.',
    tools: ['web-search', 'web-fetch', 'files', 'mcp'],
    color: '#8fca7a',
    createdAt: hoursAgo(240),
  },
  {
    id: 'ag_root',
    name: 'Root',
    description: 'Code, shell, and repo surgery.',
    prompt:
      'You are Root, a software agent. Prefer patches over essays. Use shell and files. Ask before destructive commands.',
    tools: ['shell', 'files', 'web-fetch'],
    color: '#7eb0c4',
    createdAt: hoursAgo(180),
  },
  {
    id: 'ag_forager',
    name: 'Forager',
    description: 'Research. Search, fetch, cite.',
    prompt:
      'You are Forager. Search and fetch before opining. Quote sources. Keep a running map of what is still unknown.',
    tools: ['web-search', 'web-fetch'],
    color: '#d4b07a',
    createdAt: hoursAgo(120),
  },
  {
    id: 'ag_clerk',
    name: 'Clerk',
    description: 'Notes, files, and tidy summaries.',
    prompt:
      'You are Clerk. File-oriented. Summarize, rename, and keep the workspace legible.',
    tools: ['files'],
    color: '#c4a0d4',
    createdAt: hoursAgo(90),
  },
]

const seedChats: Chat[] = [
  {
    id: 'ch_forager_1',
    title: 'MCP vs native tools',
    agentId: 'ag_forager',
    profileId: 'reason',
    updatedAt: hoursAgo(0.4),
    preview: 'MCP is the extension surface; built-ins stay in-process.',
    unreadA2A: 1,
  },
  {
    id: 'ch_root_1',
    title: 'Postgres session schema',
    agentId: 'ag_root',
    profileId: 'reason',
    updatedAt: hoursAgo(3),
    preview: 'Keep chats.agent_id NOT NULL — one agent per thread.',
    unreadA2A: 0,
  },
  {
    id: 'ch_green_1',
    title: 'Evening sweep',
    agentId: 'ag_greenhouse',
    profileId: 'fast',
    updatedAt: hoursAgo(22),
    preview: 'Three open threads, one A2A waiting on Clerk.',
    unreadA2A: 0,
  },
]

const seedMessages: ChatMessage[] = [
  {
    id: 'm1',
    chatId: 'ch_forager_1',
    role: 'user',
    content:
      'Where should third-party connectors live — MCP or first-party tools? Search current practice.',
    createdAt: hoursAgo(0.7),
  },
  {
    id: 'm2',
    chatId: 'ch_forager_1',
    role: 'assistant',
    content:
      'Connectors that Botanical does not own should arrive as MCP servers. Built-ins stay native so the agent loop can gate, audit, and sandbox them without speaking MCP to itself.\n\n**Rule of thumb**\n- Web search, fetch, shell, files → built-in\n- GitHub, Notion, calendar, anything operator-installed → `mcp.<server>.<tool>`\n\nThat keeps the core portable and avoids a plugin marketplace in v0.',
    createdAt: hoursAgo(0.4),
    toolCalls: [
      {
        id: 'tc1',
        name: 'web-search',
        arguments: '{"q":"MCP vs native agent tools 2026"}',
        status: 'done',
        result: '12 results · modelcontextprotocol.io, Anthropic, OpenAI',
      },
      {
        id: 'tc2',
        name: 'web-fetch',
        arguments: '{"url":"https://modelcontextprotocol.io"}',
        status: 'done',
        result: 'MCP: standard for exposing tools/resources to LLM hosts.',
      },
    ],
  },
  {
    id: 'm3',
    chatId: 'ch_root_1',
    role: 'user',
    content: 'Sketch the chats table so one agent owns each thread.',
    createdAt: hoursAgo(3.2),
  },
  {
    id: 'm4',
    chatId: 'ch_root_1',
    role: 'assistant',
    content:
      'Keep ownership on the row, not in a join table.\n\n```sql\ncreate table chats (\n  id uuid primary key,\n  agent_id uuid not null references agents(id),\n  profile_id text not null,\n  title text not null default \'\',\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\n```\n\n`profile_id` is the last explicit pick — never a silent default.',
    createdAt: hoursAgo(3),
    toolCalls: [
      {
        id: 'tc3',
        name: 'files',
        arguments: '{"op":"read","path":"packages/db/schema.sql"}',
        status: 'done',
        result: 'placeholder schema — chats.agent_id present',
      },
    ],
  },
  {
    id: 'm5',
    chatId: 'ch_green_1',
    role: 'user',
    content: 'What is still open tonight?',
    createdAt: hoursAgo(22.2),
  },
  {
    id: 'm6',
    chatId: 'ch_green_1',
    role: 'assistant',
    content:
      'Three threads, one teammate ping.\n\n- Forager is mid-research on MCP vs native tools.\n- Root has a schema sketch waiting for your eye.\n- Clerk sent Root a note about migration naming — unread in the inbox.',
    createdAt: hoursAgo(22),
  },
]

const seedA2A: A2AMessage[] = [
  {
    id: 'a2a1',
    fromAgentId: 'ag_clerk',
    toAgentId: 'ag_root',
    preview: 'Migration files should be YYYYMMDD_name.sql — I renamed two drafts.',
    createdAt: hoursAgo(1.2),
    read: false,
  },
  {
    id: 'a2a2',
    fromAgentId: 'ag_forager',
    toAgentId: 'ag_greenhouse',
    preview: 'Fetched MCP spec. Recommend we keep built-ins out of MCP in v0.',
    createdAt: hoursAgo(0.5),
    read: false,
  },
]

export const store = {
  meta: {
    mode: 'self-host' as const,
    version: '0.0.0-design',
    serverName: 'botanical.local',
  } satisfies ServerMeta,
  profiles,
  agents: [...seedAgents],
  chats: [...seedChats],
  messages: [...seedMessages],
  a2a: [...seedA2A],
}

export function getAgent(id: string) {
  return store.agents.find((a) => a.id === id)
}

export function getChat(id: string) {
  return store.chats.find((c) => c.id === id)
}

export function getProfile(id: string) {
  return store.profiles.find((p) => p.id === id)
}

export function messagesFor(chatId: string) {
  return store.messages
    .filter((m) => m.chatId === chatId)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function upsertAgent(input: Omit<Agent, 'createdAt'> & { createdAt?: string }): Agent {
  const existing = store.agents.find((a) => a.id === input.id)
  if (existing) {
    Object.assign(existing, input)
    return existing
  }
  const agent: Agent = {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  store.agents.unshift(agent)
  return agent
}

export function removeAgent(id: string) {
  store.agents = store.agents.filter((a) => a.id !== id)
}

export function createChat(agentId: string, profileId: string): Chat {
  const agent = getAgent(agentId)
  const chat: Chat = {
    id: uid('ch'),
    title: 'New chat',
    agentId,
    profileId,
    updatedAt: new Date().toISOString(),
    preview: agent ? `With ${agent.name}` : 'Empty thread',
    unreadA2A: 0,
  }
  store.chats.unshift(chat)
  return chat
}

export function appendMessage(message: ChatMessage) {
  store.messages.push(message)
  const chat = getChat(message.chatId)
  if (chat) {
    chat.updatedAt = message.createdAt
    if (message.content.trim()) {
      chat.preview = message.content.trim().slice(0, 96)
    }
    if (chat.title === 'New chat' && message.role === 'user') {
      chat.title = message.content.trim().slice(0, 42) || 'New chat'
    }
  }
}

export function markA2ARead(id: string) {
  const row = store.a2a.find((m) => m.id === id)
  if (row) row.read = true
}
