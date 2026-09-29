import { z } from 'zod';
import {
  IsoDate,
  RecordMeta,
  RequirementId,
  SemVer,
  TenantScoped,
  Uuid,
  UtcTimestamp,
} from '../primitives.js';

/**
 * Modules reference requirements; they never define them. The catalog content
 * (titles, citations, cadence, applicability) lives in
 * `packages/requirements-catalog` and the global catalog tables (ADR-0003).
 */
export const RequirementRef = z.object({ requirementId: RequirementId }).strict();
export type RequirementRef = z.infer<typeof RequirementRef>;

/** A specific published version of a requirement, pinned to a catalog release. */
export const RequirementVersionRef = z
  .object({
    requirementId: RequirementId,
    requirementVersionId: Uuid,
    catalogVersion: SemVer,
  })
  .strict();
export type RequirementVersionRef = z.infer<typeof RequirementVersionRef>;

/** What a requirement instance is about (polymorphic; checked per type in the DB). */
export const RequirementSubjectType = z.enum(['organization', 'site', 'person', 'contract']);
export type RequirementSubjectType = z.infer<typeof RequirementSubjectType>;

/** Status recomputed from evidence by the shared readiness engine only. */
export const RequirementInstanceStatus = z.enum([
  'met',
  'due_soon',
  'overdue',
  'missing',
  'not_applicable',
  'not_assessed',
]);
export type RequirementInstanceStatus = z.infer<typeof RequirementInstanceStatus>;

/**
 * "Everything is a requirement instance." A credential expiring, a meeting
 * without quorum, and a contract missing a clause all resolve to one of these.
 */
export const RequirementInstance = TenantScoped.extend({
  id: Uuid,
  requirement: RequirementVersionRef,
  subjectType: RequirementSubjectType,
  subjectId: Uuid,
  /** Denormalized for site-scoped RBAC; null for organization-wide instances. */
  siteId: Uuid.nullable(),
  ownerPersonId: Uuid.nullable(),
  status: RequirementInstanceStatus,
  notApplicableReason: z.string().trim().min(1).nullable(),
  nextDueOn: IsoDate.nullable(),
  lastEvaluatedAt: UtcTimestamp.nullable(),
})
  .merge(RecordMeta)
  .strict()
  .superRefine((r, ctx) => {
    if (r.status === 'not_applicable' && r.notApplicableReason === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['notApplicableReason'],
        message: 'Not applicable needs a reason',
      });
    }
    if (r.status !== 'not_applicable' && r.notApplicableReason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['notApplicableReason'],
        message: 'Reason is only for not applicable',
      });
    }
  });
export type RequirementInstance = z.infer<typeof RequirementInstance>;
