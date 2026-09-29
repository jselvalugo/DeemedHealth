import { customType, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** PostgreSQL bytea (Drizzle has no built-in). Used for hashes and field-encrypted values. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** timestamptz; stored in UTC, displayed in the site's or organization's time zone. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * created_* / updated_* columns. The database trigger public.set_row_meta() sets them
 * from the transaction's actor context (withTenant), whatever the caller sends.
 */
export const rowMeta = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

/**
 * Records framework columns on business tables (ADR-0014 sections 2.3 and 2.4):
 * row_version (set and incremented by public.set_row_meta()) and the archive fields
 * next to archived_at.
 */
export const archiveMeta = () => ({
  rowVersion: integer('row_version').notNull().default(1),
  archivedBy: uuid('archived_by'),
  archiveReason: text('archive_reason'),
});
