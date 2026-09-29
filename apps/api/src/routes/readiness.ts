/**
 * The first record endpoint, so the four authorization tests exercise a real site-scoped
 * record: one requirement instance. The HRSA Readiness module itself ships in S4.
 */
import { schema } from '@deemed/db';
import type { RequirementInstanceView } from '@deemed/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Handler } from '../context.js';
import { ApiError } from '../errors.js';
import type { RouteId } from '../manifest.js';

const IdParams = z.object({ id: z.string().uuid() });

export const readinessHandlers = {
  'readiness.instance.get': async (_req, _reply, h): Promise<RequirementInstanceView> => {
    const { id } = h.params(IdParams);
    return h.tenant(async (tx, txCtx) => {
      const row = (
        await tx
          .select()
          .from(schema.requirementInstance)
          .where(eq(schema.requirementInstance.id, id))
          .limit(1)
      )[0];
      // RLS hides other tenants' rows: "not found", never "forbidden".
      if (!row || row.archivedAt) throw new ApiError('not_found');
      const owners = [
        row.ownerPersonId,
        row.subjectType === 'person' ? row.subjectId : null,
      ].filter((v): v is string => v !== null);
      const target = { table: 'requirement_instance', id: row.id, siteId: row.siteId };
      h.authorize('readiness:read', { siteId: row.siteId, ownerPersonIds: owners }, target);
      await h.recordView(tx, txCtx, target);
      return {
        id: row.id,
        requirementId: row.requirementId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        siteId: row.siteId,
        ownerPersonId: row.ownerPersonId,
        status: row.status,
        nextDueOn: row.nextDueOn,
      };
    });
  },
} satisfies Partial<Record<RouteId, Handler>>;
