import { defineConfig } from 'vitest/config';

// Package-level config. `pnpm --filter @deemed/dates test:coverage` enforces
// 100% coverage (phase-1 plan S4); the root `pnpm test` runs it too.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
