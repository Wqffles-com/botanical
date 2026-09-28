import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { AccountRepository, AuthUser, InviteRecord, PrefsRepository, SecretMeta, SecretRepository, UserRole } from './account-types.ts';
import type { BotanicalDb } from './client.ts';
import { SETTING_KEYS, SIGNUP_MODES, type SignupMode } from './constants.ts';
import { decryptSecret, encryptSecret, EncryptionKeyMissing, last4 } from './crypto.ts';
import { invites } from './schema/invites.ts';
import { secrets } from './schema/secrets.ts';
import { settings } from './schema/settings.ts';
import { userSettings } from './schema/user-settings.ts';
import { users } from './schema/users.ts';

const SECRET_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

function iso(value: Date): string {
  return value.toISOString();
}

function asRole(value: string): UserRole {
  return value === 'admin' ? 'admin' : 'member';
}

function toAuth(row: { id: string; email: string | null; displayName: string; role: string; createdAt: Date }): AuthUser {
  return {
    id: row.id,
    email: row.email ?? '',
    displayName: row.displayName,
    role: asRole(row.role),
    createdAt: iso(row.createdAt),
  };
}

function assertSecretName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (!SECRET_NAME.test(trimmed)) throw new Error('Invalid secret name');
  return trimmed;
}

