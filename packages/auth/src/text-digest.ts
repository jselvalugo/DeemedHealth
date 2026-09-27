/**
 * Keyed digests of free text that must stay out of the audit log (ADR-0008 section 5).
 *
 * Reasons and comments are logged as their length and an HMAC-SHA256 under a key
 * derived for each tenant from the root secret (HKDF-SHA256, salt = the organization
 * id, info = `dh:audit-text:v1`). An unsalted SHA-256 of a short reason can be tested
 * against guessed texts by anyone who reads the log; this digest cannot without the
 * key, and the same text in two tenants gives unrelated digests. Someone holding the
 * key (an investigation) can still recompute a digest to confirm a known text.
 */
import { createHmac, hkdfSync } from 'node:crypto';

/** Stored next to each digest, so a later key scheme can be told apart. */
export const TEXT_DIGEST_KEY_ID = 'tenant-hkdf-v1';

export function textDigestKey(root: Buffer, organizationId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', root, Buffer.from(organizationId, 'utf8'), 'dh:audit-text:v1', 32),
  );
}

/** Hex HMAC-SHA256 of the text's UTF-8 bytes. */
export function textDigest(key: Buffer, text: string): string {
  return createHmac('sha256', key).update(text, 'utf8').digest('hex');
}
