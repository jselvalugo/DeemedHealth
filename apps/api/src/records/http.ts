/**
 * Request pieces shared by the record handlers and saved views: the call context, the
 * `If-Match` row version, and the tenant's keyed digest for free text.
 */
import { TEXT_DIGEST_KEY_ID } from '@deemed/auth';
import type { RecordTypeDef } from '@deemed/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TextDigest } from '../audit.js';
import type { Helpers } from '../context.js';
import { ApiError } from '../errors.js';
import type { RecordRouteMeta } from './manifest.js';

export interface RecordCall {
  req: FastifyRequest;
  reply: FastifyReply;
  h: Helpers;
  def: RecordTypeDef;
  meta: RecordRouteMeta;
}

/** Free text in audit events: length and an HMAC under the tenant's key (ADR-0008 section 5). */
export function digestOf(h: Helpers): TextDigest {
  const org = h.session().organizationId;
  return { digest: (text) => h.services.auth.textDigest(org, text), keyId: TEXT_DIGEST_KEY_ID };
}

/**
 * `If-Match: "<rowVersion>"`, required on every change (ADR-0014 section 2.3): 428 when
 * missing, 400 when malformed. Parsed with a loop.
 */
export function ifMatch(req: FastifyRequest): number {
  const raw = req.headers['if-match'];
  if (raw === undefined) throw new ApiError('precondition_required');
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.length < 3 || v.length > 12 || !v.startsWith('"') || !v.endsWith('"')) {
    throw new ApiError('bad_request', ['If-Match']);
  }
  const digits = v.slice(1, -1);
  for (let i = 0; i < digits.length; i++) {
    const c = digits.charCodeAt(i);
    if (c < 48 || c > 57) throw new ApiError('bad_request', ['If-Match']);
  }
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 1) throw new ApiError('bad_request', ['If-Match']);
  return n;
}

/** The API clock as ISO text: the instant site joins apply active-grant rules at. */
export function nowIso(h: Helpers): string {
  return h.now().toISOString();
}
