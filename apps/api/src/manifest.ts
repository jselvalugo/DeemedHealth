/**
 * Route manifest: every endpoint the API serves, with its access rule and audit action.
 * `buildApp()` registers routes only from this list, and CI checks
 * (src/manifest.test.ts) that:
 *   - the app serves exactly these routes;
 *   - every mutation declares its audit action;
 *   - every endpoint has its required integration tests (REQUIRED_CASES), written with
 *     `defineRouteTests()` in apps/api/test. A permission endpoint needs the four:
 *     allowed, denied role, other site, other tenant (plus "reauth required" when it
 *     needs step-up).
 */
import type { AuditAction, Permission } from '@deemed/domain';
import { RECORD_ROUTES, type RecordRouteId } from './records/manifest.js';

export type Access =
  /** No session. `reason` says why the endpoint is open. */
  | { kind: 'public'; reason: string }
  /** The pending sign-in cookie (between password and second factor). */
  | { kind: 'signin' }
  /** Any signed-in user; the handler only touches the user's own records. */
  | { kind: 'session' }
  /**
   * A signed-in user whose roles grant `permission`. `record: true`: the handler must
   * also authorize the record it touches (site scope, ownership, approval area) before
   * its transaction commits, or the request fails. Every `approve` route needs it.
   */
  | { kind: 'permission'; permission: Permission; recentAuth?: boolean; record?: boolean };

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  access: Access;
  /**
   * The audit action a mutation writes. `by: 'auth'` means packages/auth writes it in
   * the same transaction as the session change; otherwise the audit middleware
   * refuses to commit a mutation that wrote no audit event (unless the handler declares
   * an explicit no-op). `perRow`: a bulk route writes one event per changed row and may
   * change none (each refused row is still audited as denied).
   */
  audit: { action: AuditAction; by?: 'auth'; perRow?: true } | null;
  /** A POST that writes nothing (a dry run), and why. */
  writesNothing?: string;
  summary: string;
}

