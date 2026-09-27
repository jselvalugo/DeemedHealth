/**
 * Sign-in, MFA, sessions, step-up, and MFA reset (ADR-0006, ADR-0010 section 6).
 *
 * Invariants this file keeps (and the tests prove):
 *  - A session is created in exactly one place, `issueSession`, which takes a
 *    `VerifiedFactor`. Only the four MFA verification paths below can construct one
 *    (passkey or TOTP, at sign-in or at first enrollment). The database refuses a
 *    session row without a verified, unrevoked factor of the same user as well.
 *  - Enrollment is possible only while the user has no verified factor, so a password
 *    alone can never add a factor to an account that already has MFA.
 *  - Nothing turns MFA off. The only way to remove factors is an administrator's MFA
 *    reset (step-up required, audited); the next sign-in then forces enrollment.
 *  - Every auth event is written to the tenant's audit chain in the same transaction
 *    as the state change it describes. Unknown emails leave no audit row (there is no
 *    tenant), and they are throttled exactly like known ones.
 */
import { hkdfSync } from 'node:crypto';
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
  appendAuditEvent,
  schema,
  type Actor,
  type AuditEventInput,
  type Database,
  type TransactionContext,
  type Tx,
} from '@deemed/db';
import type { MfaMethod } from '@deemed/domain';
import { systemClock, type Clock } from './clock.js';
import { AuthError } from './errors.js';
import { verifyPassword } from './password.js';
import { SESSION_POLICY } from './policy.js';
import { open, seal, type SecretBoxKey } from './secret-box.js';
import { accountKey, ipKey, isLocked, type ThrottleKey, type ThrottleState } from './throttle.js';
import { csrfTokenFor, issueToken, parseToken, sha256 } from './tokens.js';
import { newTotpSecret, totpUri, verifyTotp } from './totp.js';
import {
  passkeyAuthenticationOptions,
  passkeyRegistrationOptions,
  responseCredentialId,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
  type StoredPasskey,
  type WebAuthnConfig,
} from './webauthn.js';

const TOTP_PURPOSE = 'totp-secret';
/**
 * Password verifications per sign-in, whatever the number of matching accounts: an
 * unknown email, one account, or several health centers all cost the same Argon2 work.
 * An email in more than this many health centers must name the organization.
 */
const LOGIN_VERIFY_SLOTS = 3;
/** Pending sign-ins (password done, second factor not yet) kept open per user. */
const MAX_OPEN_ATTEMPTS = 3;
/** Enrollment token lifetimes (hours). */
const ENROLLMENT_HOURS = { invite: 72, mfa_reset: 24 } as const;
const SYSTEM: Actor = { type: 'system', label: 'sign-in service' };

