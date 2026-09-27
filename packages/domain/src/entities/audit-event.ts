import { z } from 'zod';
import { RequirementId, Sha256Hex, Uuid, UtcTimestamp } from '../primitives.js';
import {
  AUDIT_CATEGORY_REQUIREMENTS,
  AuditActionSchema,
  AuditCategorySchema,
  DENIABLE_CATEGORIES,
  categoryOf,
} from '../audit-actions.js';

/** ADR-0008 §1. */
export const AuditOutcome = z.enum(['success', 'denied', 'failure']);
export type AuditOutcome = z.infer<typeof AuditOutcome>;

export const AuditActorType = z.enum(['user', 'service', 'integration', 'system', 'break_glass']);
export type AuditActorType = z.infer<typeof AuditActorType>;

/** Redacted value forms (ADR-0008 §5). Plain values are allowed only for non-encrypted columns. */
export const EncryptedRef = z
  .object({ ref: z.string().regex(/^enc:v\d+:[0-9a-f]+$/), changed: z.boolean() })
  .strict();
export const RedactedText = z
  .object({ redacted: z.literal(true), length: z.number().int().nonnegative(), sha256: Sha256Hex })
  .strict();

/** Only the columns that changed. Redaction happens in the audit middleware before this. */
export const AuditDiff = z
  .object({
    fields: z.record(
      z.string().regex(/^[a-z][a-z0-9_]*$/),
      z.object({ before: z.unknown(), after: z.unknown() }).strict(),
    ),
  })
  .strict();
export type AuditDiff = z.infer<typeof AuditDiff>;

/**
 * What a caller hands to `audit.append_event`. The database assigns `id`,
 * `chainSeq`, `occurredAt`, `schemaVersion`, `prevHash`, and `rowHash`.
 */
const AuditEventInputShape = z.object({
  organizationId: Uuid,
  category: AuditCategorySchema,
  action: AuditActionSchema,
  outcome: AuditOutcome,
  actorType: AuditActorType,
  actorPersonId: Uuid.nullable(),
  actorUserId: Uuid.nullable(),
  actorLabel: z.string().min(1).max(200),
  /** The human on whose behalf a service (e.g. the AI assistant) acted. */
  onBehalfOfId: Uuid.nullable(),
  sessionId: Uuid.nullable(),
  requestId: Uuid.nullable(),
  ipAddress: z.string().ip().nullable(),
  userAgent: z.string().max(1000).nullable(),
  siteId: Uuid.nullable(),
  targetTable: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .nullable(),
  targetId: Uuid.nullable(),
  requirementIds: z.array(RequirementId),
  reason: z.string().trim().min(1).max(4000).nullable(),
  diff: AuditDiff.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

type AuditRuleInput = z.infer<typeof AuditEventInputShape>;

function checkAuditRules(e: AuditRuleInput, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });

  if (categoryOf(e.action) !== e.category) {
    issue('category', `action ${e.action} is registered as ${categoryOf(e.action)}`);
  }
  if (e.outcome === 'denied' && !DENIABLE_CATEGORIES.includes(e.category)) {
    issue('outcome', `${e.category} events are not logged as denied`);
  }
  const req = AUDIT_CATEGORY_REQUIREMENTS[e.category];
  if (req.target && (e.targetTable === null || e.targetId === null)) {
    issue('targetId', `${e.category} events need a target`);
  }
  if (req.diff && e.outcome === 'success' && e.diff === null) {
    issue('diff', `${e.category} events need a diff`);
  }
  if (req.reason && e.reason === null) {
    issue('reason', `${e.category} events need a reason`);
  }
  if (req.network && (e.ipAddress === null || e.userAgent === null)) {
    issue('ipAddress', `${e.category} events need an IP address and user agent`);
  }
  if (e.actorType === 'user' && e.actorUserId === null) {
    issue('actorUserId', 'user actors need an actorUserId');
  }
  // Product principle 2: only humans approve. AI and other services never produce approvals.
  if (e.category === 'approval' && e.actorType !== 'user') {
    issue('actorType', 'approval events are produced by human users only');
  }
  if (e.actorType === 'service' && e.onBehalfOfId === null) {
    issue('onBehalfOfId', 'service actions record the human they act for');
  }
}

export const AuditEventInput = AuditEventInputShape.strict().superRefine(checkAuditRules);
export type AuditEventInput = z.infer<typeof AuditEventInput>;

/** A stored `audit.audit_event` row (ADR-0008 §1), camelCased. */
export const AuditEvent = AuditEventInputShape.extend({
  id: Uuid,
  chainSeq: z.number().int().min(1),
  occurredAt: UtcTimestamp,
  schemaVersion: z.number().int().min(1),
  prevHash: Sha256Hex,
  rowHash: Sha256Hex,
})
  .strict()
  .superRefine(checkAuditRules);
export type AuditEvent = z.infer<typeof AuditEvent>;
