// SPDX-License-Identifier: Apache-2.0
// Flat ESLint config (ESLint v9+) — the `lint` gate runs `eslint src` and loads
// this file. Kept intentionally lean so a freshly-scaffolded project lints GREEN
// on first run: type-aware rules (which need a tsconfig project reference and a
// full type-check pass) live in the optional strict layer you can enable later.
//
// Customise freely — this is YOUR config, not arbiter-owned. The deeper
// project-wide prohibitions arbiter enforces (complexity, no-console, max-depth,
// …) live in eslint.config.static.mjs, run by the separate `static analysis` gate.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      // #1840 F4 tranche-3: respect the underscore-prefix "intentionally unused"
      // convention (e.g. Express's required-but-unused `_next` error-handler
      // param — arbiter's own middleware/error-handler.ts.ejs uses it) — without
      // this, tseslint's recommended no-unused-vars flags it on every fresh init.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