/** Request facts every auth event records (ADR-0008 section 4: auth needs IP and UA). */
export interface RequestMeta {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface AuthServiceOptions {
  db: Database;
  clock?: Clock;
  /** Root key for TOTP secret encryption (interim, see secret-box.ts). */
  secretKey: SecretBoxKey;
  webauthn: WebAuthnConfig;
}

export interface LoginStep {
  loginToken: string;
  next: 'mfa' | 'mfa_enroll';
  methods: MfaMethod[];
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
  organizationId: string;
  userAccountId: string;
  absoluteExpiresAt: Date;
}

/** A live, authenticated session, as the API sees it for one request. */
export interface ActiveSession {
  id: string;
  /** The token the client must hold after this request (rotated when `rotated`). */
  token: string;
  rotated: boolean;
  csrfToken: string;
  organizationId: string;
  userAccountId: string;
  personId: string;
  displayName: string;
  email: string;
  issuedAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  idleTimeoutSeconds: number;
  mfaMethod: MfaMethod;
  reauthAt: Date;
}

interface Account {
  id: string;
  personId: string;
  email: string;
  label: string;
  active: boolean;
}

type AttemptRow = typeof schema.loginAttempt.$inferSelect;
type FactorRow = typeof schema.authFactor.$inferSelect;
type SessionRow = typeof schema.session.$inferSelect;

/** Proof that a second factor was just verified. Only this module can create one. */
const verifiedBrand: unique symbol = Symbol('verified-factor');
interface VerifiedFactor {
  readonly [verifiedBrand]: true;
  readonly factorId: string;
  readonly method: MfaMethod;
}
function verified(factorId: string, method: MfaMethod): VerifiedFactor {
  return { [verifiedBrand]: true, factorId, method };
}

const userAgentOf = (meta: RequestMeta) => (meta.userAgent || 'unknown').slice(0, 512);

function userActor(account: Account): Actor {
  return { type: 'user', userId: account.id, personId: account.personId, label: account.label };
}

function authEvent(
  meta: RequestMeta,
  action: string,
  extra: Partial<AuditEventInput> = {},
): AuditEventInput {
  return {
    category: 'auth',
    action,
    ipAddress: meta.ip,
    userAgent: userAgentOf(meta),
    ...extra,
  };
}

async function loadAccount(tx: Tx, userAccountId: string): Promise<Account | null> {
  const rows = await tx
    .select({
      id: schema.userAccount.id,
      personId: schema.userAccount.personId,
      email: schema.userAccount.loginEmail,
      status: schema.userAccount.status,
      archivedAt: schema.userAccount.archivedAt,
      given: schema.person.givenName,
      family: schema.person.familyName,
      preferred: schema.person.preferredName,
    })
    .from(schema.userAccount)
    .innerJoin(
      schema.person,
      and(
        eq(schema.person.organizationId, schema.userAccount.organizationId),
        eq(schema.person.id, schema.userAccount.personId),
      ),
    )
    .where(eq(schema.userAccount.id, userAccountId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    personId: r.personId,
    email: r.email,
    label: `${r.preferred ?? r.given} ${r.family}`,
    active: r.status === 'active' && r.archivedAt === null,
  };
}

async function activeFactors(tx: Tx, userAccountId: string): Promise<FactorRow[]> {
  return tx
    .select()
    .from(schema.authFactor)
    .where(
      and(
        eq(schema.authFactor.userAccountId, userAccountId),
        isNotNull(schema.authFactor.verifiedAt),
        isNull(schema.authFactor.revokedAt),
      ),
    );
}

function passkeyOf(f: FactorRow): StoredPasskey {
  return {
    credentialId: f.webauthnCredentialId as string,
    publicKey: f.webauthnPublicKey as Buffer,
    counter: f.webauthnCounter ?? 0,
    transports: f.webauthnTransports ?? null,
  };
}

export class AuthService {
  private readonly db: Database;
  readonly clock: Clock;
  private readonly secretKey: SecretBoxKey;
  private readonly webauthn: WebAuthnConfig;
  private readonly csrfKey: Buffer;

  constructor(options: AuthServiceOptions) {
    this.db = options.db;
    this.clock = options.clock ?? systemClock;
    this.secretKey = options.secretKey;
    this.webauthn = options.webauthn;
    this.csrfKey = Buffer.from(
      hkdfSync('sha256', options.secretKey.root, Buffer.alloc(0), 'dh:csrf:v1', 32),
    );
  }

  /** The CSRF token of a session (stable across token rotation). */
  csrfToken(sessionId: string): string {
    return csrfTokenFor(this.csrfKey, sessionId);
  }

  /** Decrypts a TOTP secret; null when the envelope does not open (wrong key or tenant). */
  private totpSecret(organizationId: string, sealed: Buffer): Buffer | null {
    try {
      return open(this.secretKey, organizationId, TOTP_PURPOSE, sealed);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Throttling (no tenant: platform functions, as app_user)
  // -------------------------------------------------------------------------

  private async readThrottle(keys: ThrottleKey[]): Promise<Map<string, ThrottleState>> {
    return this.db.withPlatform(SYSTEM, async (tx) => {
      const hashes = sql.join(
        keys.map((k) => sql`${k.hash}::bytea`),
        sql`, `,
      );
      const result = await tx.execute<{
        key_hash: Buffer;
        failures: number;
        window_started_at: Date;
        locked_until: Date | null;
      }>(sql`SELECT * FROM auth.throttle_read(ARRAY[${hashes}])`);
      const out = new Map<string, ThrottleState>();
      for (const r of result.rows) {
        out.set(Buffer.from(r.key_hash).toString('hex'), {
          failures: r.failures,
          windowStartedAt: new Date(r.window_started_at),
          lockedUntil: r.locked_until ? new Date(r.locked_until) : null,
        });
      }
      return out;
    });
  }

  /**
   * Records one failure per key, each with one atomic statement in the database
   * (auth.throttle_fail), so concurrent failures are all counted. Returns whether the
   * account key just locked.
   */
  private async fail(keys: ThrottleKey[]): Promise<boolean> {
    const now = this.clock.now();
    let accountLocked = false;
    for (const key of keys) {
      const result = await this.db.withPlatform(SYSTEM, (tx) =>
        tx.execute<{ locked_now: boolean }>(
          sql`SELECT locked_now FROM auth.throttle_fail(${key.hash}, ${key.scope}, ${now.toISOString()}::timestamptz)`,
        ),
      );
      if (key.scope === 'account' && result.rows[0]?.locked_now) accountLocked = true;
    }
    return accountLocked;
  }

  private async accountLocked(email: string): Promise<boolean> {
    const key = accountKey(email);
    const state = (await this.readThrottle([key])).get(key.hash.toString('hex'));
    return isLocked(state, this.clock.now());
  }

  private async clearThrottle(key: ThrottleKey): Promise<void> {
    await this.db.withPlatform(SYSTEM, (tx) =>
      tx.execute(sql`SELECT auth.throttle_clear(${key.hash})`),
    );
  }

  /** Whether sign-in for this email or from this address is currently locked. */
  async isThrottled(email: string, ip: string): Promise<boolean> {
    const now = this.clock.now();
    const states = await this.readThrottle([accountKey(email), ipKey(ip)]);
    return [...states.values()].some((s) => isLocked(s, now));
  }

  // -------------------------------------------------------------------------
  // Step 1: password
  // -------------------------------------------------------------------------

  async login(
    input: { email: string; password: string; organizationId?: string },
    meta: RequestMeta,
  ): Promise<LoginStep> {
    const email = input.email.trim().toLowerCase();
    const keys = [accountKey(email), ipKey(meta.ip)];
    if (await this.isThrottled(email, meta.ip)) {
      await verifyPassword(undefined, input.password);
      throw new AuthError('too_many_attempts');
    }

    let candidates = await this.db.withPlatform(SYSTEM, async (tx) => {
      const r = await tx.execute<{ organization_id: string; user_account_id: string }>(
        sql`SELECT organization_id::text, user_account_id::text FROM auth.resolve_login(${email})`,
      );
      return r.rows.map((row) => ({
        organizationId: row.organization_id,
        userAccountId: row.user_account_id,
      }));
    });
    if (input.organizationId) {
      candidates = candidates.filter((c) => c.organizationId === input.organizationId);
    }

    // Same Argon2 work for unknown, single-, and multi-organization emails.
    candidates = candidates.slice(0, LOGIN_VERIFY_SLOTS);
    for (let i = candidates.length; i < LOGIN_VERIFY_SLOTS; i++) {
      await verifyPassword(undefined, input.password);
    }
    const matches: typeof candidates = [];
    for (const c of candidates) {
      const phc = await this.db.withTenant(
        c.organizationId,
        SYSTEM,
        async (tx) =>
          (
            await tx
              .select({ hash: schema.localCredential.passwordHash })
              .from(schema.localCredential)
              .where(eq(schema.localCredential.userAccountId, c.userAccountId))
              .limit(1)
          )[0]?.hash,
        { requestId: meta.requestId },
      );
      if (await verifyPassword(phc, input.password)) matches.push(c);
    }

    if (matches.length === 0) {
      const locked = await this.fail(keys);
      for (const c of candidates) {
        await this.db.withTenant(
          c.organizationId,
          SYSTEM,
          async (tx, ctx) => {
            await appendAuditEvent(
              tx,
              ctx,
              authEvent(meta, 'session.login_failed', {
                outcome: 'failure',
                targetTable: 'user_account',
                targetId: c.userAccountId,
                metadata: { step: 'password' },
              }),
            );
            if (locked) {
              await appendAuditEvent(
                tx,
                ctx,
                authEvent(meta, 'account.locked', {
                  targetTable: 'user_account',
                  targetId: c.userAccountId,
                }),
              );
            }
          },
          { requestId: meta.requestId },
        );
      }
      throw new AuthError('invalid_credentials');
    }
    if (matches.length > 1) throw new AuthError('organization_required');

    const match = matches[0] as (typeof matches)[number];
    const now = this.clock.now();
    const issued = issueToken(match.organizationId);
    const methods = await this.db.withTenant(
      match.organizationId,
      SYSTEM,
      async (tx) => {
        // At most MAX_OPEN_ATTEMPTS pending sign-ins per user: close the oldest.
        const open = await tx
          .select({ id: schema.loginAttempt.id })
          .from(schema.loginAttempt)
          .where(
            and(
              eq(schema.loginAttempt.userAccountId, match.userAccountId),
              isNull(schema.loginAttempt.consumedAt),
              gt(schema.loginAttempt.expiresAt, now),
            ),
          )
          .orderBy(asc(schema.loginAttempt.createdAt))
          .for('update');
        for (const old of open.slice(0, Math.max(0, open.length - (MAX_OPEN_ATTEMPTS - 1)))) {
          await tx
            .update(schema.loginAttempt)
            .set({ consumedAt: now })
            .where(and(eq(schema.loginAttempt.id, old.id), isNull(schema.loginAttempt.consumedAt)));
        }
        await tx.insert(schema.loginAttempt).values({
          organizationId: match.organizationId,
          userAccountId: match.userAccountId,
          tokenHash: issued.hash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + SESSION_POLICY.loginAttemptSeconds * 1000),
          passwordVerifiedAt: now,
          ipAddress: meta.ip,
          userAgent: userAgentOf(meta),
        });
        const kinds = (await activeFactors(tx, match.userAccountId)).map((f) => f.kind);
        return [...new Set(kinds)];
      },
      { requestId: meta.requestId },
    );
    return { loginToken: issued.token, next: methods.length ? 'mfa' : 'mfa_enroll', methods };
  }

  /** Loads a pending sign-in in its tenant transaction, or throws session_expired. */
  private async withAttempt<T>(
    loginToken: string | undefined,
    meta: RequestMeta,
    fn: (tx: Tx, ctx: TransactionContext, attempt: AttemptRow, account: Account) => Promise<T>,
  ): Promise<T> {
    const parsed = parseToken(loginToken);
    if (!parsed) throw new AuthError('session_expired');
    const now = this.clock.now();
    const found = await this.db.withTenant(
      parsed.organizationId,
      SYSTEM,
      async (tx) => {
        const attempt = (
          await tx
            .select()
            .from(schema.loginAttempt)
            .where(eq(schema.loginAttempt.tokenHash, parsed.hash))
            .limit(1)
        )[0];
        if (
          !attempt ||
          attempt.consumedAt !== null ||
          attempt.expiresAt.getTime() <= now.getTime() ||
          attempt.failedMfaCount >= SESSION_POLICY.maxMfaFailuresPerAttempt
        ) {
          return null;
        }
        const account = await loadAccount(tx, attempt.userAccountId);
        return account?.active ? { attempt, account } : null;
      },
      { requestId: meta.requestId },
    );
    if (!found) throw new AuthError('session_expired');
    // Second-factor failures count per user (the account key), across every pending
    // sign-in; while the account is locked no attempt may answer.
    if (await this.accountLocked(found.account.email)) throw new AuthError('too_many_attempts');
    return this.db.withTenant(
      parsed.organizationId,
      userActor(found.account),
      (tx, ctx) => fn(tx, ctx, found.attempt, found.account),
      { requestId: meta.requestId },
    );
  }

  /** A wrong second factor: count it on the attempt and the account, audit it. */
  private async mfaFailed(
    loginToken: string | undefined,
    meta: RequestMeta,
    method: MfaMethod,
  ): Promise<never> {
    const email = await this.withAttempt(loginToken, meta, async (tx, ctx, attempt, account) => {
      await tx
        .update(schema.loginAttempt)
        .set({ failedMfaCount: attempt.failedMfaCount + 1 })
        .where(eq(schema.loginAttempt.id, attempt.id));
      await appendAuditEvent(
        tx,
        ctx,
        authEvent(meta, 'mfa.challenge', {
          outcome: 'failure',
          targetTable: 'user_account',
          targetId: account.id,
          metadata: { method },
        }),
      );
      return account.email;
    }).catch(() => null);
    if (email) await this.fail([accountKey(email)]);
    throw new AuthError('invalid_code');
  }

  // -------------------------------------------------------------------------
  // The one place a session is created
  // -------------------------------------------------------------------------

  private async issueSession(
    tx: Tx,
    ctx: TransactionContext,
    attempt: AttemptRow,
    account: Account,
    factor: VerifiedFactor,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    if (factor[verifiedBrand] !== true) throw new Error('issueSession needs a verified factor');
    const now = this.clock.now();
    const consumed = await tx
      .update(schema.loginAttempt)
      .set({ consumedAt: now })
      .where(and(eq(schema.loginAttempt.id, attempt.id), isNull(schema.loginAttempt.consumedAt)))
      .returning({ id: schema.loginAttempt.id });
    if (consumed.length !== 1) throw new AuthError('session_expired');

    const issued = issueToken(attempt.organizationId);
    const absoluteExpiresAt = new Date(
      now.getTime() + SESSION_POLICY.absoluteLifetimeSeconds * 1000,
    );
    const [row] = await tx
      .insert(schema.session)
      .values({
        organizationId: attempt.organizationId,
        userAccountId: account.id,
        tokenHash: issued.hash,
        issuedAt: now,
        lastSeenAt: now,
        absoluteExpiresAt,
        idleTimeoutSeconds: SESSION_POLICY.idleTimeoutSeconds,
        mfaMethod: factor.method,
        mfaFactorId: factor.factorId,
        mfaAt: now,
        reauthAt: now,
        ipAddress: meta.ip,
        userAgent: userAgentOf(meta),
      })
      .returning({ id: schema.session.id });
    const sessionId = (row as { id: string }).id;
    await tx
      .update(schema.userAccount)
      .set({ lastLoginAt: now })
      .where(eq(schema.userAccount.id, account.id));
    await appendAuditEvent(
      tx,
      ctx,
      authEvent(meta, 'session.login', {
        targetTable: 'user_account',
        targetId: account.id,
        sessionId,
        metadata: { mfa_method: factor.method },
      }),
    );
    return {
      token: issued.token,
      csrfToken: this.csrfToken(sessionId),
      sessionId,
      organizationId: attempt.organizationId,
      userAccountId: account.id,
      absoluteExpiresAt,
    };
  }

  /**
   * Accepts a TOTP time step for a factor only if it is newer than the stored one, in
   * one conditional UPDATE: of two concurrent requests with the same code, one wins.
   */
  private async consumeTotpStep(
    tx: Tx,
    factorId: string,
    step: number,
    now: Date,
  ): Promise<boolean> {
    const rows = await tx
      .update(schema.authFactor)
      .set({ totpLastStep: step, lastUsedAt: now })
      .where(
        and(
          eq(schema.authFactor.id, factorId),
          or(isNull(schema.authFactor.totpLastStep), lt(schema.authFactor.totpLastStep, step)),
        ),
      )
      .returning({ id: schema.authFactor.id });
    return rows.length === 1;
  }

  /**
   * First-factor enrollment needs a single-use enrollment token for this user, issued by
   * an invitation or an administrator's MFA reset and delivered out of band. `consume`
   * spends it atomically (the finishing step); otherwise it is only checked.
   */
  private async useEnrollmentToken(
    tx: Tx,
    attempt: AttemptRow,
    account: Account,
    token: string | undefined,
    consume: boolean,
  ): Promise<void> {
    const parsed = parseToken(token);
    const now = this.clock.now();
    if (!parsed || parsed.organizationId !== attempt.organizationId) {
      throw new AuthError('enrollment_token_invalid');
    }
    const open = and(
      eq(schema.enrollmentToken.tokenHash, parsed.hash),
      eq(schema.enrollmentToken.userAccountId, account.id),
      isNull(schema.enrollmentToken.consumedAt),
      isNull(schema.enrollmentToken.revokedAt),
      gt(schema.enrollmentToken.expiresAt, now),
    );
    const rows = consume
      ? await tx
          .update(schema.enrollmentToken)
          .set({ consumedAt: now })
          .where(open)
          .returning({ id: schema.enrollmentToken.id })
      : await tx
          .select({ id: schema.enrollmentToken.id })
          .from(schema.enrollmentToken)
          .where(open)
          .limit(1);
    if (rows.length !== 1) throw new AuthError('enrollment_token_invalid');
  }

  /**
   * Issues a single-use enrollment token (the previous open ones are revoked) and audits
   * it. Returns the token for out-of-band delivery; it is stored only as a digest.
   */
  async issueEnrollmentToken(
    tx: Tx,
    ctx: TransactionContext,
    userAccountId: string,
    purpose: 'invite' | 'mfa_reset',
    meta: RequestMeta,
  ): Promise<{ token: string; expiresAt: Date }> {
    if (ctx.organizationId === null) throw new Error('issueEnrollmentToken needs a tenant');
    const now = this.clock.now();
    await tx
      .update(schema.enrollmentToken)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.enrollmentToken.userAccountId, userAccountId),
          isNull(schema.enrollmentToken.consumedAt),
          isNull(schema.enrollmentToken.revokedAt),
        ),
      );
    const issued = issueToken(ctx.organizationId);
    const expiresAt = new Date(now.getTime() + ENROLLMENT_HOURS[purpose] * 3_600_000);
    await tx.insert(schema.enrollmentToken).values({
      organizationId: ctx.organizationId,
      userAccountId,
      tokenHash: issued.hash,
      purpose,
      createdAt: now,
      expiresAt,
      issuedBy: ctx.actor.userId ?? null,
    });
    await appendAuditEvent(
      tx,
      ctx,
      authEvent(meta, 'mfa.enrollment_issued', {
        targetTable: 'user_account',
        targetId: userAccountId,
        metadata: { purpose, expires_at: expiresAt.toISOString() },
      }),
    );
    return { token: issued.token, expiresAt };
  }

