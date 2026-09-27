import { z } from 'zod';
import { MODULE_IDS, type ModuleId } from '../modules.js';

/**
 * Executive approval areas (module map "Default roles": Executive, "Approvals in
 * their area"). An executive's `approve` permission applies only to records in a
 * module that the area of one of their executive role grants covers (a record rule
 * in `authorize`).
 *
 * The mapping is DATA, not code: the table `public.approval_area` holds it, the API
 * loads it, and `role_assignment.approval_area` names the area of each executive
 * grant. This constant is the PROPOSED default that migration 0004 seeds, pending
 * confirmation by the product owner (@jselvalugo). Changing it is a data migration,
 * never an edit to the policy engine. A db test keeps the migration and this
 * constant in step.
 *
 * An executive grant without an area approves nothing (deny by default).
 */
export const PROPOSED_APPROVAL_AREAS = {
  clinical: ['providers', 'ftca', 'quality', 'experience', 'learning'],
  finance: ['finance', 'contracts', 'scope'],
  operations: ['enrollment', 'screening', 'tasks', 'self-service'],
  governance: ['governance', 'readiness'],
} as const satisfies Record<string, readonly ModuleId[]>;

export type ApprovalAreas = Readonly<Record<string, readonly ModuleId[]>>;

/** `[a-z][a-z0-9_]*`, checked with a loop rather than a regex. */
export function isSnakeKey(value: string, maxLength = 64): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const lower = c >= 97 && c <= 122;
    const digit = c >= 48 && c <= 57;
    if (i === 0 ? !lower : !(lower || digit || c === 95)) return false;
  }
  return true;
}

export const ApprovalAreaKeySchema = z
  .string()
  .refine((v) => isSnakeKey(v, 40), 'Invalid approval area key');

export const ApprovalAreasSchema = z.record(ApprovalAreaKeySchema, z.array(z.enum(MODULE_IDS)));
