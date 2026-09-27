/**
 * Per-request context (request id, session, organization, principal) and the helpers a
 * route handler receives. Handlers never open a database connection themselves: they
 * call `h.tenant()`, which runs `withTenant` as the signed-in user.
 */
import type { ActiveSession, AuthService, Clock, RequestMeta } from '@deemed/auth';
import type { Database, TransactionContext, Tx } from '@deemed/db';
import type { ApprovalAreas, Permission, Principal, ResourceRef } from '@deemed/domain';
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

export interface AppServices {
  database: Database;
  auth: AuthService;
  clock: Clock;
  dhEnv: string;
  allowedOrigins: readonly string[];
  secureCookies: boolean;
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
  /** Auditor-style roles: log the view of a record (module map "Every view is logged"). */
  recordView(tx: Tx, txCtx: TransactionContext, target: DenialTarget): Promise<void>;
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