  private async afterSignIn(email: string): Promise<void> {
    await this.clearThrottle(accountKey(email));
  }

  // -------------------------------------------------------------------------
  // Step 2: TOTP
  // -------------------------------------------------------------------------

  /** First sign-in without any factor: create an unverified TOTP factor. */
  async startTotpEnrollment(
    loginToken: string | undefined,
    enrollmentToken: string | undefined,
    meta: RequestMeta,
  ): Promise<{ otpauthUri: string; secret: string }> {
    return this.withAttempt(loginToken, meta, async (tx, _ctx, attempt, account) => {
      if ((await activeFactors(tx, account.id)).length > 0) {
        throw new AuthError('mfa_required', 'user already has a factor; enrollment refused');
      }
      await this.useEnrollmentToken(tx, attempt, account, enrollmentToken, false);
      const secret = newTotpSecret();
      await tx.insert(schema.authFactor).values({
        organizationId: attempt.organizationId,
        userAccountId: account.id,
        kind: 'totp',
        label: 'Authenticator app',
        totpSecretEnc: seal(this.secretKey, attempt.organizationId, TOTP_PURPOSE, secret.bytes),
      });
      return { otpauthUri: totpUri(secret.bytes, account.email), secret: secret.base32 };
    });
  }

  async finishTotpEnrollment(
    loginToken: string | undefined,
    enrollmentToken: string | undefined,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const result = await this.withAttempt(loginToken, meta, async (tx, ctx, attempt, account) => {
      if ((await activeFactors(tx, account.id)).length > 0) {
        throw new AuthError('mfa_required', 'user already has a factor; enrollment refused');
      }
      const pending = (
        await tx
          .select()
          .from(schema.authFactor)
          .where(
            and(
              eq(schema.authFactor.userAccountId, account.id),
              eq(schema.authFactor.kind, 'totp'),
              isNull(schema.authFactor.verifiedAt),
              isNull(schema.authFactor.revokedAt),
            ),
          )
          .orderBy(desc(schema.authFactor.createdAt))
          .limit(1)
      )[0];
      if (!pending?.totpSecretEnc) return null;
      const secret = this.totpSecret(attempt.organizationId, pending.totpSecretEnc);
      const step = secret && verifyTotp(secret, code, now, null);
      if (!step) return null;
      await this.useEnrollmentToken(tx, attempt, account, enrollmentToken, true);
      const done = await tx
        .update(schema.authFactor)
        .set({ verifiedAt: now, totpLastStep: step, lastUsedAt: now })
        .where(and(eq(schema.authFactor.id, pending.id), isNull(schema.authFactor.verifiedAt)))
        .returning({ id: schema.authFactor.id });
      if (done.length !== 1) return null;
      await appendAuditEvent(
        tx,
        ctx,
        authEvent(meta, 'mfa.enrolled', {
          targetTable: 'user_account',
          targetId: account.id,
          metadata: { method: 'totp', factor_id: pending.id },
        }),
      );
      const session = await this.issueSession(
        tx,
        ctx,
        attempt,
        account,
        verified(pending.id, 'totp'),
        meta,
      );
      return { session, email: account.email };
    });
    if (!result) return this.mfaFailed(loginToken, meta, 'totp');
    await this.afterSignIn(result.email);
    return result.session;
  }

