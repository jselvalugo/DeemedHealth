/**
 * Audit schema (ADR-0008). Rows are written only by the SQL function
 * audit.append_event (see appendAuditEvent); app_user can read but never
 * insert, update, delete, or truncate.
 */
import {
  bigint,
  inet,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, timestamptz } from './columns.js';

export const auditSchema = pgSchema('audit');

export const AUDIT_CATEGORIES = [
  'auth',
  'mutation',
  'reveal',
  'export',
  'approval',
  'permission',
  'integration',
  'system',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_OUTCOMES = ['success', 'denied', 'failure'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const ACTOR_TYPES = ['user', 'service', 'integration', 'system', 'break_glass'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const actionRegistry = auditSchema.table('action_registry', {
  action: text('action').primaryKey(),
  category: text('category', { enum: AUDIT_CATEGORIES }).notNull(),
  description: text('description').notNull(),
});

export const auditEvent = auditSchema.table(
  'audit_event',
  {
    id: uuid('id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    chainSeq: bigint('chain_seq', { mode: 'number' }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    category: text('category', { enum: AUDIT_CATEGORIES }).notNull(),
    action: text('action').notNull(),
    outcome: text('outcome', { enum: AUDIT_OUTCOMES }).notNull(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorPersonId: uuid('actor_person_id'),
    actorUserId: uuid('actor_user_id'),
    actorLabel: text('actor_label').notNull(),
    onBehalfOfId: uuid('on_behalf_of_id'),
    sessionId: uuid('session_id'),
    requestId: uuid('request_id'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    siteId: uuid('site_id'),
    targetTable: text('target_table'),
    targetId: uuid('target_id'),
    requirementIds: text('requirement_ids').array(),
    reason: text('reason'),
    diff: jsonb('diff'),
    metadata: jsonb('metadata').notNull().default({}),
    schemaVersion: smallint('schema_version').notNull(),
    prevHash: bytea('prev_hash').notNull(),
    rowHash: bytea('row_hash').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.occurredAt, t.id] }),
    unique().on(t.organizationId, t.chainSeq, t.occurredAt),
  ],
);

export const chainHead = auditSchema.table('chain_head', {
  organizationId: uuid('organization_id').primaryKey(),
  chainSeq: bigint('chain_seq', { mode: 'number' }).notNull(),
  rowHash: bytea('row_hash').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});
