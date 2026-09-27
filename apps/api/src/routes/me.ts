/**
 * The signed-in user and their launcher. Navigation is computed by the same policy
 * engine the API enforces with, from the module registry, so the launcher never shows
 * a page the API would refuse.
 */
import {
  activeRoleIds,
  effectivePermissions,
  navigationFor,
  siteScope,
  type HealthResponse,
  type MeResponse,
  type NavigationResponse,
} from '@deemed/domain';
import { MODULES } from '@deemed/ui/module-registry';
import type { Handler } from '../context.js';
import type { RouteId } from '../manifest.js';

export const meHandlers = {
  health: async (_req, _reply, h): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'api',
    environment: h.services.dhEnv,
  }),

  me: async (_req, _reply, h): Promise<MeResponse> => {
    const s = h.session();
    const p = h.principal();
    const now = h.now();
    const idle = new Date(s.lastSeenAt.getTime() + s.idleTimeoutSeconds * 1000);
    return {
      user: {
        userAccountId: s.userAccountId,
        personId: s.personId,
        displayName: s.displayName,
        email: s.email,
      },
      organization: { id: s.organizationId, name: h.ctx.organizationName ?? '' },
      roles: activeRoleIds(p, now),
      siteIds: siteScope(p, now) as string[] | null,
      permissions: [...effectivePermissions(p, now)].sort(),
      session: {
        expiresAt: s.absoluteExpiresAt.toISOString(),
        idleExpiresAt: (idle < s.absoluteExpiresAt ? idle : s.absoluteExpiresAt).toISOString(),
        mfaMethod: s.mfaMethod,
        reauthenticatedAt: s.reauthAt.toISOString(),
      },
      csrfToken: s.csrfToken,
    };
  },

  'me.navigation': async (_req, _reply, h): Promise<NavigationResponse> => ({
    modules: navigationFor(h.principal(), MODULES, h.now()).map((m) => ({
      id: m.id,
      pages: m.pages.map((p) => ({ id: p.id, route: p.route })),
    })),
  }),
} satisfies Partial<Record<RouteId, Handler>>;
