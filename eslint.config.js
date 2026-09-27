// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.next/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
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
