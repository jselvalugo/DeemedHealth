// @deemed/domain: cross-module contracts owned by suite-architect.
export const packageName = '@deemed/domain';
export { DH_ENVS, isProduction, parseDhEnv, type DhEnv } from './environment.js';

export * from './primitives.js';
export * from './tenancy.js';
export * from './modules.js';
export * from './permissions.js';
export * from './audit-actions.js';
export * from './policy/index.js';
export * from './api/contracts.js';

export * from './entities/organization.js';
export * from './entities/person.js';
export * from './entities/requirement.js';
export * from './entities/evidence.js';
export * from './entities/task.js';
export * from './entities/approval.js';
export * from './entities/audit-event.js';
export * from './entities/notification.js';

export {
  AUDIT_SCHEMA_VERSION,
  CanonicalFormError,
  GENESIS_PREV_HASH,
  canonicalAuditRow,
  computeAuditRowHash,
  jcs,
  verifyAuditChain,
  type AuditRowExport,
  type ChainVerification,
  type JsonValue,
} from './audit-canonical.js';
export {
  classifySsnColumnName,
  detectSsnLikeColumns,
  isSsnShapedValue,
  tokenizeColumnName,
  type ColumnSample,
  type SsnColumnFinding,
  type SsnConfidence,
} from './ssn-detector.js';
