import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packages = fileURLToPath(new URL('../', import.meta.url));

// Package-level config so `pnpm --filter @deemed/readiness test` works; the root
// vitest.config.ts runs the same tests in the `unit` project.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@deemed\/(dates|requirements-catalog)$/,
        replacement: `${packages}$1/src/index.ts`,
      },
    ],
  },
  test: { include: ['src/**/*.test.ts'] },
});
