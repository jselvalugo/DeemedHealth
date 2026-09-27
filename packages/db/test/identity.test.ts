/**
 * Identity tables (migration 0004): database-level guarantees that do not depend on
 * packages/auth being bug free.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attempt,
  connect,
  describeDb,
  expectPgError,
  inRollback,
  need,
  setTenant,
} from './helpers.js';

describeDb('identity tables (ADR-0006)', () => {
  let user: pg.Client;
  let xyz: string;
  let ceo: string;
  let provider: string;

  beforeAll(async () => {
    const c = need();
    user = await connect(c.appUserUrl);
    xyz = c.tenants.xyz.organizationId;
    ceo = c.tenants.xyz.userIds.ceo as string;
    provider = c.tenants.xyz.userIds.provider1 as string;
  });
  afterAll(async () => {
    await user?.end();
  });

  const insertSession = (userId: string, factorId: string, method = 'totp') =>
    user.query(
      `INSERT INTO auth.session (organization_id, user_account_id, token_hash, issued_at, last_seen_at,
         absolute_expires_at, mfa_method, mfa_factor_id, mfa_at, reauth_at)
       VALUES ($1, $2, $3, now(), now(), now() + interval '1 hour', $4, $5, now(), now())`,
      [xyz, userId, randomBytes(32), method, factorId],
    );

  const insertFactor = async (userId: string, verified: boolean) =>
    (
      await user.query<{ id: string }>(
        `INSERT INTO auth.auth_factor (organization_id, user_account_id, kind, label, totp_secret_enc, verified_at)
         VALUES ($1, $2, 'totp', 'test', $3, $4) RETURNING id`,
        [xyz, userId, randomBytes(40), verified ? new Date() : null],
      )
    ).rows[0]!.id;

  it('refuses a session without a verified, unrevoked factor of the same user', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      const unverified = await insertFactor(ceo, false);
      await expectPgError(
        attempt(user, () => insertSession(ceo, unverified)),
        '42501',
      );
      const verified = await insertFactor(ceo, true);
      await expectPgError(
        attempt(user, () => insertSession(ceo, verified, 'passkey')),
        '42501',
      );
      // Someone else's factor cannot back this user's session (composite FK).
      const other = await insertFactor(provider, true);
      await expectPgError(
        attempt(user, () => insertSession(ceo, other)),
        '23503',
      );
      await user.query(
        `UPDATE auth.auth_factor SET revoked_at = now(), revoke_reason = 'mfa_reset' WHERE id = $1`,
        [verified],
      );
      await expectPgError(
        attempt(user, () => insertSession(ceo, verified)),
        '42501',
      );
      const good = await insertFactor(ceo, true);
      await attempt(user, () => insertSession(ceo, good));
    });
  });

  it('keeps factors one-way and sessions within 12 hours and 15 minutes idle', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      const f = await insertFactor(ceo, true);
      await expectPgError(
        attempt(user, () =>
          user.query('UPDATE auth.auth_factor SET verified_at = NULL WHERE id = $1', [f]),
        ),
        '23514',
      );
      await user.query(
        `UPDATE auth.auth_factor SET revoked_at = now(), revoke_reason = 'mfa_reset' WHERE id = $1`,
        [f],
      );
      await expectPgError(
        attempt(user, () =>
          user.query(
            'UPDATE auth.auth_factor SET revoked_at = NULL, revoke_reason = NULL WHERE id = $1',
            [f],
          ),
        ),
        '23514',
      );
      const g = await insertFactor(ceo, true);
      await expectPgError(
        attempt(user, () =>
          user.query(
            `INSERT INTO auth.session (organization_id, user_account_id, token_hash, issued_at, last_seen_at,
               absolute_expires_at, mfa_method, mfa_factor_id, mfa_at, reauth_at)
             VALUES ($1, $2, $3, now(), now(), now() + interval '13 hours', 'totp', $4, now(), now())`,
            [xyz, ceo, randomBytes(32), g],
          ),
        ),
        '23514',
      );
      await insertSession(ceo, g);
      await expectPgError(
        attempt(user, () =>
          user.query(
            'UPDATE auth.session SET idle_timeout_seconds = 3600 WHERE user_account_id = $1',
            [ceo],
          ),
        ),
        '23514',
      );
      await expectPgError(
        attempt(user, () =>
          user.query(
            `UPDATE auth.session SET absolute_expires_at = absolute_expires_at + interval '1 minute' WHERE user_account_id = $1`,
            [ceo],
          ),
        ),
        '23514',
      );
    });
  });

  it('resolves a login email to its tenant only through auth.resolve_login', async () => {
    const c = need();
    const rows = (
      await user.query<{ organization_id: string; user_account_id: string }>(
        'SELECT * FROM auth.resolve_login($1)',
        ['MARIA.DELGADO@xyz-chc.example '],
      )
    ).rows;
    expect(rows).toEqual([
      { organization_id: xyz, user_account_id: c.tenants.xyz.userIds.compliance },
    ]);
    expect(
      (await user.query('SELECT * FROM auth.resolve_login($1)', ['nobody@example.org'])).rowCount,
    ).toBe(0);
    await expectPgError(user.query('SELECT 1 FROM platform.login_directory'), '42501');
    await expectPgError(user.query('SELECT 1 FROM platform.auth_throttle'), '42501');
  });

  it('drops a deactivated account from sign-in resolution (directory trigger)', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      await user.query(`UPDATE public.user_account SET status = 'suspended' WHERE id = $1`, [ceo]);
      const rows = await user.query('SELECT * FROM auth.resolve_login($1)', [
        'james.whitfield@xyz-chc.example',
      ]);
      expect(rows.rowCount).toBe(0);
    });
  });

  it('counts failures atomically in auth.throttle_fail and matches the packages/auth policy', async () => {
    const key = randomBytes(32);
    const t0 = new Date('2030-01-01T00:00:00.000Z');
    // Same numbers as THROTTLE_POLICY.account: 5 free, then 60 s doubling.
    const locks: (number | null)[] = [];
    for (let i = 0; i < 8; i++) {
      const at = new Date(t0.getTime() + i * 1000);
      const { rows } = await user.query<{
        failures: number;
        locked_until: Date | null;
        locked_now: boolean;
      }>(`SELECT * FROM auth.throttle_fail($1, 'account', $2)`, [key, at]);
      locks.push(
        rows[0]!.locked_now ? (rows[0]!.locked_until!.getTime() - at.getTime()) / 1000 : null,
      );
    }
    expect(locks).toEqual([null, null, null, null, null, 60, 120, 240]);
    // Only account keys can be cleared, and app_user cannot write arbitrary state.
    await user.query('SELECT auth.throttle_clear($1)', [key]);
    const cleared = await user.query<{ failures: number }>(
      'SELECT * FROM auth.throttle_read(ARRAY[$1::bytea])',
      [key],
    );
    expect(cleared.rows[0]?.failures).toBe(0);
    await expectPgError(
      user.query(`SELECT auth.throttle_write($1, 'account', 0, now(), NULL)`, [key]),
      '42501',
    );
  });

  it('counts every one of many concurrent failures (no lost updates)', async () => {
    const c = need();
    const key = randomBytes(32);
    const clients = await Promise.all(Array.from({ length: 8 }, () => connect(c.appUserUrl)));
    try {
      const now = new Date();
      await Promise.all(
        clients.map((client) =>
          Promise.all(
            Array.from({ length: 5 }, () =>
              client.query(`SELECT * FROM auth.throttle_fail($1, 'ip', $2)`, [key, now]),
            ),
          ),
        ),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
    const { rows } = await user.query<{ failures: number }>(
      'SELECT * FROM auth.throttle_read(ARRAY[$1::bytea])',
      [key],
    );
    expect(rows[0]?.failures).toBe(40);
  });

  it('keeps TOTP steps strictly increasing and enrollment tokens single use', async () => {
    await inRollback(user, async () => {
      await setTenant(user, xyz);
      const f = (
        await user.query<{ id: string }>(
          `INSERT INTO auth.auth_factor (organization_id, user_account_id, kind, label, totp_secret_enc, verified_at, totp_last_step)
           VALUES ($1, $2, 'totp', 'test', $3, now(), 100) RETURNING id`,
          [xyz, ceo, randomBytes(40)],
        )
      ).rows[0]!.id;
      await expectPgError(
        attempt(user, () =>
          user.query('UPDATE auth.auth_factor SET totp_last_step = 99 WHERE id = $1', [f]),
        ),
        '23514',
      );
      await user.query('UPDATE auth.auth_factor SET totp_last_step = 101 WHERE id = $1', [f]);
      await user.query('UPDATE auth.auth_factor SET last_used_at = now() WHERE id = $1', [f]);
      const t = (
        await user.query<{ id: string }>(
          `INSERT INTO auth.enrollment_token (organization_id, user_account_id, token_hash, purpose, created_at, expires_at)
           VALUES ($1, $2, $3, 'invite', now(), now() + interval '1 day') RETURNING id`,
          [xyz, ceo, randomBytes(32)],
        )
      ).rows[0]!.id;
      await user.query('UPDATE auth.enrollment_token SET consumed_at = now() WHERE id = $1', [t]);
      await expectPgError(
        attempt(user, () =>
          user.query('UPDATE auth.enrollment_token SET consumed_at = NULL WHERE id = $1', [t]),
        ),
        '23514',
      );
      await expectPgError(
        attempt(user, () =>
          user.query(
            `INSERT INTO auth.enrollment_token (organization_id, user_account_id, token_hash, purpose, created_at, expires_at)
             VALUES ($1, $2, $3, 'invite', now(), now() + interval '8 days')`,
            [xyz, ceo, randomBytes(32)],
          ),
        ),
        '23514',
      );
    });
  });
});
