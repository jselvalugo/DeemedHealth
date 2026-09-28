'use server';

/**
 * Server actions behind the synthetic records demo (NON-PRODUCTION ONLY, ADR-0009).
 * The same guards as the demo sign-in (auth-stub.ts): nothing answers unless DH_ENV is
 * a known non-production environment AND there is no database (authMode() === 'stub');
 * then `assertDemoAllowed()` throws in production as a second line. The viewer is the
 * signed-in demo user; every input is re-validated; access is decided by the domain
 * policy engine inside the engine, never by the page.
 *
 * Both demo cookies are signed and bound to the demo user id (lib/records-demo/signing.ts):
 * the change journal, and the step-up (`<userId>:<epoch ms>`), so neither can be forged
 * or carried over to another user. Sign-in and sign-out clear them (auth-stub.ts).
 */
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { isProduction } from '@deemed/domain';
import type { RecordsResult } from '@deemed/ui';
import { assertDemoAllowed, checkDemoTotp, findDemoUserById } from '../../lib/auth-demo';
import { authMode } from '../../lib/auth-mode';
import { runOp, STEP_UP_MS, type DemoViewer } from '../../lib/records-demo/engine';
import {
  DemoOpSchema,
  JOURNAL_COOKIE,
  buildStore,
  decodeJournal,
  encodeJournal,
  isMutating,
  toJournalOp,
} from '../../lib/records-demo/journal';
import { signValue, verifyValue } from '../../lib/records-demo/signing';
import { DEMO_STEP_UP_COOKIE, SESSION_COOKIE, cookieOptions } from '../../lib/session-cookies';

const STEP_UP_PURPOSE = 'records-step-up';
const NOT_CONFIGURED = { ok: false as const, status: 503, code: 'not_configured' as const };

function demoEnabled(): boolean {
  if (isProduction(process.env.DH_ENV) || authMode() !== 'stub') return false;
  assertDemoAllowed();
  return true;
}

function viewerFor(id: string | undefined): DemoViewer | undefined {
  const user = findDemoUserById(id);
  return user && !user.locked ? { id: user.id, name: user.name, roles: user.roles } : undefined;
}

/** When this user last confirmed it's them, from the signed step-up cookie; else null. */
function stepUpAt(value: string | undefined, userId: string): number | null {
  const payload = verifyValue(STEP_UP_PURPOSE, userId, value);
  if (payload === null) return null;
  const sep = payload.indexOf(':');
  if (sep < 0 || payload.slice(0, sep) !== userId) return null;
  const ts = Number(payload.slice(sep + 1));
  return Number.isSafeInteger(ts) ? ts : null;
}

/** One records operation against the demo store (list, get, create, …). */
export async function demoRecords(input: unknown): Promise<RecordsResult<unknown>> {
  if (!demoEnabled()) return NOT_CONFIGURED;
  const jar = await cookies();
  const viewer = viewerFor(jar.get(SESSION_COOKIE)?.value);
  if (!viewer) return { ok: false, status: 401, code: 'unauthenticated' };
  const parsed = DemoOpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, code: 'bad_request' };
  const op = parsed.data;

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const journal = decodeJournal(jar.get(JOURNAL_COOKIE)?.value, viewer.id);
  // A tampered or foreign journal is dropped, never partly trusted.
  if (journal.tampered) jar.delete(JOURNAL_COOKIE);
  const store = buildStore(journal.entries, viewer, nowMs);
  const ids = Array.from({ length: op.op === 'bulk' ? 502 : 2 }, () => randomUUID());
  const result = runOp(store, op, {
    viewer,
    now,
    ids,
    stepUpAt: stepUpAt(jar.get(DEMO_STEP_UP_COOKIE)?.value, viewer.id),
  });
  if (result.ok && isMutating(op)) {
    // Keep only the ids the operation can use (bulk: one per item plus the bulk id).
    const used = op.op === 'bulk' ? ids.slice(0, 1 + bulkCount(op.body)) : ids;
    jar.set(
      JOURNAL_COOKIE,
      encodeJournal([...journal.entries, { o: toJournalOp(op), a: now, i: used }], viewer.id),
      cookieOptions(12 * 60 * 60),
    );
  }
  return result;
}

function bulkCount(body: unknown): number {
  const items = (body as { items?: unknown })?.items;
  return Array.isArray(items) ? Math.min(items.length, 500) : 0;
}

type StepUpResult =
  | { ok: true; data: null }
  | { ok: false; status: number; code: 'invalid_code' | 'not_configured' | 'unauthenticated' };

async function confirmStepUp(): Promise<StepUpResult> {
  const jar = await cookies();
  const viewer = viewerFor(jar.get(SESSION_COOKIE)?.value);
  if (!viewer) return { ok: false, status: 401, code: 'unauthenticated' };
  jar.set(
    DEMO_STEP_UP_COOKIE,
    signValue(STEP_UP_PURPOSE, viewer.id, `${viewer.id}:${Date.now()}`),
    cookieOptions(STEP_UP_MS / 1000),
  );
  return { ok: true, data: null };
}

/** Demo step-up with the demo authenticator code (000000). */
export async function demoStepUpTotp(code: string): Promise<StepUpResult> {
  if (!demoEnabled()) return NOT_CONFIGURED;
  if (typeof code !== 'string' || !checkDemoTotp(code.trim())) {
    return { ok: false, status: 401, code: 'invalid_code' };
  }
  return confirmStepUp();
}

/**
 * DEMO ONLY: a simulated passkey step-up that always succeeds for the signed-in demo
 * user, like the demo sign-in's passkey (auth-stub.ts verifyPasskey). There is no
 * WebAuthn ceremony and no challenge here; it is unreachable outside the stub mode
 * (demoEnabled). The real step-up is apps/api /api/auth/reauth/passkey/* (ADR-0006).
 */
export async function demoStepUpPasskey(): Promise<StepUpResult> {
  if (!demoEnabled()) return NOT_CONFIGURED;
  return confirmStepUp();
}