  async verifyTotpLogin(
    loginToken: string | undefined,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const result = await this.withAttempt(loginToken, meta, async (tx, ctx, attempt, account) => {
      for (const f of await activeFactors(tx, account.id)) {
        if (f.kind !== 'totp' || !f.totpSecretEnc) continue;
        const secret = this.totpSecret(attempt.organizationId, f.totpSecretEnc);
        const step = secret && verifyTotp(secret, code, now, f.totpLastStep);
        if (!step || !(await this.consumeTotpStep(tx, f.id, step, now))) continue;
        await appendAuditEvent(
          tx,
          ctx,
          authEvent(meta, 'mfa.challenge', {
            targetTable: 'user_account',
            targetId: account.id,
            metadata: { method: 'totp' },
          }),
        );
        const session = await this.issueSession(
          tx,
          ctx,
          attempt,
          account,
          verified(f.id, 'totp'),
          meta,
        );
        return { session, email: account.email };
      }
      return null;
    });
    if (!result) return this.mfaFailed(loginToken, meta, 'totp');
    await this.afterSignIn(result.email);
    return result.session;
  }

  // -------------------------------------------------------------------------
  // Step 2: passkeys
  // -------------------------------------------------------------------------

  async passkeyEnrollmentOptions(
    loginToken: string | undefined,
    enrollmentToken: string | undefined,
    meta: RequestMeta,
  ) {
    return this.withAttempt(loginToken, meta, async (tx, _ctx, attempt, account) => {
      if ((await activeFactors(tx, account.id)).length > 0) {
        throw new AuthError('mfa_required', 'user already has a factor; enrollment refused');
      }
      await this.useEnrollmentToken(tx, attempt, account, enrollmentToken, false);
      const options = await passkeyRegistrationOptions(
        this.webauthn,
        { userAccountId: account.id, email: account.email, displayName: account.label },
        [],
      );
      await tx
        .update(schema.loginAttempt)
        .set({ webauthnChallenge: options.challenge })
        .where(eq(schema.loginAttempt.id, attempt.id));
      return options;
    });
  }

