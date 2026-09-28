/**
 * The record type registry (ADR-0014 section 1). CODEOWNERS: `suite-architect` on this
 * file and the framework; the domain specialist on its module's definitions;
 * `security-privacy-officer` on any field whose class is PII or PHI.
 *
 * Adding a type: declare it under `types/<module>/`, list it here, give it a fixture
 * factory in `packages/test-fixtures/src/records.ts` and an API binding in
 * `apps/api/src/records/bindings.ts`, add its EN/ES labels, and regenerate
 * (`pnpm --filter @deemed/db generate`) so its audit actions are registered. The
 * registry test, the generated route tests, and the db index check fail until all of
 * that is done.
 */
import type { RecordTypeDef } from './define.js';
import { personRecord } from './types/admin/person.js';
import { roleAssignmentRecord } from './types/admin/role-assignment.js';
import { siteRecord } from './types/admin/site.js';
import { userAccountRecord } from './types/admin/user-account.js';
import { requirementInstanceRecord } from './types/readiness/requirement-instance.js';

export const RECORD_TYPES = [
  siteRecord,
  personRecord,
  userAccountRecord,
  roleAssignmentRecord,
  requirementInstanceRecord,
] as const;

export type RecordTypeId = (typeof RECORD_TYPES)[number]['id'];
export const RECORD_TYPE_IDS = RECORD_TYPES.map((t) => t.id) as unknown as readonly [
  RecordTypeId,
  ...RecordTypeId[],
];

/**
 * The declarations keep literal field names (checked where they are written); `keyof`
 * makes that parameter invariant, so the registry widens them explicitly here.
 */
const ALL: readonly RecordTypeDef[] = RECORD_TYPES.map((t) => t as unknown as RecordTypeDef);
const BY_ID = new Map<string, RecordTypeDef>(ALL.map((t) => [t.id, t]));

export function isRecordTypeId(value: string): value is RecordTypeId {
  return BY_ID.has(value);
}

export function getRecordType(id: string): RecordTypeDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown record type ${id}`);
  return def;
}

export function recordTypes(): readonly RecordTypeDef[] {
  return ALL;
}
