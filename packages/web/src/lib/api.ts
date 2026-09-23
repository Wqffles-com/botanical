/**
 * Placeholder client for packages/web.
 *
 * Swap the function bodies for real fetch/SSE against packages/server.
 * Event shapes match docs/ARCHITECTURE.md (`ChatEvent`).
 *
 * The UI never sends model API keys. Auth is a passcode only.
 */
import type {
  A2AMessage,
  Agent,
  Chat,
  ChatEvent,
  ChatMessage,
  Profile,
  ServerMeta,
} from './types'
import {
  appendMessage,
  createChat as storeCreateChat,
  getAgent,
  getChat,
  markA2ARead,
  messagesFor,
  removeAgent,
  store,
  upsertAgent,
} from './store'
import { sleep, uid } from './format'

const MOCK_LATENCY = 90

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function getMeta(): Promise<ServerMeta> {
  await sleep(MOCK_LATENCY)
  return { ...store.meta }
}

export async function login(passcode: string): Promise<{ token: string }> {
  await sleep(220)
  const trimmed = passcode.trim()
  if (trimmed.length < 4) {
    throw new ApiError(401, 'Passcode is too short.')
  }
  // Placeholder: any 4+ character passcode unlocks the shell.
  return { token: `dev_${uid('tok')}` }
}

export async function logout(): Promise<void> {
  await sleep(40)
}

export async function listProfiles(): Promise<Profile[]> {
  await sleep(MOCK_LATENCY)
  return store.profiles.map((p) => ({ ...p }))
}

export async function listAgents(): Promise<Agent[]> {
  await sleep(MOCK_LATENCY)
  return store.agents.map((a) => ({ ...a }))
}

export async function saveAgent(agent: Agent): Promise<Agent> {
  await sleep(160)
  return { ...upsertAgent(agent) }
}

export async function deleteAgent(id: string): Promise<void> {
  await sleep(120)
  if (!getAgent(id)) throw new ApiError(404, 'Agent not found')
  removeAgent(id)
}

export async function listChats(): Promise<Chat[]> {
  await sleep(MOCK_LATENCY)
  return store.chats
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((c) => ({ ...c }))
}

export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  await sleep(MOCK_LATENCY)
  if (!getChat(chatId)) throw new ApiError(404, 'Chat not found')
  return messagesFor(chatId).map((m) => ({
    ...m,
    toolCalls: m.toolCalls?.map((t) => ({ ...t })),
  }))
}

export async function startChat(agentId: string, profileId: string): Promise<Chat> {
  await sleep(120)
  if (!getAgent(agentId)) throw new ApiError(400, 'Unknown agent')
  return { ...storeCreateChat(agentId, profileId) }
}

export async function listA2A(): Promise<A2AMessage[]> {
  await sleep(MOCK_LATENCY)
  return store.a2a
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((m) => ({ ...m }))
}

export async function readA2A(id: string): Promise<void> {
  await sleep(40)
  markA2ARead(id)
}

function chunkText(text: string, size = 3): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

function planReply(prompt: string): ChatEvent[] {
  const lower = prompt.toLowerCase()
  const events: ChatEvent[] = []

  if (/(search|look up|research|mcp)/.test(lower)) {
    events.push({
      type: 'tool-call',
      id: uid('tc'),
      name: 'web-search',
      arguments: { q: prompt.slice(0, 80) },
    })
    events.push({
      type: 'tool-result',
      id: 'pending',
      result: '8 results · docs, forums, spec',
      status: 'done',
    })
  }
  if (/(file|schema|read |write )/.test(lower)) {
    events.push({
      type: 'tool-call',
      id: uid('tc'),
      name: 'files',
      arguments: { op: 'read', path: 'packages/db/schema.sql' },
    })
    events.push({
      type: 'tool-result',
      id: 'pending',
      result: 'schema.sql · 2.1kb',
      status: 'done',
    })
  }
  if (/(run |shell|command)/.test(lower)) {
    events.push({
      type: 'tool-call',
      id: uid('tc'),
      name: 'shell',
      arguments: { cmd: 'ls packages' },
    })
    events.push({
      type: 'tool-result',
      id: 'pending',
      result: 'core  db  providers  server  tools  web',
      status: 'done',
    })
  }

  const body = defaultReply(prompt)
  events.push({ type: 'text-delta', text: body })
  events.push({
    type: 'usage',
    inputTokens: 180 + prompt.length,
    outputTokens: Math.ceil(body.length / 4),
  })
  return events
}

function defaultReply(prompt: string): string {
  return `Understood. I will stay on the profile you picked and keep this thread on a single agent.\n\n${prompt.trim().length < 40 ? 'Say a little more about the outcome you want and I will go.' : 'Working from what you wrote: I would gather context, use tools if they are on this agent, then answer in one pass unless a tool forces a loop.'}\n\nThis is a placeholder stream — wire ` + '`POST /api/chats/:id/messages`' + ` when the server lands.`
}

export async function* streamMessage(
  chatId: string,
  content: string,
  profileId: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const chat = getChat(chatId)
  if (!chat) throw new ApiError(404, 'Chat not found')

  const userMsg: ChatMessage = {
    id: uid('m'),
    chatId,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  }
  appendMessage(userMsg)
  chat.profileId = profileId

  const assistantId = uid('m')
  const assistant: ChatMessage = {
    id: assistantId,
    chatId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    toolCalls: [],
  }
  appendMessage(assistant)

  const plan = planReply(content)
  let lastToolId = ''

  for (const event of plan) {
    if (signal?.aborted) {
      yield { type: 'error', message: 'aborted' }
      return
    }
    if (event.type === 'text-delta') {
      for (const chunk of chunkText(event.text, 4)) {
        if (signal?.aborted) {
          yield { type: 'error', message: 'aborted' }
          return
        }
        assistant.content += chunk
        await sleep(14)
        yield { type: 'text-delta', text: chunk }
      }
      continue
    }
    if (event.type === 'tool-call') {
      lastToolId = event.id
      const call = {
        id: event.id,
        name: event.name,
        arguments: JSON.stringify(event.arguments),
        status: 'running' as const,
      }
      assistant.toolCalls = [...(assistant.toolCalls ?? []), call]
      await sleep(280)
      yield event
      continue
    }
    if (event.type === 'tool-result') {
      const id = lastToolId
      const call = assistant.toolCalls?.find((t) => t.id === id)
      if (call) {
        call.status = event.status
        call.result = event.result
      }
      await sleep(420)
      yield { ...event, id }
      continue
    }
    await sleep(40)
    yield event
  }

  yield { type: 'done' }
}
