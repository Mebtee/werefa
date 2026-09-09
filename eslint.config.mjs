import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/db/prisma/generated/**',
      '**/*.json',
      '*.json',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    ...tseslint.configs.recommended[0],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-undef': 'off', // TypeScript resolves globals; avoids false positives
      'no-unused-vars': 'off', // typescript-eslint owns unused-vars for .ts/.tsx
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-member-accessibility': 'off',
      // Off: NestJS DI relies on reflect-metadata, so providers injected in
      // constructor params must remain value imports even when only used as
      // (type) parameters.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/api/**', 'apps/worker/**', 'packages/**'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        setImmediate: 'readonly',
        setTimeout: 'readonly',
        global: 'readonly',
      },
    },
  },
  {
    files: ['apps/dashboard/**', 'apps/public/**', 'packages/ui/**'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        crypto: 'readonly',
      },
    },
  },
  prettier,
);
