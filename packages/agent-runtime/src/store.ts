import type { AgentRecord, CreateAgentInput, UpdateAgentInput } from "./agent";
import type { AgentMessageRecord, AgentMessageStatus, NewAgentMessage } from "./a2a";
import type { ChatRecord } from "./chat";
import type { MessageRecord, NewMessage } from "./message";

export interface AgentRepository {
  get(id: string): Promise<AgentRecord | null>;
  /** First agent with this name, oldest first. Names are not unique. */
  getByName(name: string): Promise<AgentRecord | null>;
  list(limit?: number): Promise<AgentRecord[]>;
  create(input: CreateAgentInput): Promise<AgentRecord>;
  update(id: string, patch: UpdateAgentInput): Promise<AgentRecord>;
  delete(id: string): Promise<void>;
}

export interface ChatRepository {
  get(id: string): Promise<ChatRecord | null>;
  list(limit?: number): Promise<ChatRecord[]>;
  listByAgent(agentId: string): Promise<ChatRecord[]>;
  create(input: { id?: string; agentId: string; title?: string }): Promise<ChatRecord>;
  updateTitle(id: string, title: string): Promise<ChatRecord>;
  touch(id: string): Promise<void>;
}

export interface MessageRepository {
  listByChat(chatId: string): Promise<MessageRecord[]>;
  append(input: NewMessage): Promise<MessageRecord>;
}

export interface AgentMessageRepository {
  insert(input: NewAgentMessage): Promise<AgentMessageRecord>;
  get(id: string): Promise<AgentMessageRecord | null>;
  listForAgent(
    agentId: string,
    opts?: { status?: AgentMessageStatus[]; limit?: number; newestFirst?: boolean },
  ): Promise<AgentMessageRecord[]>;
  /**
   * Atomically move pending rows to delivered.
   * Postgres implementations must use SKIP LOCKED so overlapping workers don't double-deliver.
   */
  deliverPending(opts?: { limit?: number; toAgentId?: string }): Promise<AgentMessageRecord[]>;
  /** Transition delivered → read. Rows in any other status are left alone. */
  markRead(ids: readonly string[]): Promise<AgentMessageRecord[]>;
}

export interface Store {
  agents: AgentRepository;
  chats: ChatRepository;
  messages: MessageRepository;
  agentMessages: AgentMessageRepository;
}
