import { relations } from 'drizzle-orm';

import { agentMessages } from './agent-messages.ts';
import { agents } from './agents.ts';
import { chats } from './chats.ts';
import { messages } from './messages.ts';
import { modelProfiles } from './model-profiles.ts';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  agents: many(agents),
  chats: many(chats),
  profiles: many(modelProfiles),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  chats: many(chats),
  sentMessages: many(agentMessages, { relationName: 'agentMessageFrom' }),
  receivedMessages: many(agentMessages, { relationName: 'agentMessageTo' }),
}));

export const modelProfilesRelations = relations(modelProfiles, ({ one, many }) => ({
  user: one(users, { fields: [modelProfiles.userId], references: [users.id] }),
  chats: many(chats),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, { fields: [chats.userId], references: [users.id] }),
  agent: one(agents, { fields: [chats.agentId], references: [agents.id] }),
  profile: one(modelProfiles, { fields: [chats.profileId], references: [modelProfiles.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  profile: one(modelProfiles, { fields: [messages.profileId], references: [modelProfiles.id] }),
}));

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  from: one(agents, {
    fields: [agentMessages.fromAgent],
    references: [agents.id],
    relationName: 'agentMessageFrom',
  }),
  to: one(agents, {
    fields: [agentMessages.toAgent],
    references: [agents.id],
    relationName: 'agentMessageTo',
  }),
}));
