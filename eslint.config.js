// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.next/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // React components: hooks rules and accessibility (WCAG 2.1 AA, design system § Rules).
    files: ['**/*.tsx'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  { files: ['**/*.tsx'], ...jsxA11y.flatConfigs.recommended },
  prettier,
  {
    // Tests index into fixtures they just built; `!` there is clearer than guards.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
