/**
 * Opaque, signed cursors (ADR-0014 section 2.1). A cursor carries only a position (a
 * record id for lists, a chain sequence for history), never field values, so no personal
 * data travels in URLs (section 4.5). It is bound by a keyed HMAC (the tenant's text
 * digest key, domain-separated) to the record type, the query's shape, and the viewer:
 * a cursor from another query, type, user, or tenant is refused.
 */
import { safeEqual } from '@deemed/auth';
import type { Helpers } from '../context.js';
import { ApiError } from '../errors.js';

function mac(h: Helpers, kind: string, typeId: string, fingerprint: string, body: string): string {
  const s = h.session();
  return h.services.auth.textDigest(
    s.organizationId,
    ['records-cursor:v1', kind, typeId, s.userAccountId, fingerprint, body].join('\n'),
  );
}

export function signCursor(
  h: Helpers,
  kind: 'list' | 'history',
  typeId: string,
  fingerprint: string,
  position: string,
): string {
  const body = Buffer.from(position, 'utf8').toString('base64url');
  return `${body}.${mac(h, kind, typeId, fingerprint, body)}`;
}

/** The position in a valid cursor; 400 for anything else. */
export function verifyCursor(
  h: Helpers,
  kind: 'list' | 'history',
  typeId: string,
  fingerprint: string,
  cursor: string,
): string {
  const dot = cursor.indexOf('.');
  if (dot <= 0 || cursor.indexOf('.', dot + 1) >= 0) throw new ApiError('bad_request', ['cursor']);
  const body = cursor.slice(0, dot);
  if (!safeEqual(cursor.slice(dot + 1), mac(h, kind, typeId, fingerprint, body))) {
    throw new ApiError('bad_request', ['cursor']);
  }
  return Buffer.from(body, 'base64url').toString('utf8');
}
