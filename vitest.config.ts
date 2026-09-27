import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packages = fileURLToPath(new URL('./packages/', import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Tests run against package sources, so no build is needed first.
    alias: [
      {
        find: /^@deemed\/(domain|i18n|ui)$/,
        replacement: `${packages}$1/src/index.ts`,
      },
    ],
  },
  test: {
    include: [
      'apps/*/src/**/*.test.ts',
      'apps/web/{app,lib}/**/*.test.{ts,tsx}',
      'packages/*/src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.mjs',
    ],
    // Component tests (.tsx) run in a DOM; everything else stays in Node.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
  },
});
