/**
 * Per-request context (request id, session, organization, principal) and the helpers a
 * route handler receives. Handlers never open a database connection themselves: they
 * call `h.tenant()`, which runs `withTenant` as the signed-in user.
 */
import type { ActiveSession, AuthService, Clock, RequestMeta } from '@deemed/auth';
import type { Database, TransactionContext, Tx } from '@deemed/db';
import type {
  ApprovalAreas,
  Decision,
  Permission,
  Principal,
  ResourceRef,
  RoleId,
} from '@deemed/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType, ZodTypeDef } from 'zod';
import type { DenialTarget } from './errors.js';
import type { RouteId, RouteSpec } from './manifest.js';

export interface RequestContext {
  requestId: string;
  routeId: RouteId | null;
  meta: RequestMeta;
  session: ActiveSession | null;
  principal: Principal | null;
  approvalAreas: ApprovalAreas;
  organizationName: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext;
  }
  interface FastifyContextConfig {
    routeId?: RouteId;
  }
}

/**
 * Decrypts a field-encrypted value for an audited reveal (ADR-0007). The real adapter
 * (envelope AES-256-GCM, AAD = organization, table, column, record id) arrives with
 * packages/crypto in S6; until then a stored ciphertext cannot be revealed and the API
 * answers 503 not_configured. Tests inject a fake.
 */
export interface FieldCipher {
  decrypt(
    ref: { organizationId: string; table: string; column: string; recordId: string },
    ciphertext: Buffer,
  ): Promise<string>;
}

export interface AppServices {
  database: Database;
  auth: AuthService;
  clock: Clock;
  dhEnv: string;
  allowedOrigins: readonly string[];
  secureCookies: boolean;
  fieldCipher?: FieldCipher;
  /**
   * S4: resolves when DH_ENV agrees with the database's catalog channel; rejects with
   * CatalogChannelMismatchError when it does not. Checked before any signed-in request.
   */
  ensureCatalogChannel?: () => Promise<void>;
}

export interface Helpers {
  readonly ctx: RequestContext;
  readonly spec: RouteSpec;
  readonly services: AppServices;
  now(): Date;
  body<T>(schema: ZodType<T, ZodTypeDef, unknown>): T;
  params<T>(schema: ZodType<T, ZodTypeDef, unknown>): T;
  cookie(name: 'session' | 'signin'): string | undefined;
  session(): ActiveSession;
  principal(): Principal;
  /** Runs fn in one tenant transaction as the signed-in user (RLS, audit actor). */
  tenant<T>(fn: (tx: Tx, txCtx: TransactionContext) => Promise<T>): Promise<T>;
  /** Record-level policy check without side effects (for filtering lists). */
  allowed(permission: Permission, resource: Omit<ResourceRef, 'organizationId'>): boolean;
  /** Record-level policy check; throws an audited DeniedError. */
  authorize(
    permission: Permission,
    resource: Omit<ResourceRef, 'organizationId'>,
    target: DenialTarget,
  ): void;
  /**
   * The policy decision without side effects; `onlyRoles` limits it to grants of those
   * roles (a field's reveal roles). Omit the resource for a module-level check.
   */
  decide(
    permission: Permission,
    resource?: Omit<ResourceRef, 'organizationId'>,
    options?: { onlyRoles?: readonly RoleId[] },
  ): Decision;
  /** The handler authorized its record(s) itself (with `decide`), for `record` routes. */
  markRecordChecked(): void;
  /**
   * The mutation changed nothing on purpose (a no-op update, a bulk request whose rows all
   * failed), so the audit middleware may commit without an event.
   */
  declareNoChange(): void;
  /** Step-up within the last 5 minutes (ADR-0006 rule 5). */
  recentAuth(): boolean;
  /** Auditor-style roles: log the view of a record (module map "Every view is logged"). */
  recordView(tx: Tx, txCtx: TransactionContext, target: DenialTarget): Promise<void>;
  /** Auditor-style roles: log a list view with the returned ids (ADR-0014 section 2.9). */
  recordListView(
    tx: Tx,
    txCtx: TransactionContext,
    table: string,
    ids: readonly string[],
  ): Promise<void>;
  setSessionCookie(token: string, absoluteExpiresAt: Date): void;
  clearSessionCookie(): void;
  setSigninCookie(token: string): void;
  clearSigninCookie(): void;
}

export type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  h: Helpers,
) => Promise<unknown>;
