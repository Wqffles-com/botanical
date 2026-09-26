import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { StoredRolePermissions } from '../types.ts';
import { agents } from './agents.ts';

/**
 * Named permission sets. Builtin rows (Coder, Reviewer, Orchestrator) are seeded
 * by migration 0003 and cannot be deleted. Names are unique.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    permissions: jsonb('permissions').$type<StoredRolePermissions>().notNull(),
    builtin: boolean('builtin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('roles_name_uidx').on(t.name),
    check('roles_name_not_blank', sql`char_length(btrim(${t.name})) > 0`),
    check('roles_name_length', sql`char_length(btrim(${t.name})) between 1 and 80`),
    check('roles_permissions_object', sql`jsonb_typeof(${t.permissions}) = 'object'`),
  ],
);

export const agentRoles = pgTable(
  'agent_roles',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.roleId] }),
    index('agent_roles_role_id_idx').on(t.roleId),
  ],
);
