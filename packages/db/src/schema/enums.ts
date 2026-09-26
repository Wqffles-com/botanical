import { pgEnum } from 'drizzle-orm/pg-core';

export const messageRoleEnum = pgEnum('message_role', ['system', 'user', 'assistant', 'tool']);

export const a2aStatusEnum = pgEnum('a2a_status', ['pending', 'delivered', 'read', 'failed']);

/** Picker swatches. Keep in lockstep with `AGENT_COLORS` in packages/core. */
export const agentColorEnum = pgEnum('agent_color', [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
  'pink',
  'gray',
]);

export type MessageRole = (typeof messageRoleEnum.enumValues)[number];
export type AgentMessageStatus = (typeof a2aStatusEnum.enumValues)[number];
export type AgentColor = (typeof agentColorEnum.enumValues)[number];
