// Bundles the API (src/entry.ts and every dependency, workspace packages included)
// into one ESM file for serverless hosts: dist/serverless/api.mjs. The Netlify function
// (netlify/functions/api.mts) imports it, so the function does not depend on the
// host bundler resolving pnpm workspace symlinks. Native modules stay external and are
// shipped by the host (netlify.toml external_node_modules).
import { build } from 'esbuild';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ['src/entry.ts'],
  outfile: 'dist/serverless/api.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  external: ['@node-rs/argon2', 'pg-native'],
  // CommonJS dependencies (pg, fastify internals) call require(); give them one.
  banner: {
    js: "import { createRequire as __dhCreateRequire } from 'node:module'; const require = __dhCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log('bundled dist/serverless/api.mjs');
