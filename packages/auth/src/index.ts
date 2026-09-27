// @deemed/auth: identity for apps/api and apps/worker only (ADR-0010 section 6).
export { FakeClock, systemClock, type Clock } from './clock.js';
export { AuthError } from './errors.js';
export { PASSWORD_POLICY, SESSION_POLICY, THROTTLE_POLICY } from './policy.js';
export {
  checkNewPassword,
  hashPassword,
  verifyPassword,
  type PasswordProblem,
} from './password.js';
export { BREACHED_PASSWORDS, isBreachedPassword } from './breached-passwords.js';
export { open as openSecret, seal as sealSecret, type SecretBoxKey } from './secret-box.js';
export { csrfTokenFor, isUuid, issueToken, parseToken, safeEqual, sha256 } from './tokens.js';
export {
  generateTotp,
  isTotpFormat,
  newTotpSecret,
  secretFromBase32,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp.js';
export {
  accountKey,
  ipKey,
  ipPrefix,
  isLocked,
  recordFailure,
  type ThrottleKey,
  type ThrottleScope,
  type ThrottleState,
} from './throttle.js';
export { type StoredPasskey, type WebAuthnConfig } from './webauthn.js';
export {
  AuthService,
  type ActiveSession,
  type AuthServiceOptions,
  type IssuedSession,
  type LoginStep,
  type RequestMeta,
} from './service.js';
