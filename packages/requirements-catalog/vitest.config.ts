import { defineConfig } from 'vitest/config';

// Package-level config so `pnpm --filter <pkg> test` finds tests; the root
// vitest.config.ts still covers the whole workspace for `pnpm test`.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
