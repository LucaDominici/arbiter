// SPDX-License-Identifier: Apache-2.0
// Flat ESLint config for the `static analysis` gate (M29). Run in isolation by
// check-all.mjs via `eslint --config eslint.config.static.mjs --no-config-lookup`
// so it enforces ONLY arbiter's project-wide prohibitions (complexity, no-console,
// max-depth, …) independent of your main eslint.config.mjs. ESLint v9+ flat config
// — the legacy `.eslintrc-static.json` is no longer used by the gate (eslintrc was
// removed in the flat-config era), but is retained for tooling that still reads it.
import tseslint from 'typescript-eslint'

export default tseslint.config({
  files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: {
    '@typescript-eslint': tseslint.plugin,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': 'error',
    complexity: ['error', 20],
    'max-params': ['error', 8],
    'max-depth': ['error', 4],
    'max-lines-per-function': [
      'error',
      { max: 100, skipBlankLines: true, skipComments: true },
    ],
    'max-nested-callbacks': ['error', 3],
    'no-var': 'error',
    'prefer-const': 'error',
    eqeqeq: ['error', 'always'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
  },
})
