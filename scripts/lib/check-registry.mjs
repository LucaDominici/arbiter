// SPDX-License-Identifier: Apache-2.0
// Pure export — no try/catch needed; errors propagate to caller.

/**
 * Declarative registry mapping check names to the file-glob patterns that affect them.
 * Used by computeSkipped() in check-all.mjs for opt-in selective gating.
 *
 * A check whose `affects` globs overlap any changed file will NOT be skipped.
 * Checks absent from this registry are never skipped (fail-safe default).
 */
export const CHECK_REGISTRY = [
  {
    name: 'typecheck',
    affects: ['src/**/*.ts', '__tests__/**/*.ts', 'tsconfig*.json'],
  },
  {
    name: 'unit tests',
    affects: ['src/**', '__tests__/**'],
  },
  {
    name: 'lint',
    affects: ['src/**', '__tests__/**', 'scripts/**/*.mjs', '.eslintrc*', 'eslint.config*'],
  },
  {
    name: 'format',
    affects: ['src/**', '__tests__/**', 'scripts/**/*.mjs'],
  },
  {
    name: 'docs',
    affects: ['docs/**', '*.md', 'src/**/*.md'],
  },
  {
    name: 'integration tests',
    affects: ['src/**', '__tests__/integration/**'],
  },
]
