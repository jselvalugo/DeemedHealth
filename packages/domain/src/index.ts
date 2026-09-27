export const packageName = '@deemed/domain';
export { DH_ENVS, isProduction, parseDhEnv, type DhEnv } from './environment.js';
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
