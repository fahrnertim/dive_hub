// Lint rules (research note 2026-10-22-agent-guardrails): typescript-eslint's recommended rules and a cognitive
// complexity budget of 15 per function. Problems that existed on 2026-10-22 are in eslint-suppressions.json; only
// new ones fail. That file may only shrink (ADR 0023, amendment of 2026-10-22): after fixing one, run
// `pnpm lint --prune-suppressions`. Don't raise the budget to make something pass.
import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', 'apps/web/test-results/', 'apps/web/review-output/', 'apps/web/e2e/.state/', 'apps/server/drizzle/', 'data/', 'samples/'] },
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'apps/*/test/**/*.{ts,tsx}', 'apps/web/e2e/**/*.ts', 'packages/*/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', 15],
      // TypeScript checks these itself (the typecheck step).
      'no-undef': 'off',
      'no-redeclare': 'off',
      // `_` marks a value that is deliberately unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
);
