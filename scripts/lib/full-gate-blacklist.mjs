// SPDX-License-Identifier: Apache-2.0
// Pure export — no try/catch needed; errors propagate to caller.

/**
 * Files matching these patterns force a full gate when changed, overriding --selective.
 * Any change to these files invalidates selective-skip assumptions (cross-cutting impact).
 */
export const FULL_GATE_BLACKLIST = [
  'tsconfig*.json',
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'src/utils/**',
  'src/templates/**',
  'src/generators/**',
  'scripts/check-all.mjs',
  'scripts/lib/**',
  '.claude/settings.json',
  'arbiter.json',
]
