import { z } from "zod";
import { idSchema } from "./agent";

export const AGENT_MESSAGE_STATUSES = ["pending", "delivered", "read", "failed"] as const;
export type AgentMessageStatus = (typeof AGENT_MESSAGE_STATUSES)[number];

export const sendAgentMessageSchema = z
  .object({
    fromAgentId: idSchema,
    toAgentId: idSchema.optional(),
    toAgentName: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(32_000),
    fromChatId: idSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.toAgentId || value.toAgentName), {
    message: "toAgentId or toAgentName is required",
  });

export type SendAgentMessageInput = z.infer<typeof sendAgentMessageSchema>;

export interface AgentMessageRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  fromChatId?: string;
  body: string;
  status: AgentMessageStatus;
  error?: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
}

export interface NewAgentMessage {
  id?: string;
  fromAgentId: string;
  toAgentId: string;
  fromChatId?: string;
  body: string;
}

/** How many delivered inbox rows are copied into a single turn. */
export const INBOX_INJECT_LIMIT = 50;
