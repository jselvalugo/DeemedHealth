import { z } from 'zod';
import { TenantScoped, Uuid, UtcTimestamp } from '../primitives.js';
import { RoleIdSchema } from '../permissions.js';

export const ApprovalDecision = z.enum(['approved', 'rejected']);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/**
 * An explicit, human approval. It records the approver, the role they acted in,
 * when, why, and the exact version of the object approved. Only humans approve:
 * `approverType` is the literal `user`, so a service or AI actor cannot produce one
 * (product principle 2). Approvals are immutable; a changed mind is a new record.
 */
export const Approval = TenantScoped.extend({
  id: Uuid,
  workflowRunId: Uuid.nullable(),
  subjectTable: z.string().regex(/^[a-z][a-z0-9_]*$/),
  subjectId: Uuid,
  /** Version (e.g. `evidence_version.version_no` or row version) approved. */
  subjectVersion: z.number().int().min(1),
  approverType: z.literal('user'),
  approverPersonId: Uuid,
  approverRole: RoleIdSchema,
  decision: ApprovalDecision,
  reason: z.string().trim().min(1).max(4000),
  decidedAt: UtcTimestamp,
}).strict();
export type Approval = z.infer<typeof Approval>;
