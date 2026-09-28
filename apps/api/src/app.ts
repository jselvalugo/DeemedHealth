/**
 * Composition root of the API (ADR-0001, ADR-0010 section 1): `buildApp(deps)` knows
 * nothing about where it runs. `server.ts` listens on a port; the Netlify function
 * forwards Web requests through `adapters/fetch.ts`.
 *
 * Every request gets a context (request id, session, organization, principal). Routes
 * come only from the manifest; each one's access rule is enforced here before its
 * handler runs:
 *   public      nothing
 *   signin      the pending sign-in cookie (checked by packages/auth)
 *   session     a live session (idle, absolute, rotation), CSRF token on mutations
 *   permission  session + the role must hold the permission (deny by default) + step-up
 *               within 5 minutes when the route says so; record checks in the handler
 * Denials are audited with outcome = denied. Mutations must write an audit event in
 * their own transaction or they roll back. Errors use the stable model in errors.ts.
 */
import { randomUUID } from 'node:crypto';
import {
  AuthError,
  SESSION_POLICY,
  ipPrefix,
  isUuid,
  safeEqual,
  type ActiveSession,
} from '@deemed/auth';
import { appendAuditEvent, type Actor } from '@deemed/db';
import {
  activeRoleIds,
  auditsEveryView,
  authorize,
  siteScope,
  type Permission,
  type PolicyContext,
  type RoleId,
} from '@deemed/domain';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { chainSeq, deniedEvent } from './audit.js';
import type { AppServices, Handler, Helpers, RequestContext } from './context.js';
import { clearCookie, cookieNames, readCookie, serializeCookie } from './cookies.js';
import { ApiError, DeniedError, STATUS, errorBody } from './errors.js';
import { ROUTES, ROUTE_IDS, routeSpec, type RouteId, type RouteSpec } from './manifest.js';
import { loadPrincipal } from './principal.js';
import { adminHandlers } from './routes/admin.js';
import { authHandlers } from './routes/auth.js';
import { meHandlers } from './routes/me.js';
import { recordHandlers } from './records/handlers.js';
import { readinessHandlers } from './routes/readiness.js';

export interface RateLimitOptions {
  /** Requests per minute per client address, every route (default 300). */
  globalPerMinute?: number;
  /** Requests per minute per client address on sign-in and step-up routes (default 30). */
  signinPerMinute?: number;
}

export interface BuildAppOptions extends AppServices {
  /** Fastify logger options; false in tests. Never logs bodies, cookies, or addresses. */
  logger?: FastifyServerOptions['logger'];
  rateLimit?: RateLimitOptions;
  /**
   * Which proxies may set X-Forwarded-For (Fastify trustProxy). Default false: the
   * socket address is the client. On AWS, the ALB subnets (CIDRs).
   */
  trustProxy?: boolean | string | string[];
}

export const RATE_LIMIT_DEFAULTS = { globalPerMinute: 300, signinPerMinute: 30 } as const;

/** Routes that take a password or a second factor get the tighter limit. */
function isSigninStep(spec: RouteSpec, id: RouteId): boolean {
  return spec.access.kind === 'signin' || id === 'auth.login' || id.startsWith('auth.reauth.');
}

