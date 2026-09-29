/**
 * The demo's change journal (NON-PRODUCTION ONLY): the viewer's own successful changes,
 * replayed over the seed on every request. It lives in an HttpOnly cookie, so reviewers
 * never see each other's changes and a serverless cold start loses nothing.
 *
 * The cookie is signed (HMAC-SHA256, demo-only key, see signing.ts) and bound to the
 * signed-in demo user id: a cookie edited by hand, copied from another user, or signed
 * by another server process fails verification and is dropped. Entries carry no user id;
 * they are always replayed as the current viewer, with the server times and server ids
 * recorded when they happened (validated again here), through the same engine checks.
 * Free text is not journaled beyond what the replay needs (`toJournalOp`).
 */
import { z } from 'zod';
import {
  MUTATING_OPS,
  runOp,
  seedStore,
  type DemoOp,
  type DemoStore,
  type DemoViewer,
} from './engine';
import { signValue, verifyValue } from './signing';

const Id = z.string().uuid();
const Type = z.string().min(1).max(64);
const Fields = z.record(z.unknown());

export const DemoOpSchema: z.ZodType<DemoOp> = z.discriminatedUnion('op', [
  z.object({ op: z.literal('list'), type: Type, query: z.record(z.string().max(512)) }).strict(),
  z.object({ op: z.literal('get'), type: Type, id: Id }).strict(),
  z.object({ op: z.literal('create'), type: Type, fields: Fields }).strict(),
  z
    .object({
      op: z.literal('update'),
      type: Type,
      id: Id,
      version: z.number().int(),
      fields: Fields,
    })
    .strict(),
  z
    .object({
      op: z.literal('archive'),
      type: Type,
      id: Id,
      version: z.number().int(),
      body: z.unknown(),
    })
    .strict(),
  z
    .object({
      op: z.literal('restore'),
      type: Type,
      id: Id,
      version: z.number().int(),
      body: z.unknown(),
    })
    .strict(),
  z.object({ op: z.literal('bulk'), type: Type, body: z.unknown() }).strict(),
  z
    .object({ op: z.literal('history'), type: Type, id: Id, cursor: z.string().max(64).nullable() })
    .strict(),
  z
    .object({
      op: z.literal('reveal'),
      type: Type,
      id: Id,
      field: z.string().max(64),
      body: z.unknown(),
    })
    .strict(),
  z.object({ op: z.literal('views.list'), type: Type }).strict(),
  z.object({ op: z.literal('views.create'), type: Type, body: z.unknown() }).strict(),
  z
    .object({
      op: z.literal('views.update'),
      type: Type,
      viewId: Id,
      version: z.number().int(),
      body: z.unknown(),
    })
    .strict(),
]) as unknown as z.ZodType<DemoOp>;

const Entry = z
  .object({
    /** The operation, with free text reduced (see `toJournalOp`). */
    o: DemoOpSchema,
    /** Server time when it happened (ISO, UTC). */
    a: z.string().datetime(),
    /** Ids it generated (fresh UUIDs from the server). */
    i: z.array(Id).max(501),
  })
  .strict();
export type JournalEntry = z.infer<typeof Entry>;

/** Cookies are capped near 4 KB; the oldest changes drop first. */
export const JOURNAL_MAX_BYTES = 3600;
export { DEMO_JOURNAL_COOKIE as JOURNAL_COOKIE } from '../session-cookies';
const PURPOSE = 'records-journal';

/** Seed rows use the fixture id prefix; journal ids may never collide with them. */
const SEED_ID_PREFIX = 'd0000001-';

/**
 * The journal cookie: base64url JSON, then an HMAC-SHA256 bound to the demo user id.
 * The oldest entries drop first to stay under the cookie cap.
 */
export function encodeJournal(entries: readonly JournalEntry[], userId: string): string {
  let list = [...entries];
  for (;;) {
    const payload = Buffer.from(JSON.stringify(list), 'utf8').toString('base64url');
    const value = signValue(PURPOSE, userId, payload);
    if (value.length <= JOURNAL_MAX_BYTES || list.length === 0) return value;
    list = list.slice(1);
  }
}

export type DecodedJournal = { entries: JournalEntry[]; tampered: boolean };

/**
 * The viewer's journal. Anything that is not a well-formed journal signed for this user
 * (another user's cookie, an edited one, a key from another process) is `tampered`: the
 * caller drops the cookie and the viewer starts again from the seed.
 */
export function decodeJournal(value: string | undefined, userId: string): DecodedJournal {
  if (!value) return { entries: [], tampered: false };
  if (value.length > JOURNAL_MAX_BYTES) return { entries: [], tampered: true };
  const payload = verifyValue(PURPOSE, userId, value);
  if (payload === null) return { entries: [], tampered: true };
  try {
    const parsed = z
      .array(Entry)
      .max(200)
      .safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    return parsed.success
      ? { entries: parsed.data, tampered: false }
      : { entries: [], tampered: true };
  } catch {
    return { entries: [], tampered: true };
  }
}

export function isMutating(op: DemoOp): boolean {
  return MUTATING_OPS.includes(op.op);
}

/** A stand-in with the same length: the engine checks a reason's presence and size only. */
function reasonStandIn(reason: unknown): string {
  const n = typeof reason === 'string' ? Math.min(Math.max([...reason.trim()].length, 1), 500) : 1;
  return '#'.repeat(n);
}

/**
 * The operation as journaled: no free text that the replay does not need (finding L4).
 * Reveals keep only the reason code; archive and restore reasons keep only their length.
 */
export function toJournalOp(op: DemoOp): DemoOp {
  const body = (op as { body?: unknown }).body as Record<string, unknown> | undefined;
  switch (op.op) {
    case 'reveal':
      return { ...op, body: { reasonCode: body?.reasonCode } };
    case 'archive':
      return { ...op, body: { reason: reasonStandIn(body?.reason) } };
    case 'restore':
      return { ...op, body: body?.reason ? { reason: reasonStandIn(body.reason) } : {} };
    case 'bulk':
      return body?.action === 'archive'
        ? { ...op, body: { ...body, reason: reasonStandIn(body.reason) } }
        : op;
    default:
      return op;
  }
}

/**
 * The seed with the viewer's journal replayed, as the viewer, in order. An entry is
 * skipped when its time is not a real past time or its ids are reused or seed ids;
 * entries that no longer apply fail in the engine and change nothing.
 */
export function buildStore(
  entries: readonly JournalEntry[],
  viewer: DemoViewer,
  now: number,
): DemoStore {
  const store = seedStore();
  const used = new Set<string>();
  let last = -Infinity;
  for (const e of entries) {
    if (!isMutating(e.o)) continue;
    const at = Date.parse(e.a);
    if (!Number.isFinite(at) || at > now + 60_000 || at < last) continue;
    if (e.i.some((id) => id.toLowerCase().startsWith(SEED_ID_PREFIX) || used.has(id))) continue;
    if (new Set(e.i).size !== e.i.length) continue;
    for (const id of e.i) used.add(id);
    last = at;
    // A journaled reveal already passed step-up; replay only restores its history event.
    runOp(store, e.o, { viewer, now: e.a, ids: e.i, stepUpAt: at });
  }
  return store;
}