const STATIC_ROUTES = {
  health: {
    method: 'GET',
    url: '/api/health',
    access: { kind: 'public', reason: 'liveness probe; no data' },
    audit: null,
    summary: 'Liveness and environment name',
  },
  'auth.login': {
    method: 'POST',
    url: '/api/auth/login',
    access: { kind: 'public', reason: 'sign-in step 1 (password)' },
    audit: { action: 'session.login_failed', by: 'auth' },
    summary: 'Verify email and password; always continues to a second factor',
  },
  'auth.totp.enroll': {
    method: 'POST',
    url: '/api/auth/mfa/totp/enroll',
    access: { kind: 'signin' },
    audit: null,
    summary: 'Start TOTP enrollment (only while the user has no factor)',
  },
  'auth.totp.enroll.verify': {
    method: 'POST',
    url: '/api/auth/mfa/totp/enroll/verify',
    access: { kind: 'signin' },
    audit: { action: 'mfa.enrolled', by: 'auth' },
    summary: 'Confirm TOTP enrollment with a code and sign in',
  },
  'auth.totp.verify': {
    method: 'POST',
    url: '/api/auth/mfa/totp/verify',
    access: { kind: 'signin' },
    audit: { action: 'session.login', by: 'auth' },
    summary: 'Second factor: authenticator code',
  },
  'auth.passkey.enroll.options': {
    method: 'POST',
    url: '/api/auth/mfa/passkey/enroll/options',
    access: { kind: 'signin' },
    audit: null,
    summary: 'WebAuthn registration options (only while the user has no factor)',
  },
  'auth.passkey.enroll.verify': {
    method: 'POST',
    url: '/api/auth/mfa/passkey/enroll/verify',
    access: { kind: 'signin' },
    audit: { action: 'mfa.enrolled', by: 'auth' },
    summary: 'Register a passkey and sign in',
  },
  'auth.passkey.options': {
    method: 'POST',
    url: '/api/auth/mfa/passkey/options',
    access: { kind: 'signin' },
    audit: null,
    summary: 'WebAuthn authentication options',
  },
  'auth.passkey.verify': {
    method: 'POST',
    url: '/api/auth/mfa/passkey/verify',
    access: { kind: 'signin' },
    audit: { action: 'session.login', by: 'auth' },
    summary: 'Second factor: passkey',
  },
  'auth.reauth.totp': {
    method: 'POST',
    url: '/api/auth/reauth/totp',
    access: { kind: 'session' },
    audit: { action: 'session.reauth', by: 'auth' },
    summary: 'Step-up with an authenticator code',
  },
  'auth.reauth.passkey.options': {
    method: 'POST',
    url: '/api/auth/reauth/passkey/options',
    access: { kind: 'session' },
    audit: null,
    summary: 'WebAuthn options for a step-up',
  },
  'auth.reauth.passkey.verify': {
    method: 'POST',
    url: '/api/auth/reauth/passkey/verify',
    access: { kind: 'session' },
    audit: { action: 'session.reauth', by: 'auth' },
    summary: 'Step-up with a passkey',
  },
  'auth.logout': {
    method: 'POST',
    url: '/api/auth/logout',
    access: { kind: 'session' },
    audit: { action: 'session.logout', by: 'auth' },
    summary: 'End the session',
  },
  me: {
    method: 'GET',
    url: '/api/me',
    access: { kind: 'session' },
    audit: null,
    summary: 'The signed-in user, roles, site scope, permissions, and CSRF token',
  },
  'me.navigation': {
    method: 'GET',
    url: '/api/me/navigation',
    access: { kind: 'session' },
    audit: null,
    summary: 'Launcher modules and pages the policy allows',
  },
  'readiness.instance.get': {
    method: 'GET',
    url: '/api/readiness/requirement-instances/:id',
    access: { kind: 'permission', permission: 'readiness:read', record: true },
    audit: null,
    summary: 'One requirement instance (site scope and record rules apply)',
  },
  'admin.roles.list': {
    method: 'GET',
    url: '/api/admin/users/:userAccountId/role-assignments',
    access: { kind: 'permission', permission: 'admin:read' },
    audit: null,
    summary: "A user's role grants within the caller's site scope",
  },
  'admin.roles.grant': {
    method: 'POST',
    url: '/api/admin/role-assignments',
    access: { kind: 'permission', permission: 'admin:write', recentAuth: true, record: true },
    audit: { action: 'role.grant' },
    summary: 'Grant a role (site scope, auditor end date, executive approval area)',
  },
  'admin.roles.revoke': {
    method: 'POST',
    url: '/api/admin/role-assignments/:id/revoke',
    access: { kind: 'permission', permission: 'admin:write', recentAuth: true, record: true },
    audit: { action: 'role.revoke' },
    summary: 'Revoke a role grant',
  },
  'admin.mfa.reset': {
    method: 'POST',
    url: '/api/admin/users/:userAccountId/mfa-reset',
    access: { kind: 'permission', permission: 'admin:write', recentAuth: true, record: true },
    audit: { action: 'mfa.reset' },
    summary: "Reset a user's MFA: revoke factors and sessions; enrollment at next sign-in",
  },
} as const satisfies Record<string, RouteSpec>;

export type StaticRouteId = keyof typeof STATIC_ROUTES;
/** Hand-written routes, plus one generated route per record type and action. */
export type RouteId = StaticRouteId | RecordRouteId;

export const ROUTES: Readonly<Record<RouteId, RouteSpec>> = {
  ...STATIC_ROUTES,
  ...RECORD_ROUTES,
};
export const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

export function routeSpec(id: RouteId): RouteSpec {
  const spec = ROUTES[id];
  if (!spec) throw new Error(`unknown route ${id}`);
  return spec;
}

/** Integration test cases each access kind requires. */
export const REQUIRED_CASES = {
  public: ['allowed'],
  signin: ['allowed', 'noPendingSignIn'],
  session: ['allowed', 'unauthenticated', 'otherTenant'],
  permission: ['allowed', 'deniedRole', 'otherSite', 'otherTenant'],
} as const;

type Spec<Id extends RouteId> = Id extends StaticRouteId ? (typeof STATIC_ROUTES)[Id] : RouteSpec;

export type RequiredCase<Id extends RouteId> =
  | (typeof REQUIRED_CASES)[Spec<Id>['access']['kind']][number]
  | (Spec<Id>['access'] extends { recentAuth: true } ? 'reauthRequired' : never);

export function requiredCases(id: RouteId): string[] {
  const access = routeSpec(id).access;
  const cases: string[] = [...REQUIRED_CASES[access.kind]];
  if (access.kind === 'permission' && access.recentAuth) cases.push('reauthRequired');
  return cases;
}
