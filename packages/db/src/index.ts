export * as schema from './schema/index.js';
export * from './schema/index.js';
export {
  RUNTIME_ROLES,
  SETTINGS,
  TenantContextError,
  createDatabase,
  withPlatform,
  withTenant,
  type Actor,
  type Database,
  type DatabaseOptions,
  type Db,
  type RuntimeRole,
  type Schema,
  type TransactionOptions,
  type TransactionContext,
  type Tx,
} from './client.js';
export { redactedDiff, type TextDigest } from './audit/diff.js';
export {
  AUDIT_EXPORT_COLUMNS,
  appendAuditEvent,
  exportAuditChain,
  toAuditRowExport,
  verifyAuditChainInDb,
  type AuditEventInput,
  type RawAuditExportRow,
  type SqlChainVerification,
} from './audit/index.js';
export {
  ensureAuditPartitions,
  listTenants,
  provisionOrganization,
  type ProvisionOrganizationInput,
  type ProvisionSiteInput,
  type TenantListEntry,
} from './platform.js';
export {
  MIGRATIONS_DIR,
  MigrationError,
  loadMigrations,
  migrate,
  type MigrateOptions,
  type MigrationFile,
} from './migrate.js';
export {
  DATA_DICTIONARY,
  renderDataDictionaryMarkdown,
  type ColumnEntry,
  type SensitivityClass,
  type TableEntry,
} from './data-dictionary.js';
