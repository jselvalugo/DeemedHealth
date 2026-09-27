/**
 * Static checks over the SQL migrations (ADR-0002 section 10, ADR-0008 section 1,
 * ADR-0011). These run without a database, so they guard CI even if the database
 * suite were skipped.
 */
import { describe, expect, it } from 'vitest';
import { loadMigrations, type MigrationFile } from '../src/migrate.js';

const files: MigrationFile[] = await loadMigrations();

/** SQL without comments and string literals, for pattern checks. */
function code(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, (body) => body.replace(/'(?:[^']|'')*'/g, "''"))
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** CREATE TABLE statements with their column list. */
function createdTables(sql: string): { name: string; body: string; partitionOf: boolean }[] {
  const out: { name: string; body: string; partitionOf: boolean }[] = [];
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+\.[a-z_0-9]+)\s*(\(|PARTITION OF)/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
    }
    out.push({
      name: m[1] as string,
      body: sql.slice(start, i),
      partitionOf: /PARTITION OF/i.test(m[2] as string),
    });
  }
  return out;
}

describe('migrations', () => {
  it('are numbered 0000.. without gaps, and only the bootstrap runs as admin', () => {
    expect(files.map((f) => f.name.slice(0, 4))).toEqual(
      files.map((_, i) => String(i).padStart(4, '0')),
    );
    expect(files.filter((f) => f.runAsAdmin).map((f) => f.name)).toEqual([
      '0000_bootstrap_roles.sql',
    ]);
  });

  it('enable and force RLS, with an app.organization_id policy, in the same file as each tenant table', () => {
    for (const file of files) {
      const sql = code(file.sql);
      for (const table of createdTables(sql)) {
        if (table.partitionOf || table.name.startsWith('platform.')) continue;
        const tenant =
          /\borganization_id\b/.test(table.body) || table.name === 'public.organization';
        if (!tenant) continue;
        const escaped = table.name.replace('.', '\\.');
        expect(sql, `${file.name}: ${table.name} ENABLE`).toMatch(
          new RegExp(`ALTER TABLE ${escaped} ENABLE ROW LEVEL SECURITY`),
        );
        expect(sql, `${file.name}: ${table.name} FORCE`).toMatch(
          new RegExp(`ALTER TABLE ${escaped} FORCE ROW LEVEL SECURITY`),
        );
        const policy = new RegExp(
          `CREATE POLICY \\w+ ON ${escaped}\\s+USING \\((?:organization_)?id = current_setting\\(''\\)::uuid\\)\\s+WITH CHECK \\((?:organization_)?id = current_setting\\(''\\)::uuid\\)`,
        );
        expect(sql, `${file.name}: ${table.name} policy`).toMatch(policy);
      }
    }
  });

  it('read app.organization_id in policies without missing_ok', () => {
    for (const file of files) {
      for (const m of file.sql.matchAll(/CREATE POLICY[\s\S]*?;/g)) {
        expect(m[0], file.name).toContain("current_setting('app.organization_id')");
        expect(m[0], file.name).not.toMatch(/current_setting\('app\.organization_id',\s*true\)/);
      }
    }
  });

  it('never grant UPDATE, DELETE, or TRUNCATE on the audit log, nor disable its triggers', () => {
    for (const file of files) {
      const sql = code(file.sql);
      expect(sql, file.name).not.toMatch(
        /GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*\bON\s+(TABLE\s+)?audit\.audit_event/i,
      );
      expect(sql, file.name).not.toMatch(/DISABLE\s+TRIGGER/i);
      expect(sql, file.name).not.toMatch(
        /GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*\bON\s+[^;]*audit\.[a-z_]+[^;]*\bTO\s+[^;]*\bapp_user\b/i,
      );
    }
  });

  it('never grant DELETE to app_user (soft delete only) or BYPASSRLS to anyone', () => {
    for (const file of files) {
      const sql = code(file.sql);
      expect(sql, file.name).not.toMatch(
        /GRANT[^;]*\b(DELETE|TRUNCATE|ALL)\b[^;]*\bTO\s+[^;]*\bapp_user\b/i,
      );
      expect(sql.replace(/NOBYPASSRLS/gi, ''), file.name).not.toMatch(/BYPASSRLS/i);
    }
  });

  it('use only ADR-0011 names and transaction-local settings', () => {
    for (const file of files) {
      const sql = code(file.sql);
      expect(file.sql, file.name).not.toMatch(/\btenant_id\b|\bapp_rw\b|app\.tenant_id/);
      expect(sql, file.name).not.toMatch(/\bSET\s+(SESSION\s+)?app\./i);
      expect(file.sql, file.name).not.toMatch(/set_config\('app\.[a-z_]+',[^)]*,\s*false\)/i);
      // Role switches are limited to the documented ownership hand-off in 0002.
      for (const m of sql.matchAll(/\bSET\s+(LOCAL\s+)?ROLE\s+([a-z_]+)/gi)) {
        expect(['audit_writer', 'app_owner'], file.name).toContain(m[2]);
        expect(m[1], `${file.name}: SET ROLE must be LOCAL`).toBeTruthy();
      }
    }
  });

  it('never define an SSN column (decision D1)', () => {
    for (const file of files) {
      expect(code(file.sql), file.name).not.toMatch(/\b(ssn|social_security\w*|ss_num\w*)\b/i);
    }
  });
});
