/**
 * The demo's change journal: the viewer's own successful changes, replayed over the
 * seed on every request. Stored in an HttpOnly cookie (per browser, so reviewers never
 * see each other's changes, and a serverless cold start loses nothing). Every entry is
 * re-validated and re-run through the engine on replay, so a tampered cookie can do no
 * more than the viewer could do through the UI.
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

const Entry = z.object({
  /** The operation. */
  o: DemoOpSchema,
  /** When it happened (ISO). */
  a: z.string().max(40),
  /** Demo user id. */
  u: z.string().max(40),
  /** Ids it generated. */
  i: z.array(Id).max(501),
});
export type JournalEntry = z.infer<typeof Entry>;

/** Cookies are capped near 4 KB; the oldest changes drop first. */
export const JOURNAL_MAX_BYTES = 3600;
export const JOURNAL_COOKIE = 'dh_demo_records';

export function encodeJournal(entries: readonly JournalEntry[]): string {
  let list = [...entries];
  for (;;) {
    const text = Buffer.from(JSON.stringify(list), 'utf8').toString('base64url');
    if (text.length <= JOURNAL_MAX_BYTES || list.length === 0) return text;
    list = list.slice(1);
  }
}

export function decodeJournal(text: string | undefined): JournalEntry[] {
  if (!text || text.length > JOURNAL_MAX_BYTES * 2) return [];
  try {
    const parsed = z
      .array(Entry)
      .max(200)
      .safeParse(JSON.parse(Buffer.from(text, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function isMutating(op: DemoOp): boolean {
  return MUTATING_OPS.includes(op.op);
}

/** The seed with the journal replayed (entries that no longer apply are skipped). */
export function buildStore(
  entries: readonly JournalEntry[],
  viewerFor: (id: string) => DemoViewer | undefined,
): DemoStore {
  const store = seedStore();
  for (const e of entries) {
    const viewer = viewerFor(e.u);
    if (!viewer || !isMutating(e.o)) continue;
    // A recorded reveal already passed step-up; replay only restores its history event.
    runOp(store, e.o, { viewer, now: e.a, ids: e.i, stepUpAt: Date.parse(e.a) });
  }
  return store;
}
