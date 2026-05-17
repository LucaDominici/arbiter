import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import noRawCliStrings from './eslint-rules/index.js'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: { sonarjs },
  },
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: true,
        },
      ],
    },
  },
  // Raw CLI string detection for src/commands — complements scripts/check-no-raw-strings.mjs with editor-time feedback
  {
    files: ['src/commands/**/*.ts'],
    plugins: { 'no-raw-cli-strings': noRawCliStrings },
    rules: { 'no-raw-cli-strings/no-raw-cli-strings': 'warn' },
  },
  // Complexity + duplication rules for source files (not templates — EJS variants share scaffolding)
  {
    files: ['src/**/*.ts'],
    rules: {
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': 'warn',
      complexity: ['error', 15],
      'max-params': ['error', 5],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
      'max-nested-callbacks': ['error', 3],
      // #820: forbid console.* in production code — use src/utils/logger.ts
      // (stderr) for diagnostics, or process.stdout.write for user-facing
      // payload. console.log silently swallows structured attrs and routes
      // to stdout (polluting --json output).
      'no-console': 'error',
    },
  },
  // Test files are not in tsconfig.json — disable type-aware rules and relax style rules
  {
    files: ['__tests__/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'vitest.config.ts',
      'eslint.config.js',
      'src/templates/',
      'scripts/',
      '__tests__/fixtures/',
    ],
  },
)
