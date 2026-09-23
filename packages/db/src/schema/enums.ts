import { pgEnum } from 'drizzle-orm/pg-core';

export const messageRoleEnum = pgEnum('message_role', ['system', 'user', 'assistant', 'tool']);

export const a2aStatusEnum = pgEnum('a2a_status', ['pending', 'delivered', 'read', 'failed']);

export type MessageRole = (typeof messageRoleEnum.enumValues)[number];
export type AgentMessageStatus = (typeof a2aStatusEnum.enumValues)[number];
