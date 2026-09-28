import type { SignupMode } from './constants.ts';

export type UserRole = 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

export interface InviteRecord {
  id: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

export interface AccountRepository {
  signupMode(): Promise<SignupMode>;
  setSignupMode(mode: SignupMode): Promise<void>;
  allowGlobalKeys(): Promise<boolean>;
  setAllowGlobalKeys(allowed: boolean): Promise<void>;
  countActive(): Promise<number>;
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  /** Bootstrap row with no password, when no real account exists yet. */
  unclaimedOwner(): Promise<{ id: string } | null>;
  claimOwner(id: string, input: { email: string; passwordHash: string; displayName: string }): Promise<AuthUser>;
  insertUser(input: { email: string; passwordHash: string; displayName: string; role: UserRole }): Promise<AuthUser>;
  createInvite(input: { createdBy: string; tokenHash: string; expiresAt: string }): Promise<InviteRecord>;
  listInvites(): Promise<InviteRecord[]>;
  deleteInvite(id: string): Promise<boolean>;
  /** True when the token matches an unused, unexpired invite. */
  inviteValid(tokenHash: string, now: Date): Promise<boolean>;
  /** Mark an unused, unexpired invite consumed. False when it cannot be used. */
  takeInvite(tokenHash: string, userId: string, now: Date): Promise<boolean>;
  /** Move pre-account rows onto the first real user. Postgres claims the row instead. */
  adoptLegacyData(userId: string): Promise<void>;
  bootstrapUserId(): Promise<string>;
}

export interface SecretMeta {
  name: string;
  last4: string;
  updatedAt: string;
}

export interface SecretRepository {
  listGlobal(): Promise<SecretMeta[]>;
  listUser(userId: string): Promise<SecretMeta[]>;
  putGlobal(name: string, plaintext: string): Promise<SecretMeta>;
  putUser(userId: string, name: string, plaintext: string): Promise<SecretMeta>;
  deleteGlobal(name: string): Promise<boolean>;
  deleteUser(userId: string, name: string): Promise<boolean>;
  revealGlobal(name: string): Promise<string | null>;
  revealUser(userId: string, name: string): Promise<string | null>;
  hasGlobal(name: string): Promise<boolean>;
}

export interface PrefsRepository {
  getGlobal(key: string): Promise<unknown>;
  setGlobal(key: string, value: unknown): Promise<void>;
  getUser(userId: string, key: string): Promise<unknown>;
  setUser(userId: string, key: string, value: unknown): Promise<void>;
  deleteUser(userId: string, key: string): Promise<void>;
  globalByPrefix(prefix: string): Promise<Record<string, unknown>>;
  userByPrefix(userId: string, prefix: string): Promise<Record<string, unknown>>;
}