  async finishPasskeyEnrollment(
    loginToken: string | undefined,
    enrollmentToken: string | undefined,
    response: unknown,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const result = await this.withAttempt(loginToken, meta, async (tx, ctx, attempt, account) => {
      if ((await activeFactors(tx, account.id)).length > 0) {
        throw new AuthError('mfa_required', 'user already has a factor; enrollment refused');
      }
      const challenge = attempt.webauthnChallenge;
      if (!challenge) return null;
      // Single use: the challenge is cleared before the response is verified.
      await tx
        .update(schema.loginAttempt)
        .set({ webauthnChallenge: null })
        .where(eq(schema.loginAttempt.id, attempt.id));
      const credential = await verifyPasskeyRegistration(this.webauthn, response, challenge);
      if (!credential) return null;
      await this.useEnrollmentToken(tx, attempt, account, enrollmentToken, true);
      const [factor] = await tx
        .insert(schema.authFactor)
        .values({
          organizationId: attempt.organizationId,
          userAccountId: account.id,
          kind: 'passkey',
          label: 'Passkey',
          webauthnCredentialId: credential.credentialId,
          webauthnPublicKey: credential.publicKey,
          webauthnCounter: credential.counter,
          webauthnTransports: credential.transports ? [...credential.transports] : null,
          verifiedAt: now,
          lastUsedAt: now,
        })
        .returning({ id: schema.authFactor.id });
      const factorId = (factor as { id: string }).id;
      await appendAuditEvent(
        tx,
        ctx,
        authEvent(meta, 'mfa.enrolled', {
          targetTable: 'user_account',
          targetId: account.id,
          metadata: { method: 'passkey', factor_id: factorId },
        }),
      );
      const session = await this.issueSession(
        tx,
        ctx,
        attempt,
        account,
        verified(factorId, 'passkey'),
        meta,
      );
      return { session, email: account.email };
    });
    if (!result) return this.mfaFailed(loginToken, meta, 'passkey');
    await this.afterSignIn(result.email);
    return result.session;
  }

