import { z } from 'zod';
import { RECORD_AUDIT_ACTIONS } from './generated/record-audit-actions.js';

/**
 * Audit action registry (ADR-0008 §4). `category` is a closed enum; `action` is a
 * registered `<entity>.<verb>` string. The S2 migration seeds
 * `audit.action_registry` from this list, and `audit.append_event` rejects any
 * action not in it. Modules add their actions here in the same PR that emits them.
 */
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
export const AuditCategorySchema = z.enum(AUDIT_CATEGORIES);

/** Fields each category requires (ADR-0008 §4 table). Enforced in `AuditEventInput`. */
export const AUDIT_CATEGORY_REQUIREMENTS = {
  auth: { target: false, diff: false, reason: false, network: true },
  mutation: { target: true, diff: true, reason: false, network: false },
  reveal: { target: true, diff: false, reason: true, network: false },
  export: { target: false, diff: false, reason: false, network: false },
  approval: { target: true, diff: false, reason: false, network: false },
  permission: { target: true, diff: true, reason: false, network: false },
  integration: { target: false, diff: false, reason: false, network: false },
  system: { target: false, diff: false, reason: true, network: false },
} as const satisfies Record<
  AuditCategory,
  { target: boolean; diff: boolean; reason: boolean; network: boolean }
>;

/** Categories whose denied attempts are logged (ADR-0008 §4), plus `mutation` (S3). */
export const DENIABLE_CATEGORIES: readonly AuditCategory[] = [
  'auth',
  'mutation',
  'reveal',
  'export',
  'approval',
  'permission',
];

type Entry = { category: AuditCategory; description: string };

/**
 * Hand-written actions: shared-entity and platform actions. Module actions are added as
 * modules ship. Record-type actions not listed here are generated from the record type
 * registry (`generated/record-audit-actions.ts`, ADR-0014 section 2.9).
 */
