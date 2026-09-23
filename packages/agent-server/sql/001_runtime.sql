-- Botanical agent runtime schema (v0).
-- Safe to re-run. packages/db may own the canonical migration history;
-- this file is the contract the runtime's Postgres store expects.
--
-- Domain → column:
--   agents.toolAllowlist        → agents.tools (jsonb array of allowlist patterns)
--   agents.prompt               → agents.prompt
--   agent_messages.fromAgentId  → agent_messages.from_agent
--   agent_messages.toAgentId    → agent_messages.to_agent
--
-- Status `failed` is reserved. The v0 delivery worker only moves pending → delivered.
-- There is no default model profile column: profile_id is recorded per message.

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  a2a_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents (id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chats_agent_idx ON chats (agent_id);

COMMENT ON COLUMN chats.agent_id IS 'Owning agent. Immutable for the life of the chat (one agent per chat).';

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  tool_calls JSONB,
  tool_call_id TEXT,
  name TEXT,
  profile_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGINT GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX IF NOT EXISTS messages_chat_seq_idx ON messages (chat_id, seq);

COMMENT ON COLUMN messages.profile_id IS 'Explicit model profile for this turn. The server never invents a default.';

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  to_agent TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  from_chat_id TEXT REFERENCES chats (id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'read', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  seq BIGINT GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX IF NOT EXISTS agent_messages_inbox_idx ON agent_messages (to_agent, status, seq);
