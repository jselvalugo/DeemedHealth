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
  {
    // packages/dates: time is injected through a Clock, and the host time zone
    // must never leak in. Only clock.ts may read the system time.
    files: ['packages/dates/src/**/*.ts'],
    ignores: ['packages/dates/src/**/*.test.ts', 'packages/dates/src/clock.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Read the time from an injected Clock, not new Date().',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Read the time from an injected Clock, not Date.now().',
        },
        {
          selector:
            'MemberExpression[property.name=/^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)$/]',
          message: 'Host-local Date methods depend on the server time zone. Use @deemed/dates.',
        },
      ],
    },
  },
);