export const BASE_AUDIT_ACTIONS = {
  // auth
  'session.login': { category: 'auth', description: 'Signed in' },
  'session.login_failed': { category: 'auth', description: 'Sign-in failed' },
  'session.logout': { category: 'auth', description: 'Signed out' },
  'session.expired': { category: 'auth', description: 'Session expired (idle or absolute)' },
  'session.reauth': { category: 'auth', description: 'Re-authenticated for a sensitive action' },
  'mfa.enrolled': { category: 'auth', description: 'MFA factor enrolled' },
  'mfa.challenge': { category: 'auth', description: 'MFA challenge answered' },
  'mfa.reset': { category: 'auth', description: 'MFA reset by an administrator' },
  'mfa.enrollment_issued': {
    category: 'auth',
    description: 'Single-use MFA enrollment token issued',
  },
  'scim.user_provisioned': { category: 'auth', description: 'User provisioned via SCIM' },
  'scim.user_deprovisioned': { category: 'auth', description: 'User deprovisioned via SCIM' },
  'breakglass.activated': { category: 'auth', description: 'Break-glass account used' },
  'session.revoked': {
    category: 'auth',
    description: 'Session revoked (sign-out elsewhere, MFA reset, deprovisioning)',
  },
  'session.rotated': {
    category: 'auth',
    description: 'Session token rotated after a privilege change',
  },
  'account.locked': {
    category: 'auth',
    description: 'Sign-in temporarily locked after repeated failures',
  },
  'access.denied': {
    category: 'auth',
    description: 'Request denied by the authorization policy (read or navigation)',
  },
  'access.view': {
    category: 'auth',
    description: 'Record viewed by a role whose every view is logged (auditor)',
  },

  // mutation (shared entities)
  'organization.update': { category: 'mutation', description: 'Organization settings changed' },
  'site.create': { category: 'mutation', description: 'Site created' },
  'site.update': { category: 'mutation', description: 'Site changed' },
  'site.archive': { category: 'mutation', description: 'Site archived' },
  'person.create': { category: 'mutation', description: 'Person created' },
  'person.update': { category: 'mutation', description: 'Person changed' },
  'person.archive': { category: 'mutation', description: 'Person archived' },
  'user_account.create': { category: 'mutation', description: 'User account created' },
  'user_account.deactivate': { category: 'mutation', description: 'User account deactivated' },
  'requirement_instance.create': {
    category: 'mutation',
    description: 'Requirement applied to a subject',
  },
  'requirement_instance.update': {
    category: 'mutation',
    description: 'Requirement instance status or owner changed',
  },
  'requirement_instance.mark_not_applicable': {
    category: 'mutation',
    description: 'Requirement instance marked not applicable, with reason',
  },
  'evidence.create': { category: 'mutation', description: 'Evidence record created' },
  'evidence.archive': { category: 'mutation', description: 'Evidence record archived' },
  'evidence_version.create': { category: 'mutation', description: 'Evidence version added' },
  'evidence_link.create': { category: 'mutation', description: 'Evidence linked to a requirement' },
  'evidence_link.close': { category: 'mutation', description: 'Evidence link ended' },
  'task.create': { category: 'mutation', description: 'Task created' },
  'task.update': { category: 'mutation', description: 'Task changed' },
  'task.complete': { category: 'mutation', description: 'Task completed' },
  'workflow_run.start': { category: 'mutation', description: 'Workflow started' },
  'import.commit': { category: 'mutation', description: 'Import run committed (summary event)' },
  'saved_view.create': { category: 'mutation', description: 'Saved list view created' },
  'saved_view.update': { category: 'mutation', description: 'Saved list view changed' },

  // reveal
  'person.reveal_dob': { category: 'reveal', description: 'Date of birth shown in clear text' },
  'person.reveal_home_address': {
    category: 'reveal',
    description: 'Home address shown in clear text',
  },
  'provider_profile.reveal_dea_number': {
    category: 'reveal',
    description: 'DEA number shown in clear text',
  },
  'evidence.download': { category: 'reveal', description: 'Evidence file downloaded' },

  // export
  'report.export': { category: 'export', description: 'Report exported' },
  'audit.export': { category: 'export', description: 'Audit log exported' },

  // approval (humans only; AI never produces these)
  'approval.decide': { category: 'approval', description: 'Workflow approval recorded' },
  'privilege_set.approve': { category: 'approval', description: 'Privilege set approved' },
  'committee_decision.record': { category: 'approval', description: 'Committee decision recorded' },
  'attestation.sign': { category: 'approval', description: 'Attestation signed' },

  // permission
  'role.grant': { category: 'permission', description: 'Role granted' },
  'role.revoke': { category: 'permission', description: 'Role revoked' },
  'site_scope.change': { category: 'permission', description: 'Site scope changed' },
  'auditor_access.grant': {
    category: 'permission',
    description: 'Time-boxed auditor access granted',
  },
  'auditor_access.expired': { category: 'permission', description: 'Auditor access expired' },
  'saved_view.share': {
    category: 'permission',
    description: 'Saved list view shared with roles',
  },

  // mutation: readiness (S4)
  'requirement_instance.evaluate': {
    category: 'mutation',
    description: 'Readiness status recomputed by the engine (internal readiness)',
  },
  'requirement_instance.clear_not_applicable': {
    category: 'mutation',
    description: 'Not applicable mark removed, with reason',
  },
  'tenant_parameter.set': {
    category: 'mutation',
    description: 'Health center value for a catalog parameter set, with reason',
  },
  'readiness_fact.record': { category: 'mutation', description: 'Readiness evidence fact recorded' },
  'readiness_fact.retract': {
    category: 'mutation',
    description: 'Readiness evidence fact retracted, with reason',
  },

  // integration
  'screening_run.complete': {
    category: 'integration',
    description: 'Exclusion screening run finished',
  },
  'screening_run.failed': {
    category: 'integration',
    description: 'Exclusion screening run failed',
  },
  'license_sync.complete': { category: 'integration', description: 'License sync finished' },
  'license_sync.failed': { category: 'integration', description: 'License sync failed' },

  // system
  'audit.genesis': { category: 'system', description: 'First event of an organization chain' },
  'audit.annotation': { category: 'system', description: 'Correction note on an earlier event' },
  'audit.verification_run': { category: 'system', description: 'Hash chain verified' },
  'audit.anchor': { category: 'system', description: 'Chain head anchored externally' },
  'retention.checkpoint': { category: 'system', description: 'Retention checkpoint written' },
  'retention.hard_delete': { category: 'system', description: 'Partition dropped at retention' },
  'legal_hold.set': { category: 'system', description: 'Legal hold set' },
  'legal_hold.release': { category: 'system', description: 'Legal hold released' },
  'key.rotated': { category: 'system', description: 'Encryption key rotated' },
  'catalog_release.applied': { category: 'system', description: 'Catalog release applied' },
  'readiness_snapshot.create': {
    category: 'system',
    description: 'Readiness snapshot stored (internal readiness)',
  },
  'organization.provision': {
    category: 'system',
    description: 'Tenant provisioned by the platform',
  },
  'seed.load': {
    category: 'system',
    description: 'Synthetic seed data loaded (non-production only)',
  },
} as const satisfies Record<string, Entry>;

/** Every registered action: the base list plus the generated record-type actions. */
export const AUDIT_ACTIONS = {
  ...BASE_AUDIT_ACTIONS,
  ...RECORD_AUDIT_ACTIONS,
} as const satisfies Record<string, Entry>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]];
export const AuditActionSchema = z.enum(AUDIT_ACTION_NAMES);

/** Registered action names must look like `<entity>.<verb>` in snake_case. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function categoryOf(action: AuditAction): AuditCategory {
  return AUDIT_ACTIONS[action].category;
}