  async passkeyLoginOptions(loginToken: string | undefined, meta: RequestMeta) {
    return this.withAttempt(loginToken, meta, async (tx, _ctx, attempt, account) => {
      const passkeys = (await activeFactors(tx, account.id)).filter((f) => f.kind === 'passkey');
      if (passkeys.length === 0) throw new AuthError('mfa_required', 'no passkey enrolled');
      const options = await passkeyAuthenticationOptions(this.webauthn, passkeys.map(passkeyOf));
      await tx
        .update(schema.loginAttempt)
        .set({ webauthnChallenge: options.challenge })
        .where(eq(schema.loginAttempt.id, attempt.id));
      return options;
    });
  }

  async verifyPasskeyLogin(
    loginToken: string | undefined,
    response: unknown,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const result = await this.withAttempt(loginToken, meta, async (tx, ctx, attempt, account) => {
      const challenge = attempt.webauthnChallenge;
      const credentialId = responseCredentialId(response);
      if (!challenge || !credentialId) return null;
      await tx
        .update(schema.loginAttempt)
        .set({ webauthnChallenge: null })
        .where(eq(schema.loginAttempt.id, attempt.id));
      const factor = (await activeFactors(tx, account.id)).find(
        (f) => f.kind === 'passkey' && f.webauthnCredentialId === credentialId,
      );
      if (!factor) return null;
      const counter = await verifyPasskeyAuthentication(
        this.webauthn,
        response,
        challenge,
        passkeyOf(factor),
      );
      if (counter === null) return null;
      await tx
        .update(schema.authFactor)
        .set({ webauthnCounter: counter, lastUsedAt: now })
        .where(eq(schema.authFactor.id, factor.id));
      await appendAuditEvent(
        tx,
        ctx,
        authEvent(meta, 'mfa.challenge', {
          targetTable: 'user_account',
          targetId: account.id,
          metadata: { method: 'passkey' },
        }),
      );
      const session = await this.issueSession(
        tx,
        ctx,
        attempt,
        account,
        verified(factor.id, 'passkey'),
        meta,
      );
      return { session, email: account.email };
    });
    if (!result) return this.mfaFailed(loginToken, meta, 'passkey');
    await this.afterSignIn(result.email);
    return result.session;
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Validates a session token for one request: idle and absolute timeouts, account
   * still active, rotation after a privilege change. Throws `unauthenticated` or
   * `session_expired`; expiry is revoked and audited before the error is thrown.
   */
  async authenticate(
    token: string | undefined,
    meta: RequestMeta,
    options: { rotate?: boolean } = {},
  ): Promise<ActiveSession> {
    const parsed = parseToken(token);
    if (!parsed) throw new AuthError('unauthenticated');
    const now = this.clock.now();
    const outcome = await this.db.withTenant(
      parsed.organizationId,
      SYSTEM,
      async (tx, ctx): Promise<ActiveSession | 'unauthenticated' | 'expired'> => {
        const row = (
          await tx
            .select()
            .from(schema.session)
            .where(eq(schema.session.tokenHash, parsed.hash))
            .limit(1)
        )[0];
        if (!row || row.revokedAt !== null) return 'unauthenticated';
        const idleDeadline = row.lastSeenAt.getTime() + row.idleTimeoutSeconds * 1000;
        const reason =
          now.getTime() >= row.absoluteExpiresAt.getTime()
            ? ('absolute' as const)
            : now.getTime() > idleDeadline
              ? ('idle' as const)
              : null;
        const account = await loadAccount(tx, row.userAccountId);
        if (reason || !account?.active) {
          await this.revoke(tx, ctx, row, reason ?? 'deprovisioned', meta, 'session.expired');
          return reason ? 'expired' : 'unauthenticated';
        }
        let current = token as string;
        let rotated = false;
        // Pending rotation happens on a request whose response reaches the browser
        // (mutations are always sent by the browser itself); server-side reads from
        // apps/web could not pass a new cookie on.
        if (row.rotateRequired && options.rotate) {
          const next = issueToken(row.organizationId);
          await tx
            .update(schema.session)
            .set({ tokenHash: next.hash, rotateRequired: false, rotatedAt: now })
            .where(eq(schema.session.id, row.id));
          await appendAuditEvent(
            tx,
            ctx,
            authEvent(meta, 'session.rotated', {
              targetTable: 'user_account',
              targetId: account.id,
              sessionId: row.id,
            }),
          );
          current = next.token;
          rotated = true;
        }
        await tx
          .update(schema.session)
          .set({
            lastSeenAt: sql`greatest(${schema.session.lastSeenAt}, ${now.toISOString()}::timestamptz)`,
          })
          .where(eq(schema.session.id, row.id));
        return {
          id: row.id,
          token: current,
          rotated,
          csrfToken: this.csrfToken(row.id),
          organizationId: row.organizationId,
          userAccountId: account.id,
          personId: account.personId,
          displayName: account.label,
          email: account.email,
          issuedAt: row.issuedAt,
          lastSeenAt: now,
          absoluteExpiresAt: row.absoluteExpiresAt,
          idleTimeoutSeconds: row.idleTimeoutSeconds,
          mfaMethod: row.mfaMethod,
          reauthAt: row.reauthAt,
        };
      },
      { requestId: meta.requestId },
    );
    if (outcome === 'unauthenticated') throw new AuthError('unauthenticated');
    if (outcome === 'expired') throw new AuthError('session_expired');
    return outcome;
  }

  private async revoke(
    tx: Tx,
    ctx: TransactionContext,
    row: Pick<SessionRow, 'id' | 'userAccountId'>,
    reason: NonNullable<SessionRow['revokeReason']>,
    meta: RequestMeta,
    action: 'session.expired' | 'session.revoked' | 'session.logout',
  ): Promise<void> {
    const now = this.clock.now();
    const done = await tx
      .update(schema.session)
      .set({ revokedAt: now, revokeReason: reason })
      .where(and(eq(schema.session.id, row.id), isNull(schema.session.revokedAt)))
      .returning({ id: schema.session.id });
    if (done.length === 0) return;
    await appendAuditEvent(
      tx,
      ctx,
      authEvent(meta, action, {
        targetTable: 'user_account',
        targetId: row.userAccountId,
        sessionId: row.id,
        metadata: { reason },
      }),
    );
  }

  /** True when the last step-up is at most 5 minutes old (ADR-0006 rule 5). */
  hasRecentAuth(session: Pick<ActiveSession, 'reauthAt'>): boolean {
    const age = this.clock.now().getTime() - session.reauthAt.getTime();
    return age >= 0 && age <= SESSION_POLICY.recentAuthSeconds * 1000;
  }

  private async withSessionUser<T>(
    session: ActiveSession,
    meta: RequestMeta,
    fn: (tx: Tx, ctx: TransactionContext, account: Account) => Promise<T>,
  ): Promise<T> {
    const actor: Actor = {
      type: 'user',
      userId: session.userAccountId,
      personId: session.personId,
      label: session.displayName,
    };
    return this.db.withTenant(
      session.organizationId,
      actor,
      async (tx, ctx) => {
        const account = await loadAccount(tx, session.userAccountId);
        if (!account?.active) throw new AuthError('unauthenticated');
        return fn(tx, ctx, account);
      },
      { requestId: meta.requestId },
    );
  }

  private async stepUpDone(
    tx: Tx,
    ctx: TransactionContext,
    session: ActiveSession,
    meta: RequestMeta,
    method: MfaMethod,
  ) {
    const now = this.clock.now();
    await tx
      .update(schema.session)
      .set({
        reauthAt: sql`greatest(${schema.session.reauthAt}, ${now.toISOString()}::timestamptz)`,
        reauthChallenge: null,
      })
      .where(eq(schema.session.id, session.id));
    await appendAuditEvent(
      tx,
      ctx,
      authEvent(meta, 'session.reauth', {
        targetTable: 'user_account',
        targetId: session.userAccountId,
        sessionId: session.id,
        metadata: { method },
      }),
    );
    return now;
  }

  private async stepUpFailed(
    session: ActiveSession,
    meta: RequestMeta,
    method: MfaMethod,
  ): Promise<never> {
    await this.withSessionUser(session, meta, (tx, ctx) =>
      appendAuditEvent(
        tx,
        ctx,
        authEvent(meta, 'session.reauth', {
          outcome: 'failure',
          targetTable: 'user_account',
          targetId: session.userAccountId,
          sessionId: session.id,
          metadata: { method },
        }),
      ),
    );
    await this.fail([accountKey(session.email)]);
    throw new AuthError('invalid_code');
  }

  /** Step-up with an authenticator code. */
  async reauthWithTotp(session: ActiveSession, code: string, meta: RequestMeta): Promise<Date> {
    if (await this.isThrottled(session.email, meta.ip)) throw new AuthError('too_many_attempts');
    const now = this.clock.now();
    const done = await this.withSessionUser(session, meta, async (tx, ctx, account) => {
      for (const f of await activeFactors(tx, account.id)) {
        if (f.kind !== 'totp' || !f.totpSecretEnc) continue;
        const secret = this.totpSecret(session.organizationId, f.totpSecretEnc);
        const step = secret && verifyTotp(secret, code, now, f.totpLastStep);
        if (!step || !(await this.consumeTotpStep(tx, f.id, step, now))) continue;
        return this.stepUpDone(tx, ctx, session, meta, 'totp');
      }
      return null;
    });
    return done ?? this.stepUpFailed(session, meta, 'totp');
  }

  async reauthPasskeyOptions(session: ActiveSession, meta: RequestMeta) {
    return this.withSessionUser(session, meta, async (tx, _ctx, account) => {
      const passkeys = (await activeFactors(tx, account.id)).filter((f) => f.kind === 'passkey');
      if (passkeys.length === 0) throw new AuthError('unsupported', 'no passkey enrolled');
      const options = await passkeyAuthenticationOptions(this.webauthn, passkeys.map(passkeyOf));
      await tx
        .update(schema.session)
        .set({ reauthChallenge: options.challenge })
        .where(eq(schema.session.id, session.id));
      return options;
    });
  }

  async reauthWithPasskey(
    session: ActiveSession,
    response: unknown,
    meta: RequestMeta,
  ): Promise<Date> {
    const now = this.clock.now();
    const done = await this.withSessionUser(session, meta, async (tx, ctx, account) => {
      const row = (
        await tx
          .select({ challenge: schema.session.reauthChallenge })
          .from(schema.session)
          .where(eq(schema.session.id, session.id))
      )[0];
      const credentialId = responseCredentialId(response);
      if (!row?.challenge || !credentialId) return null;
      await tx
        .update(schema.session)
        .set({ reauthChallenge: null })
        .where(eq(schema.session.id, session.id));
      const factor = (await activeFactors(tx, account.id)).find(
        (f) => f.kind === 'passkey' && f.webauthnCredentialId === credentialId,
      );
      if (!factor) return null;
      const counter = await verifyPasskeyAuthentication(
        this.webauthn,
        response,
        row.challenge,
        passkeyOf(factor),
      );
      if (counter === null) return null;
      await tx
        .update(schema.authFactor)
        .set({ webauthnCounter: counter, lastUsedAt: now })
        .where(eq(schema.authFactor.id, factor.id));
      return this.stepUpDone(tx, ctx, session, meta, 'passkey');
    });
    return done ?? this.stepUpFailed(session, meta, 'passkey');
  }

  async logout(session: ActiveSession, meta: RequestMeta): Promise<void> {
    await this.withSessionUser(session, meta, (tx, ctx) =>
      this.revoke(
        tx,
        ctx,
        { id: session.id, userAccountId: session.userAccountId },
        'logout',
        meta,
        'session.logout',
      ),
    );
  }

  /**
   * Ends the session behind a token presented at sign-in (rotation on login,
   * ADR-0006 rule 4). Silent when the token is unknown or already ended.
   */
  async revokePresentedSession(token: string | undefined, meta: RequestMeta): Promise<void> {
    const parsed = parseToken(token);
    if (!parsed) return;
    await this.db.withTenant(
      parsed.organizationId,
      SYSTEM,
      async (tx, ctx) => {
        const row = (
          await tx
            .select({
              id: schema.session.id,
              userAccountId: schema.session.userAccountId,
              revokedAt: schema.session.revokedAt,
            })
            .from(schema.session)
            .where(eq(schema.session.tokenHash, parsed.hash))
            .limit(1)
        )[0];
        if (row && row.revokedAt === null)
          await this.revoke(tx, ctx, row, 'replaced', meta, 'session.revoked');
      },
      { requestId: meta.requestId },
    );
  }

  // -------------------------------------------------------------------------
  // Administration helpers (the API checks RBAC and step-up first)
  // -------------------------------------------------------------------------

  /**
   * MFA reset (ADR-0006 rule 11): revokes every factor and session of the user, in the
   * administrator's transaction. The next sign-in forces a new enrollment; MFA itself
   * stays mandatory. The user notification is S5 (notifications); until then the audit
   * metadata records it as pending.
   */
  async resetMfa(
    tx: Tx,
    ctx: TransactionContext,
    targetUserAccountId: string,
    reason: string,
    meta: RequestMeta,
  ): Promise<{
    factorsRevoked: number;
    sessionsRevoked: number;
    enrollmentToken: string;
    enrollmentExpiresAt: Date;
  }> {
    const now = this.clock.now();
    // Pending sign-ins that passed the password before the reset can no longer finish.
    await tx
      .update(schema.loginAttempt)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.loginAttempt.userAccountId, targetUserAccountId),
          isNull(schema.loginAttempt.consumedAt),
        ),
      );
    const factors = await tx
      .update(schema.authFactor)
      .set({ revokedAt: now, revokeReason: 'mfa_reset' })
      .where(
        and(
          eq(schema.authFactor.userAccountId, targetUserAccountId),
          isNull(schema.authFactor.revokedAt),
        ),
      )
      .returning({ id: schema.authFactor.id });
    const sessions = await tx
      .select({ id: schema.session.id, userAccountId: schema.session.userAccountId })
      .from(schema.session)
      .where(
        and(
          eq(schema.session.userAccountId, targetUserAccountId),
          isNull(schema.session.revokedAt),
        ),
      );
    for (const s of sessions) await this.revoke(tx, ctx, s, 'mfa_reset', meta, 'session.revoked');
    await appendAuditEvent(
      tx,
      ctx,
      authEvent(meta, 'mfa.reset', {
        targetTable: 'user_account',
        targetId: targetUserAccountId,
        metadata: {
          factors_revoked: factors.length,
          sessions_revoked: sessions.length,
          // Free text stays out of the log (PII class): length and digest only.
          reason_length: [...reason].length,
          reason_sha256: sha256(reason).toString('hex'),
          user_notification: 'pending (S5 notifications)',
        },
      }),
    );
    const enrollment = await this.issueEnrollmentToken(
      tx,
      ctx,
      targetUserAccountId,
      'mfa_reset',
      meta,
    );
    return {
      factorsRevoked: factors.length,
      sessionsRevoked: sessions.length,
      enrollmentToken: enrollment.token,
      enrollmentExpiresAt: enrollment.expiresAt,
    };
  }

  /** After a privilege change: the user's sessions rotate their token on the next request. */
  async requireRotation(tx: Tx, userAccountId: string): Promise<number> {
    const rows = await tx
      .update(schema.session)
      .set({ rotateRequired: true })
      .where(and(eq(schema.session.userAccountId, userAccountId), isNull(schema.session.revokedAt)))
      .returning({ id: schema.session.id });
    return rows.length;
  }
}
