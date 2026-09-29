/**
 * Catalog channel (security review S4): the migrate flag must agree with DH_ENV, and the
 * API and worker refuse to start when DH_ENV and the database disagree.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogChannelMismatchError, assertCatalogChannel } from '../src/catalog-channel.js';
import { createDatabase, type Database } from '../src/client.js';
import { MigrationError, resolveCatalogChannel } from '../src/migrate.js';
import { describeDb, need } from './helpers.js';

describe('resolveCatalogChannel (--catalog-channel)', () => {
  it('accepts only a channel that agrees with DH_ENV', () => {
    expect(resolveCatalogChannel(undefined, 'production')).toBeUndefined();
    expect(resolveCatalogChannel('production', 'production')).toBe('production');
    expect(resolveCatalogChannel('non_production', 'development')).toBe('non_production');
    expect(() => resolveCatalogChannel('non_production', 'production')).toThrow(MigrationError);
    expect(() => resolveCatalogChannel('production', 'staging')).toThrow(MigrationError);
    expect(() => resolveCatalogChannel('production', undefined)).toThrow(MigrationError);
    expect(() => resolveCatalogChannel('prod', 'production')).toThrow(MigrationError);
  });
});

describeDb('startup channel guard', () => {
  let database: Database;
  beforeAll(() => {
    database = createDatabase({ connectionString: need().appUserUrl, max: 1 });
  });
  afterAll(async () => {
    await database?.close();
  });

  it('lets a non-production deployment start on the non-production test database', async () => {
    expect(await assertCatalogChannel(database, 'local')).toBe('non_production');
    expect(await assertCatalogChannel(database, 'development')).toBe('non_production');
  });

  it('refuses a production deployment on a non-production database', async () => {
    await expect(assertCatalogChannel(database, 'production')).rejects.toThrow(
      CatalogChannelMismatchError,
    );
  });
});
