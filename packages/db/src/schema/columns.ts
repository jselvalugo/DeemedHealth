import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

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
