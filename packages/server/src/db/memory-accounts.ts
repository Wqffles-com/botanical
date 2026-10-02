import { randomUUID } from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  EncryptionKeyMissing,
  last4,
  SETTING_KEYS,
  SIGNUP_MODES,
  type AccountRepository,
  type AuthUser,
  type InviteRecord,
  type PrefsRepository,
  type SecretMeta,
  type SecretRepository,
  type SignupMode,
  type UserRole,
} from "@botanical/db";

const SECRET_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash: string | null;
  createdAt: string;
  disabledAt: string | null;
}

interface InviteRow {
  id: string;
  tokenHash: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

interface SecretRow {
  name: string;
  userId: string | null;
  ciphertext: string;
  last4: string;
  updatedAt: string;
}

export function createMemoryAccounts(options: {
  encryptionKey?: string;
  now: () => string;
  adoptLegacy: (userId: string) => void;
  /** Remove the agents, chats, and other rows the store holds for a user. */
  purgeUser: (userId: string) => Promise<void>;
  legacyUserId: string;
}): { accounts: AccountRepository; secrets: SecretRepository; prefs: PrefsRepository } {
  const users: UserRow[] = [];
  const invites: InviteRow[] = [];
  const resets: { userId: string; createdBy: string; tokenHash: string; expiresAt: string; usedAt: string | null }[] = [];
  const secretRows: SecretRow[] = [];
  const globalPrefs = new Map<string, unknown>([
    [SETTING_KEYS.signupMode, "open"],
    [SETTING_KEYS.allowGlobalKeys, true],
  ]);
  const userPrefs = new Map<string, unknown>();
  const key = options.encryptionKey?.trim() ?? "";

  function stamp(): string {
    return options.now();
  }

  function toAuth(row: UserRow): AuthUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt,
      disabledAt: row.disabledAt,
    };
  }

  function requireKey(): string {
    if (!key) throw new EncryptionKeyMissing();
    return key;
  }

  function assertName(name: string): string {
    const trimmed = name.trim().toLowerCase();
    if (!SECRET_NAME.test(trimmed)) throw new Error("Invalid secret name");
    return trimmed;
  }

  function findSecret(userId: string | null, name: string): SecretRow | undefined {
    return secretRows.find((row) => row.userId === userId && row.name === name);
  }

  function put(userId: string | null, name: string, plaintext: string): SecretMeta {
    const trimmed = assertName(name);
    const value = plaintext.trim();
    if (!value) throw new Error("Secret is empty");
    const ciphertext = encryptSecret(value, requireKey());
    const hint = last4(value);
    const updatedAt = stamp();
    const existing = findSecret(userId, trimmed);
    if (existing) {
      existing.ciphertext = ciphertext;
      existing.last4 = hint;
      existing.updatedAt = updatedAt;
    } else {
      secretRows.push({ name: trimmed, userId, ciphertext, last4: hint, updatedAt });
    }
    return { name: trimmed, last4: hint, updatedAt };
  }

  const accounts: AccountRepository = {
    async signupMode() {
      const value = globalPrefs.get(SETTING_KEYS.signupMode);
      return SIGNUP_MODES.includes(value as SignupMode) ? (value as SignupMode) : "open";
    },
    async setSignupMode(mode) {
      if (!SIGNUP_MODES.includes(mode)) throw new Error("Invalid signup mode");
      globalPrefs.set(SETTING_KEYS.signupMode, mode);
    },
    async allowGlobalKeys() {
      return globalPrefs.get(SETTING_KEYS.allowGlobalKeys) !== false;
    },
    async setAllowGlobalKeys(allowed) {
      globalPrefs.set(SETTING_KEYS.allowGlobalKeys, allowed);
    },
    async countActive() {
      return users.filter((row) => row.passwordHash).length;
    },
    async findByEmail(email) {
      const normalized = email.trim().toLowerCase();
      const row = users.find((item) => item.email === normalized && item.passwordHash);
      if (!row?.passwordHash) return null;
      return { ...toAuth(row), passwordHash: row.passwordHash };
    },
    async findById(id) {
      const row = users.find((item) => item.id === id && item.passwordHash);
      return row ? toAuth(row) : null;
    },
    async unclaimedOwner() {
      if (users.some((row) => row.passwordHash)) return null;
      return null;
    },
    async claimOwner() {
      throw new Error("Memory store has no bootstrap owner row");
    },
    async insertUser(input) {
      const email = input.email.trim().toLowerCase();
      if (users.some((row) => row.email === email)) throw new Error("Email is already registered");
      const row: UserRow = {
        id: randomUUID(),
        email,
        displayName: input.displayName.trim(),
        role: input.role,
        passwordHash: input.passwordHash,
        createdAt: stamp(),
        disabledAt: null,
      };
      users.push(row);
      if (users.filter((item) => item.passwordHash).length === 1) options.adoptLegacy(row.id);
      return toAuth(row);
    },
    async createInvite(input) {
      const row: InviteRow = {
        id: randomUUID(),
        tokenHash: input.tokenHash,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt,
        usedAt: null,
        usedBy: null,
        createdAt: stamp(),
      };
      invites.push(row);
      return toInvite(row);
    },
    async listInvites() {
      return invites.map(toInvite);
    },
    async deleteInvite(id) {
      const index = invites.findIndex((row) => row.id === id);
      if (index < 0) return false;
      invites.splice(index, 1);
      return true;
    },
    async inviteValid(tokenHash, now) {
      const row = invites.find((item) => item.tokenHash === tokenHash && !item.usedAt);
      return Boolean(row && Date.parse(row.expiresAt) > now.getTime());
    },
    async takeInvite(tokenHash, userId, now) {
      const row = invites.find((item) => item.tokenHash === tokenHash && !item.usedAt);
      if (!row || Date.parse(row.expiresAt) <= now.getTime()) return false;
      row.usedAt = now.toISOString();
      row.usedBy = userId;
      return true;
    },
    async listUsers() {
      return users.filter((row) => row.passwordHash).map(toAuth);
    },
    async setDisabled(userId, disabled) {
      const row = users.find((item) => item.id === userId && item.passwordHash);
      if (!row) return null;
      row.disabledAt = disabled ? stamp() : null;
      return toAuth(row);
    },
    async setRole(userId, role) {
      const row = users.find((item) => item.id === userId && item.passwordHash);
      if (!row) return null;
      row.role = role;
      return toAuth(row);
    },
    async deleteUser(userId) {
      const index = users.findIndex((item) => item.id === userId);
      if (index < 0) return "missing";
      await options.purgeUser(userId);
      users.splice(index, 1);
      for (let i = invites.length - 1; i >= 0; i -= 1) if (invites[i]?.createdBy === userId) invites.splice(i, 1);
      for (let i = resets.length - 1; i >= 0; i -= 1) {
        if (resets[i]?.userId === userId || resets[i]?.createdBy === userId) resets.splice(i, 1);
      }
      for (let i = secretRows.length - 1; i >= 0; i -= 1) if (secretRows[i]?.userId === userId) secretRows.splice(i, 1);
      for (const keyName of [...userPrefs.keys()]) if (keyName.startsWith(`${userId}\0`)) userPrefs.delete(keyName);
      for (const invite of invites) if (invite.usedBy === userId) invite.usedBy = null;
      return "deleted";
    },
    async setPasswordHash(userId, passwordHash) {
      const row = users.find((item) => item.id === userId && item.passwordHash);
      if (!row) return false;
      row.passwordHash = passwordHash;
      return true;
    },
    async passwordHashOf(userId) {
      return users.find((item) => item.id === userId)?.passwordHash ?? null;
    },
    async createPasswordReset(input) {
      resets.push({ ...input, usedAt: null });
    },
    async takePasswordReset(tokenHash, now) {
      const row = resets.find((item) => item.tokenHash === tokenHash && !item.usedAt);
      if (!row || Date.parse(row.expiresAt) <= now.getTime()) return null;
      row.usedAt = now.toISOString();
      return row.userId;
    },
    async adoptLegacyData(userId) {
      options.adoptLegacy(userId);
    },
    bootstrapUserId() {
      return Promise.resolve(options.legacyUserId);
    },
  };

  const secretsRepo: SecretRepository = {
    async listGlobal() {
      return secretRows.filter((row) => row.userId === null).map(toSecret);
    },
    async listUser(userId) {
      return secretRows.filter((row) => row.userId === userId).map(toSecret);
    },
    async putGlobal(name, plaintext) {
      return put(null, name, plaintext);
    },
    async putUser(userId, name, plaintext) {
      return put(userId, name, plaintext);
    },
    async deleteGlobal(name) {
      return remove(null, assertName(name));
    },
    async deleteUser(userId, name) {
      return remove(userId, assertName(name));
    },
    async revealGlobal(name) {
      const row = findSecret(null, assertName(name));
      return row ? decryptSecret(row.ciphertext, requireKey()) : null;
    },
    async revealUser(userId, name) {
      const row = findSecret(userId, assertName(name));
      return row ? decryptSecret(row.ciphertext, requireKey()) : null;
    },
    async hasGlobal(name) {
      return Boolean(findSecret(null, assertName(name)));
    },
  };

  function remove(userId: string | null, name: string): boolean {
    const index = secretRows.findIndex((row) => row.userId === userId && row.name === name);
    if (index < 0) return false;
    secretRows.splice(index, 1);
    return true;
  }

  const prefs: PrefsRepository = {
    async getGlobal(keyName) {
      return globalPrefs.get(keyName);
    },
    async setGlobal(keyName, value) {
      globalPrefs.set(keyName, value);
    },
    async getUser(userId, keyName) {
      return userPrefs.get(`${userId}\0${keyName}`);
    },
    async setUser(userId, keyName, value) {
      userPrefs.set(`${userId}\0${keyName}`, value);
    },
    async deleteUser(userId, keyName) {
      userPrefs.delete(`${userId}\0${keyName}`);
    },
    async globalByPrefix(prefix) {
      const out: Record<string, unknown> = {};
      for (const [keyName, value] of globalPrefs) {
        if (keyName.startsWith(prefix)) out[keyName] = value;
      }
      return out;
    },
    async userByPrefix(userId, prefix) {
      const out: Record<string, unknown> = {};
      const head = `${userId}\0`;
      for (const [keyName, value] of userPrefs) {
        if (!keyName.startsWith(head)) continue;
        const bare = keyName.slice(head.length);
        if (bare.startsWith(prefix)) out[bare] = value;
      }
      return out;
    },
  };

  return { accounts, secrets: secretsRepo, prefs };
}

function toInvite(row: InviteRow): InviteRecord {
  return {
    id: row.id,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    usedBy: row.usedBy,
    createdAt: row.createdAt,
  };
}

function toSecret(row: SecretRow): SecretMeta {
  return { name: row.name, last4: row.last4, updatedAt: row.updatedAt };
}
