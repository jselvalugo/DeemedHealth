/**
 * HRSA Readiness endpoints (S4). Reads go through the records framework; these are the
 * readiness decisions people make, each checked by the policy engine on the record
 * (site scope), audited in the same transaction, and followed by a recompute job
 * enqueued in that transaction (packages/readiness service):
 *
 *  - mark / clear "not applicable" on a requirement instance (reason required, only where
 *    the catalog allows; If-Match row version);
 *  - set the health center's value for a bounded catalog parameter (organization-wide, so
 *    it needs an organization-wide grant).
 *
 * Statuses are internal readiness, never an HRSA determination.
 */
import { schema } from '@deemed/db';
import { containsSsnShape, type RequirementInstanceView } from '@deemed/domain';
import {
  ReadinessError,
  clearNotApplicable,
  loadInstance,
  markNotApplicable,
  setTenantParameter,
  type InstanceRef,
} from '@deemed/readiness/service';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Handler, Helpers } from '../context.js';
import { ApiError } from '../errors.js';
import type { RouteId } from '../manifest.js';
import { digestOf, ifMatch } from '../records/http.js';

const IdParams = z.object({ id: z.string().uuid() });
/** Free text: 1 to 2000 characters, never SSN-shaped (D1; the error names the field only). */
const Reason = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => !containsSsnShape(v), 'ssn_shaped');
const ReasonBody = z.object({ reason: Reason }).strict();
const ParameterBody = z
  .object({
    requirementId: z.string().regex(/^[A-Z0-9]+(-[A-Za-z0-9&]+)+$/),
    key: z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/),
    value: z.number().int(),
    reason: Reason,
  })
  .strict();

/** Service errors to the stable API model (codes only, never messages). */
function apiError(error: unknown): never {
  if (!(error instanceof ReadinessError)) throw error;
  switch (error.code) {
    case 'not_found':
      throw new ApiError('not_found');
    case 'version_conflict':
      throw new ApiError('version_conflict', [], error.currentVersion);
    case 'human_actor_required':
    case 'actor_not_allowed':
      throw new ApiError('forbidden');
    case 'already_not_applicable':
    case 'not_marked_not_applicable':
    case 'no_catalog_release':
    case 'not_in_catalog':
      throw new ApiError('conflict', [...error.fields]);
    default:
      throw new ApiError('bad_request', error.fields.length ? [...error.fields] : ['reason']);
  }
}

function owners(i: InstanceRef): string[] {
  return [i.ownerPersonId, i.subjectType === 'person' ? i.subjectId : null].filter(
    (v): v is string => v !== null,
  );
}

async function naChange(
  h: Helpers,
  reply: FastifyReply,
  expected: number,
  id: string,
  reason: string,
  change: typeof markNotApplicable,
) {
  return h.tenant(async (tx, txCtx) => {
    try {
      const inst = await loadInstance(tx, id);
      h.authorize(
        'readiness:write',
        { siteId: inst.siteId, ownerPersonIds: owners(inst) },
        { table: 'requirement_instance', id: inst.id, siteId: inst.siteId },
      );
      const out = await change(tx, txCtx, {
        instanceId: id,
        reason,
        expectedRowVersion: expected,
        digest: digestOf(h),
      });
      const row = (
        await tx
          .select({ status: schema.requirementInstance.status })
          .from(schema.requirementInstance)
          .where(eq(schema.requirementInstance.id, id))
      )[0];
      void reply.header('etag', `"${out.rowVersion}"`);
      return {
        id,
        requirementId: inst.requirementId,
        status: row?.status ?? null,
        rowVersion: out.rowVersion,
        recomputeQueued: true,
      };
    } catch (error) {
      return apiError(error);
    }
  });
}

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

  'readiness.instance.not_applicable': async (req, reply, h) => {
    const { id } = h.params(IdParams);
    const { reason } = h.body(ReasonBody);
    return naChange(h, reply, ifMatch(req), id, reason, markNotApplicable);
  },

  'readiness.instance.clear_not_applicable': async (req, reply, h) => {
    const { id } = h.params(IdParams);
    const { reason } = h.body(ReasonBody);
    return naChange(h, reply, ifMatch(req), id, reason, clearNotApplicable);
  },

  'readiness.parameter.set': async (_req, reply, h) => {
    const body = h.body(ParameterBody);
    return h.tenant(async (tx, txCtx) => {
      // A health-center parameter applies to every site: an organization-wide grant only.
      h.authorize(
        'readiness:write',
        { siteId: null },
        { table: 'tenant_parameter', id: txCtx.organizationId as string },
      );
      try {
        const out = await setTenantParameter(tx, txCtx, { ...body, digest: digestOf(h) });
        if (out.jobId === null) h.declareNoChange();
        void reply.header('etag', `"${out.rowVersion}"`);
        return {
          id: out.id,
          requirementId: body.requirementId,
          key: body.key,
          value: out.value,
          rowVersion: out.rowVersion,
          recomputeQueued: out.jobId !== null,
        };
      } catch (error) {
        return apiError(error);
      }
    });
  },
} satisfies Partial<Record<RouteId, Handler>>;
