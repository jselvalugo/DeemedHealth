import { defineWorkspace } from 'vitest/config';

// `pnpm test` runs two projects:
//  - unit: every package's src/**/*.test.ts (pure, no database);
//  - db:   @deemed/db integration tests against a real PostgreSQL 16 (see
//          packages/db/vitest.config.ts). `pnpm test:db` runs only this one.
export default defineWorkspace([
  { extends: './vitest.config.ts', test: { name: 'unit' } },
  './packages/db/vitest.config.ts',
]);
