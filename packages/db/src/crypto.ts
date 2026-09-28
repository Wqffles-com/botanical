import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class EncryptionKeyMissing extends Error {
  constructor() {
    super('Set BOTANICAL_ENCRYPTION_KEY before storing secrets');
    this.name = 'EncryptionKeyMissing';
  }
}

/** 32-byte AES key from hex, standard base64, or the SHA-256 of any other string. */
export function encryptionKeyBytes(secret: string): Buffer {
  const trimmed = secret.trim();
  if (!trimmed) throw new EncryptionKeyMissing();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const b64 = Buffer.from(trimmed, 'base64');
  if (b64.length === 32 && b64.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
    return b64;
  }
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

/** AES-256-GCM. Format: `v1.` + base64(iv || tag || ciphertext). */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = encryptionKeyBytes(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, data]).toString('base64')}`;
}

export function decryptSecret(payload: string, secret: string): string {
  const key = encryptionKeyBytes(secret);
  if (!payload.startsWith('v1.')) throw new Error('Unknown secret encoding');
  const raw = Buffer.from(payload.slice(3), 'base64');
  if (raw.length < 12 + 16 + 1) throw new Error('Secret payload is truncated');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function last4(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.slice(-4);
}