const HANDLERS: Record<RouteId, Handler> = {
  ...meHandlers,
  ...authHandlers,
  ...readinessHandlers,
  ...adminHandlers,
  ...recordHandlers(),
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SIGNIN_COOKIE_SECONDS = SESSION_POLICY.loginAttemptSeconds;

function userActor(s: ActiveSession): Actor {
  return { type: 'user', userId: s.userAccountId, personId: s.personId, label: s.displayName };
}

function zodFields(error: ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.path.join('.') || '(body)'))];
}

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const services: AppServices = {
    database: options.database,
    auth: options.auth,
    clock: options.clock,
    dhEnv: options.dhEnv,
    allowedOrigins: options.allowedOrigins,
    secureCookies: options.secureCookies,
    ...(options.fieldCipher ? { fieldCipher: options.fieldCipher } : {}),
  };
  const names = cookieNames(services.secureCookies);

  const limits = { ...RATE_LIMIT_DEFAULTS, ...options.rateLimit };
  const app = Fastify({
    logger: options.logger ?? false,
    // No per-request log lines from Fastify (they carry the client address); the
    // onResponse hook below logs request id, route id, status, and duration only.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: options.trustProxy ?? false,
    bodyLimit: 256 * 1024,
    // The correlation id: a caller-supplied UUID (from apps/web) or a new one.
    genReqId: (req) => {
      const given = req.headers['x-request-id'];
      const value = Array.isArray(given) ? given[0] : given;
      return value && isUuid(value.toLowerCase()) ? value.toLowerCase() : randomUUID();
    },
  });

  app.decorateRequest('ctx', null as unknown as RequestContext);

  // Per client network (after trustProxy): the IPv4 address or the IPv6 /64, the same
  // key sign-in throttling uses, so rotating addresses inside one /64 buys nothing.
  // Counters live in this process's memory: a shared store (e.g. Redis) is required
  // before production runs more than one API task (ADR-0006 open items; phase-1-plan S9).
  // Routes must be registered after this plugin has loaded, or they would not get their
  // per-route limit: see registerRoutes below.
  void app.register(rateLimit, {
    global: true,
    max: limits.globalPerMinute,
    timeWindow: 60_000,
    keyGenerator: (req) => ipPrefix(req.ip),
    errorResponseBuilder: () => new ApiError('too_many_attempts'),
  });

  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        requestId: req.id,
        routeId: req.ctx?.routeId ?? null,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  app.addHook('onRequest', async (req, reply) => {
    const routeId = req.routeOptions.config.routeId ?? null;
    req.ctx = {
      requestId: req.id,
      routeId,
      meta: {
        requestId: req.id,
        ip: req.ip,
        userAgent: (headerValue(req, 'user-agent') ?? '').slice(0, 512),
      },
      session: null,
      principal: null,
      approvalAreas: {},
      organizationName: null,
    };
    reply.header('x-request-id', req.id);
    reply.header('cache-control', 'no-store');
  });

  const policyContext = (ctx: RequestContext): PolicyContext => ({
    now: services.clock.now(),
    approvalAreas: ctx.approvalAreas,
  });

  /** Origin and fetch-metadata checks on every mutation (ADR-0010 section 1). */
  function checkOrigin(req: FastifyRequest): void {
    if (!MUTATING.has(req.method)) return;
    const site = headerValue(req, 'sec-fetch-site');
    if (site === 'cross-site') throw new ApiError('csrf_failed');
    const origin = headerValue(req, 'origin');
    if (origin !== undefined && !services.allowedOrigins.includes(origin)) {
      throw new ApiError('csrf_failed');
    }
  }

  async function authenticate(req: FastifyRequest, reply: FastifyReply, spec: RouteSpec) {
    const ctx = req.ctx;
    const token = readCookie(req.headers.cookie, names.session);
    let session: ActiveSession;
    try {
      session = await services.auth.authenticate(token, ctx.meta, {
        rotate: MUTATING.has(req.method),
      });
    } catch (error) {
      if (error instanceof AuthError && token)
        reply.header('set-cookie', clearCookie(names.session, services.secureCookies));
      throw error;
    }
    ctx.session = session;
    if (session.rotated) {
      reply.header(
        'set-cookie',
        serializeCookie(names.session, session.token, {
          maxAgeSeconds:
            (session.absoluteExpiresAt.getTime() - services.clock.now().getTime()) / 1000,
          secure: services.secureCookies,
        }),
      );
    }
    if (MUTATING.has(req.method)) {
      // Per-session CSRF token (stable across rotation), plus the origin check above.
      const presented = headerValue(req, 'x-csrf-token') ?? '';
      if (!safeEqual(presented, session.csrfToken)) throw new ApiError('csrf_failed');
    }
    const bundle = await services.database.withTenant(
      session.organizationId,
      userActor(session),
      (tx) => loadPrincipal(tx, session),
      { requestId: ctx.requestId },
    );
    ctx.principal = bundle.principal;
    ctx.approvalAreas = bundle.approvalAreas;
    ctx.organizationName = bundle.organizationName;

    if (spec.access.kind === 'permission') {
      const decision = authorize(
        bundle.principal,
        spec.access.permission,
        undefined,
        policyContext(ctx),
      );
      if (!decision.allowed) throw new DeniedError(decision.reason);
      if (spec.access.recentAuth && !services.auth.hasRecentAuth(session)) {
        throw new DeniedError('reauth_required');
      }
    }
  }

  function helpers(req: FastifyRequest, reply: FastifyReply, spec: RouteSpec): Helpers {
    const ctx = req.ctx;
    const session = () => {
      if (!ctx.session) throw new ApiError('unauthenticated');
      return ctx.session;
    };
    const principal = () => {
      if (!ctx.principal) throw new ApiError('unauthenticated');
      return ctx.principal;
    };
    const parse = <T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T => {
      const result = schema.safeParse(value ?? {});
      if (!result.success) throw new ApiError('bad_request', zodFields(result.error));
      return result.data;
    };
    const mutation =
      MUTATING.has(spec.method) &&
      spec.audit !== null &&
      spec.audit.by !== 'auth' &&
      spec.audit.perRow !== true;
    // Routes marked `record` must check the record itself (site scope, ownership, the
    // executive approval area) before their transaction commits.
    const needsRecordCheck = spec.access.kind === 'permission' && spec.access.record === true;
    let recordChecked = false;
    let noChange = false;
    const setCookie = (value: string) => {
      const existing = reply.getHeader('set-cookie');
      const list =
        existing === undefined
          ? []
          : Array.isArray(existing)
            ? existing.map(String)
            : [String(existing)];
      reply.header('set-cookie', [...list, value]);
    };
    const h: Helpers = {
      ctx,
      spec,
      services,
      now: () => services.clock.now(),
      body: (schema) => parse(schema, req.body),
      params: (schema) => parse(schema, req.params),
      cookie: (name) => readCookie(req.headers.cookie, names[name]),
      session,
      principal,
      async tenant(fn) {
        const s = session();
        const p = principal();
        const now = services.clock.now();
        return services.database.withTenant(
          s.organizationId,
          userActor(s),
          async (tx, txCtx) => {
            const before = mutation ? await chainSeq(tx, s.organizationId) : 0;
            const result = await fn(tx, txCtx);
            if (mutation && !noChange && (await chainSeq(tx, s.organizationId)) === before) {
              throw new Error('audit middleware: a mutation wrote no audit event');
            }
            if (needsRecordCheck && !recordChecked) {
              throw new Error('policy middleware: a record route never authorized its record');
            }
            return result;
          },
          {
            requestId: ctx.requestId,
            siteIds: siteScope(p, now) ?? [],
            roles: activeRoleIds(p, now),
          },
        );
      },
      allowed: (permission: Permission, resource) =>
        authorize(
          principal(),
          permission,
          { organizationId: session().organizationId, ...resource },
          policyContext(ctx),
        ).allowed,
      authorize(permission, resource, target) {
        const decision = authorize(
          principal(),
          permission,
          { organizationId: session().organizationId, ...resource },
          policyContext(ctx),
        );
        if (!decision.allowed) throw new DeniedError(decision.reason, target);
        recordChecked = true;
      },
      decide(permission, resource, decideOptions) {
        const p = principal();
        const only = decideOptions?.onlyRoles;
        const scoped = only
          ? { ...p, grants: p.grants.filter((g) => only.includes(g.roleId as RoleId)) }
          : p;
        return authorize(
          scoped,
          permission,
          resource ? { organizationId: session().organizationId, ...resource } : undefined,
          policyContext(ctx),
        );
      },
      markRecordChecked() {
        recordChecked = true;
      },
      declareNoChange() {
        noChange = true;
      },
      recentAuth: () => services.auth.hasRecentAuth(session()),
      async recordListView(tx, txCtx, table, ids) {
        if (!auditsEveryView(principal(), services.clock.now())) return;
        await appendAuditEvent(tx, txCtx, {
          category: 'auth',
          action: 'access.view',
          targetTable: table,
          ipAddress: ctx.meta.ip,
          userAgent: ctx.meta.userAgent || 'unknown',
          sessionId: session().id,
          metadata: { route: ctx.routeId ?? 'unknown', ids: [...ids], count: ids.length },
        });
      },
      async recordView(tx, txCtx, target) {
        if (!auditsEveryView(principal(), services.clock.now())) return;
        await appendAuditEvent(tx, txCtx, {
          category: 'auth',
          action: 'access.view',
          targetTable: target.table,
          targetId: target.id,
          ...(target.siteId ? { siteId: target.siteId } : {}),
          ipAddress: ctx.meta.ip,
          userAgent: ctx.meta.userAgent || 'unknown',
          sessionId: session().id,
          metadata: { route: ctx.routeId ?? 'unknown' },
        });
      },
      setSessionCookie(token, absoluteExpiresAt) {
        setCookie(
          serializeCookie(names.session, token, {
            maxAgeSeconds: (absoluteExpiresAt.getTime() - services.clock.now().getTime()) / 1000,
            secure: services.secureCookies,
          }),
        );
      },
      clearSessionCookie: () => setCookie(clearCookie(names.session, services.secureCookies)),
      setSigninCookie: (token) =>
        setCookie(
          serializeCookie(names.signin, token, {
            maxAgeSeconds: SIGNIN_COOKIE_SECONDS,
            secure: services.secureCookies,
          }),
        ),
      clearSigninCookie: () => setCookie(clearCookie(names.signin, services.secureCookies)),
    };
    return h;
  }

  const registerRoutes = async (scope: FastifyInstance) => {
    for (const id of ROUTE_IDS) {
      const spec = routeSpec(id);
      const handler = HANDLERS[id];
      if (!handler) throw new Error(`route ${id} has no handler`);
      scope.route({
        method: spec.method,
        url: spec.url,
        config: {
          routeId: id,
          ...(isSigninStep(spec, id)
            ? { rateLimit: { max: limits.signinPerMinute, timeWindow: 60_000 } }
            : {}),
        },
        preHandler: async (req, reply) => {
          req.ctx.routeId = id;
          checkOrigin(req);
          if (spec.access.kind === 'session' || spec.access.kind === 'permission') {
            await authenticate(req, reply, spec);
          }
        },
        handler: async (req, reply) => {
          const result = await handler(req, reply, helpers(req, reply, spec));
          return result ?? reply.send();
        },
      });
    }
  };

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(errorBody('not_found', req.id));
  });

  app.setErrorHandler(async (error: FastifyError | Error, req, reply) => {
    let apiError: ApiError;
    if (error instanceof ApiError) apiError = error;
    else if (error instanceof AuthError) apiError = new ApiError(error.code);
    else if (error instanceof ZodError) apiError = new ApiError('bad_request', zodFields(error));
    else if ((error as FastifyError).statusCode === 413)
      apiError = new ApiError('payload_too_large');
    else if (
      (error as FastifyError).statusCode &&
      ((error as FastifyError).statusCode as number) < 500
    ) {
      apiError = new ApiError('bad_request');
    } else {
      apiError = new ApiError('internal');
      // Name and SQLSTATE only: messages and stacks can carry values (never logged).
      req.log.error(
        {
          err: { name: error.name, code: (error as { code?: string }).code ?? null },
          routeId: req.ctx?.routeId,
        },
        'request failed',
      );
    }

    const ctx = req.ctx;
    if (apiError instanceof DeniedError && ctx?.session) {
      const s = ctx.session;
      const spec = ctx.routeId ? ROUTES[ctx.routeId] : undefined;
      try {
        await services.database.withTenant(
          s.organizationId,
          userActor(s),
          (tx, txCtx) =>
            appendAuditEvent(
              tx,
              txCtx,
              deniedEvent(ctx.routeId, spec, apiError as DeniedError, {
                ip: ctx.meta.ip,
                userAgent: ctx.meta.userAgent,
                sessionId: s.id,
              }),
            ),
          { requestId: ctx.requestId },
        );
      } catch (auditError) {
        req.log.error(
          {
            err: {
              name: (auditError as Error).name,
              code: (auditError as { code?: string }).code ?? null,
            },
          },
          'denied-attempt audit failed',
        );
      }
    }
    reply
      .status(STATUS[apiError.code])
      .send(errorBody(apiError.code, req.id, apiError.fields, apiError.currentVersion));
  });

  // After the rate-limit plugin (plugin order is preserved), so every route gets both
  // the global and its own limit.
  void app.register(registerRoutes);

  return app;
}
