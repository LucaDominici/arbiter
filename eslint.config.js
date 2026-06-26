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
      // INV-115: `var` is a hard prohibition in AGENTS.md ("never `var`"); enforce it in the
      // ACTIVE flat config so the constraint-map COVERED claim (var → no-var) is honest, not
      // resolved against the dormant .eslintrc-static.json.
      'no-var': 'error',
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
  // #1523: scripts/ is the gate-enforcement layer (every gate, ratchet and CI
  // check lives here) yet was historically exempt from ESLint entirely — so the
  // code that *enforces* the quality bar got zero dead-code analysis. Lint it
  // for unused vars / unreachable branches at the same bar as src/. The .mjs
  // gate scripts are not in tsconfig.json, so type-aware rules are disabled and
  // `no-undef` is off (node globals are not declared via an env block here).
  // Complexity / max-lines burn-down for scripts is tracked separately.
  {
    files: ['scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
    rules: {
      // node globals are not declared via an env block; `no-undef` would flag
      // process/Buffer/etc. as false positives.
      'no-undef': 'off',
      // The dead-code gate this block exists to close (#1523). `_`-prefixed
      // bindings are the project convention for an intentionally-unused
      // value/arg/caught-error and stay exempt.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unreachable': 'error',
      // Avoid double-reporting the same dead code through the type-aware twin.
      '@typescript-eslint/no-unused-vars': 'off',
      // Broader lint hardening of the enforcement layer (regex hygiene, escape
      // cleanup, caught-error preservation) and the complexity / max-lines
      // burn-down are out of scope for the dead-code closure and tracked in the
      // #1523 follow-up. Kept off here so the focused gate lands green without
      // regressing anything (scripts/ had zero linting before this block).
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'vitest.config.ts',
      'eslint.config.js',
      'src/templates/',
      '__tests__/fixtures/',
    ],
  },
)
