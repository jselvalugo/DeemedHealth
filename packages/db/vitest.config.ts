import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Integration tests against a real PostgreSQL 16: @deemed/db (tenant isolation, RLS,
// audit chain) and apps/api (endpoints, sessions, RBAC, audit). The global setup
// provides the server (DATABASE_URL, a throwaway local cluster, or Docker), one scratch
// database, and the seed; it skips only when none exists outside CI. Files run one at
// a time, in a single fork, because they share one database. The project root stays
// here so the global setup resolves this package's dependencies.
export default defineProject({
  resolve: {
    // Exact matches (regex), so '@deemed/readiness' does not also rewrite
    // '@deemed/readiness/service'.
    alias: [
      { find: /^@deemed\/domain$/, replacement: src('../domain/src/index.ts') },
      { find: /^@deemed\/db$/, replacement: src('./src/index.ts') },
      { find: /^@deemed\/auth$/, replacement: src('../auth/src/index.ts') },
      { find: /^@deemed\/dates$/, replacement: src('../dates/src/index.ts') },
      { find: /^@deemed\/jobs$/, replacement: src('../jobs/src/index.ts') },
      { find: /^@deemed\/readiness$/, replacement: src('../readiness/src/index.ts') },
      {
        find: /^@deemed\/readiness\/service$/,
        replacement: src('../readiness/src/service/index.ts'),
      },
      {
        find: /^@deemed\/requirements-catalog$/,
        replacement: src('../requirements-catalog/src/index.ts'),
      },
      {
        find: /^@deemed\/requirements-catalog\/compiler$/,
        replacement: src('../requirements-catalog/src/node.ts'),
      },
      {
        find: /^@deemed\/test-fixtures\/catalog$/,
        replacement: src('../test-fixtures/src/catalog/index.ts'),
      },
      { find: /^@deemed\/ui\/module-registry$/, replacement: src('../ui/src/module-registry.ts') },
    ],
  },
  test: {
    name: 'db',
    include: [
      'test/**/*.test.ts',
      '../jobs/test/**/*.test.ts',
      '../readiness/test/**/*.test.ts',
      '../../apps/api/test/**/*.test.ts',
    ],
    globalSetup: ['test/global-setup.ts'],
    pool: 'forks',
    // Vitest 4 replacement for poolOptions.forks.singleFork: one worker, one file at a time.
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
