import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packages = fileURLToPath(new URL('./packages/', import.meta.url));

// `pnpm test` runs three projects:
//  - unit: every package's pure tests (*.test.ts, scripts/*.test.mjs) in Node;
//  - dom:  component tests (*.test.tsx) in jsdom;
//  - db:   @deemed/db integration tests against a real PostgreSQL 16 (see
//          packages/db/vitest.config.ts). `pnpm test:db` runs only this one.
// `unit` and `dom` inherit the root `esbuild` and `resolve` settings (extends: true).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Tests run against package sources, so no build is needed first.
    alias: [
      { find: '@deemed/ui/module-registry', replacement: `${packages}ui/src/module-registry.ts` },
      {
        find: '@deemed/requirements-catalog/compiler',
        replacement: `${packages}requirements-catalog/src/node.ts`,
      },
      {
        find: /^@deemed\/(domain|i18n|ui|db|auth|dates|jobs|readiness|requirements-catalog)$/,
        replacement: `${packages}$1/src/index.ts`,
      },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'apps/*/src/**/*.test.ts',
            'apps/web/{app,lib}/**/*.test.ts',
            'packages/*/src/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['apps/web/{app,lib}/**/*.test.tsx', 'packages/*/src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      './packages/db/vitest.config.ts',
    ],
  },
});
