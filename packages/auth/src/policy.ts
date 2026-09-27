/**
 * The numbers ADR-0006 fixes. Tenants may shorten the idle timeout, never lengthen
 * it; nothing else is configurable.
 */
export const SESSION_POLICY = {
  /** Rule 4: idle timeout. */
  idleTimeoutSeconds: 15 * 60,
  /** Rule 4: absolute lifetime. */
  absoluteLifetimeSeconds: 12 * 60 * 60,
  /** Rule 5: step-up is fresh for 5 minutes. */
  recentAuthSeconds: 5 * 60,
  /** Password to second factor: at most 10 minutes. */
  loginAttemptSeconds: 10 * 60,
  /** Wrong second-factor answers before the pending sign-in is discarded. */
  maxMfaFailuresPerAttempt: 5,
} as const;

/** Rule 2: minimum length; no composition rules, no forced rotation. */
export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 256,
} as const;

/**
 * Rule 11: progressive lockout per account (keyed by the email, so unknown and known
 * emails behave the same) and a coarser limit per IP prefix.
 */
export const THROTTLE_POLICY = {
  windowSeconds: 15 * 60,
  account: { freeFailures: 5, baseLockSeconds: 60, maxLockSeconds: 60 * 60 },
  ip: { freeFailures: 30, baseLockSeconds: 15 * 60, maxLockSeconds: 60 * 60 },
} as const;
