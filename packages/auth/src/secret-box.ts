/**
 * Field encryption for TOTP secrets (ADR-0007 envelope pattern, ADR-0010 section 5).
 *
 * INTERIM until packages/crypto (slice S6) provides the KeyProvider port: a per-tenant
 * data key is derived with HKDF-SHA256 from a development root key and the
 * organization id, and the value is sealed with AES-256-GCM, bound to the organization
 * and purpose as additional authenticated data. Node's crypto only; no custom crypto.
 * The API refuses to start with a development root key when DH_ENV=production.
 *
 * Layout: 0x01 | iv (12 bytes) | tag (16 bytes) | ciphertext.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 1;

export interface SecretBoxKey {
  /** At least 32 bytes of key material. */
  root: Buffer;
}

function dataKey(key: SecretBoxKey, organizationId: string, purpose: string): Buffer {
  if (key.root.length < 32) throw new Error('secret-box root key must be at least 32 bytes');
  return Buffer.from(
    hkdfSync('sha256', key.root, Buffer.from(organizationId), `dh:${purpose}:v${VERSION}`, 32),
  );
}

export function seal(
  key: SecretBoxKey,
  organizationId: string,
  purpose: string,
  plaintext: Buffer,
): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(key, organizationId, purpose), iv);
  cipher.setAAD(Buffer.from(`${organizationId}|${purpose}`));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function open(
  key: SecretBoxKey,
  organizationId: string,
  purpose: string,
  sealed: Buffer,
): Buffer {
  if (sealed.length < 1 + 12 + 16 || sealed[0] !== VERSION) {
    throw new Error('secret-box: unsupported envelope');
  }
  const iv = sealed.subarray(1, 13);
  const tag = sealed.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', dataKey(key, organizationId, purpose), iv);
  decipher.setAAD(Buffer.from(`${organizationId}|${purpose}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]);
}
