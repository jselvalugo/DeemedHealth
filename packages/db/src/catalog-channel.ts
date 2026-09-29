/**
 * Startup guard (security review S4): a production deployment runs only against a
 * database whose catalog channel is production, and a non-production deployment never
 * against a production database. The API and the worker call this before serving.
 */
import { isProduction, parseDhEnv } from '@deemed/domain';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export class CatalogChannelMismatchError extends Error {
  override name = 'CatalogChannelMismatchError';
}

export async function assertCatalogChannel(
  database: Database,
  dhEnv: string,
): Promise<'production' | 'non_production' | null> {
  const r = await database.db.execute<{ channel: 'production' | 'non_production' }>(
    sql`SELECT channel FROM catalog.database_profile`,
  );
  const channel = r.rows[0]?.channel ?? null;
  const production = isProduction(parseDhEnv(dhEnv));
  if (production && channel !== 'production') {
    throw new CatalogChannelMismatchError(
      'DH_ENV is production but the database catalog channel is not production',
    );
  }
  if (!production && channel === 'production') {
    throw new CatalogChannelMismatchError(
      `DH_ENV ${dhEnv} must not run against a production catalog database`,
    );
  }
  return channel;
}
