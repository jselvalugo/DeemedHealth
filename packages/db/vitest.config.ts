import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

// Integration tests for @deemed/db. The global setup provides a real PostgreSQL 16
// (DATABASE_URL, a throwaway local cluster, or Docker) and skips only when none exists
// outside CI. Files run one at a time, in a single fork, because they share one database.
export default defineProject({
  resolve: {
    alias: {
      '@deemed/domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: 'db',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