export function createAccountServices(
  db: BotanicalDb,
  options: { encryptionKey?: string; legacyUserId: string; adoptLegacy?: (userId: string) => Promise<void> },
): { accounts: AccountRepository; secrets: SecretRepository; prefs: PrefsRepository } {
  const key = options.encryptionKey?.trim() ?? '';

  async function readSetting(settingKey: string): Promise<unknown> {
    const rows = await db.select().from(settings).where(eq(settings.key, settingKey)).limit(1);
    return rows[0]?.value;
  }

  async function writeSetting(settingKey: string, value: unknown): Promise<void> {
    await db
      .insert(settings)
      .values({ key: settingKey, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }

  function requireKey(): string {
    if (!key) throw new EncryptionKeyMissing();
    return key;
  }

  async function reveal(userId: string | null, name: string): Promise<string | null> {
    const trimmed = assertSecretName(name);
    const rows = await db
      .select()
      .from(secrets)
      .where(and(userId ? eq(secrets.userId, userId) : isNull(secrets.userId), eq(secrets.name, trimmed)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return decryptSecret(row.ciphertext, requireKey());
  }

  async function put(userId: string | null, name: string, plaintext: string): Promise<SecretMeta> {
    const trimmed = assertSecretName(name);
    const value = plaintext.trim();
    if (!value) throw new Error('Secret is empty');
    if (value.length > 8_000) throw new Error('Secret is too long');
    const ciphertext = encryptSecret(value, requireKey());
    const hint = last4(value);
    const now = new Date();
    const existing = await db
      .select({ id: secrets.id })
      .from(secrets)
      .where(and(userId ? eq(secrets.userId, userId) : isNull(secrets.userId), eq(secrets.name, trimmed)))
      .limit(1);
    if (existing[0]) {
      await db.update(secrets).set({ ciphertext, last4: hint, updatedAt: now }).where(eq(secrets.id, existing[0].id));
    } else {
      await db.insert(secrets).values({ userId, name: trimmed, ciphertext, last4: hint, updatedAt: now });
    }
    return { name: trimmed, last4: hint, updatedAt: now.toISOString() };
  }

  const accounts: AccountRepository = {
    async signupMode() {
      const value = await readSetting(SETTING_KEYS.signupMode);
      return SIGNUP_MODES.includes(value as SignupMode) ? (value as SignupMode) : 'open';
    },
    async setSignupMode(mode) {
      if (!SIGNUP_MODES.includes(mode)) throw new Error('Invalid signup mode');
      await writeSetting(SETTING_KEYS.signupMode, mode);
    },
    async allowGlobalKeys() {
      const value = await readSetting(SETTING_KEYS.allowGlobalKeys);
      return value === false ? false : true;
    },
    async setAllowGlobalKeys(allowed) {
      await writeSetting(SETTING_KEYS.allowGlobalKeys, allowed);
    },
    async countActive() {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.passwordHash} is not null`);
      return rows.length;
    },
    async findByEmail(email) {
      const normalized = email.trim().toLowerCase();
      const rows = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${normalized}`)
        .limit(1);
      const row = rows[0];
      if (!row?.passwordHash || !row.email) return null;
      return { ...toAuth(row), passwordHash: row.passwordHash };
    },
    async findById(id) {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const row = rows[0];
      if (!row?.passwordHash) return null;
      return toAuth(row);
    },
    async unclaimedOwner() {
      const active = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.passwordHash} is not null`)
        .limit(1);
      if (active[0]) return null;
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(isNull(users.passwordHash))
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(1);
      return rows[0] ?? null;
    },
    async claimOwner(id, input) {
      const updated = await db
        .update(users)
        .set({
          email: input.email.trim().toLowerCase(),
          passwordHash: input.passwordHash,
          displayName: input.displayName.trim(),
          role: 'admin',
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, id), isNull(users.passwordHash)))
        .returning();
      const row = updated[0];
      if (!row) throw new Error('Owner was already claimed');
      return toAuth(row);
    },
    async insertUser(input) {
      const inserted = await db
        .insert(users)
        .values({
          email: input.email.trim().toLowerCase(),
          passwordHash: input.passwordHash,
          displayName: input.displayName.trim(),
          role: input.role,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('Failed to create user');
      return toAuth(row);
    },
    async createInvite(input) {
      const inserted = await db
        .insert(invites)
        .values({
          tokenHash: input.tokenHash,
          createdBy: input.createdBy,
          expiresAt: new Date(input.expiresAt),
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('Failed to create invite');
      return toInvite(row);
    },
    async listInvites() {
      const rows = await db.select().from(invites).orderBy(asc(invites.createdAt));
      return rows.map(toInvite);
    },
    async deleteInvite(id) {
      const removed = await db.delete(invites).where(eq(invites.id, id)).returning({ id: invites.id });
      return removed.length > 0;
    },
    async inviteValid(tokenHash, now) {
      const rows = await db
        .select({ id: invites.id })
        .from(invites)
        .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), sql`${invites.expiresAt} > ${now}`))
        .limit(1);
      return Boolean(rows[0]);
    },
    async takeInvite(tokenHash, userId, now) {
      const updated = await db
        .update(invites)
        .set({ usedAt: now, usedBy: userId })
        .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.usedAt), sql`${invites.expiresAt} > ${now}`))
        .returning({ id: invites.id });
      return updated.length > 0;
    },
    async adoptLegacyData(userId) {
      await options.adoptLegacy?.(userId);
    },
    async bootstrapUserId() {
      return options.legacyUserId;
    },
  };

  const secretRepo: SecretRepository = {
    async listGlobal() {
      const rows = await db.select().from(secrets).where(isNull(secrets.userId)).orderBy(asc(secrets.name));
      return rows.map(toSecret);
    },
    async listUser(userId) {
      const rows = await db.select().from(secrets).where(eq(secrets.userId, userId)).orderBy(asc(secrets.name));
      return rows.map(toSecret);
    },
    putGlobal(name, plaintext) {
      return put(null, name, plaintext);
    },
    putUser(userId, name, plaintext) {
      return put(userId, name, plaintext);
    },
    async deleteGlobal(name) {
      const removed = await db
        .delete(secrets)
        .where(and(isNull(secrets.userId), eq(secrets.name, assertSecretName(name))))
        .returning({ id: secrets.id });
      return removed.length > 0;
    },
    async deleteUser(userId, name) {
      const removed = await db
        .delete(secrets)
        .where(and(eq(secrets.userId, userId), eq(secrets.name, assertSecretName(name))))
        .returning({ id: secrets.id });
      return removed.length > 0;
    },
    revealGlobal(name) {
      return reveal(null, name);
    },
    revealUser(userId, name) {
      return reveal(userId, name);
    },
    async hasGlobal(name) {
      const rows = await db
        .select({ id: secrets.id })
        .from(secrets)
        .where(and(isNull(secrets.userId), eq(secrets.name, assertSecretName(name))))
        .limit(1);
      return Boolean(rows[0]);
    },
  };

  const prefs: PrefsRepository = {
    getGlobal: readSetting,
    setGlobal: writeSetting,
    async getUser(userId, key) {
      const rows = await db
        .select()
        .from(userSettings)
        .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
        .limit(1);
      return rows[0]?.value;
    },
    async setUser(userId, key, value) {
      await db
        .insert(userSettings)
        .values({ userId, key, value })
        .onConflictDoUpdate({
          target: [userSettings.userId, userSettings.key],
          set: { value, updatedAt: new Date() },
        });
    },
    async deleteUser(userId, key) {
      await db.delete(userSettings).where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)));
    },
    async globalByPrefix(prefix) {
      const rows = await db.select().from(settings).where(sql`${settings.key} like ${`${prefix}%`}`);
      const out: Record<string, unknown> = {};
      for (const row of rows) out[row.key] = row.value;
      return out;
    },
    async userByPrefix(userId, prefix) {
      const rows = await db
        .select()
        .from(userSettings)
        .where(and(eq(userSettings.userId, userId), sql`${userSettings.key} like ${`${prefix}%`}`));
      const out: Record<string, unknown> = {};
      for (const row of rows) out[row.key] = row.value;
      return out;
    },
  };

  return { accounts, secrets: secretRepo, prefs };
}

function toInvite(row: typeof invites.$inferSelect): InviteRecord {
  return {
    id: row.id,
    createdBy: row.createdBy,
    expiresAt: iso(row.expiresAt),
    usedAt: row.usedAt ? iso(row.usedAt) : null,
    usedBy: row.usedBy,
    createdAt: iso(row.createdAt),
  };
}

function toSecret(row: { name: string; last4: string; updatedAt: Date }): SecretMeta {
  return { name: row.name, last4: row.last4, updatedAt: iso(row.updatedAt) };
}
