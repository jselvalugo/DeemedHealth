import { describe, expect, it } from 'vitest';
import { checkMigrationsDir, findCatalogGuardViolations } from './check-catalog-migrations.mjs';

describe('check-catalog-migrations (S9)', () => {
  it('passes the repository migrations', () => {
    expect(checkMigrationsDir()).toEqual([]);
  });

  it('flags disabling or dropping a catalog trigger, or dropping a catalog constraint', () => {
    const bad = [
      'ALTER TABLE catalog.requirement_version DISABLE TRIGGER requirement_version_immutable;',
      'DROP TRIGGER catalog_release_immutable ON catalog.catalog_release;',
      'ALTER TABLE catalog.requirement_version DROP CONSTRAINT requirement_version_production_verified;',
      'alter table catalog.catalog_release disable trigger all;',
    ];
    for (const sql of bad) {
      expect(findCatalogGuardViolations(sql, 'x.sql'), sql).toHaveLength(1);
    }
  });

  it('ignores other schemas, comments, and string literals', () => {
    const ok = [
      'ALTER TABLE public.requirement_instance DROP CONSTRAINT requirement_instance_na_reason;',
      '-- DROP TRIGGER x ON catalog.catalog_release;\nSELECT 1;',
      "SELECT 'DROP TRIGGER t ON catalog.catalog_release';",
      'CREATE TRIGGER t BEFORE UPDATE ON catalog.catalog_release FOR EACH ROW EXECUTE FUNCTION f();',
      // A public table that references the catalog is not a catalog guard.
      'ALTER TABLE public.requirement_instance DROP CONSTRAINT c, ADD CONSTRAINT d FOREIGN KEY (x) REFERENCES catalog.catalog_release (id);',
    ];
    for (const sql of ok) {
      expect(findCatalogGuardViolations(sql, 'x.sql'), sql).toEqual([]);
    }
  });
});
