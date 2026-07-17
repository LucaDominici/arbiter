// SPDX-License-Identifier: Apache-2.0
// scripts/lib/gate-args.mjs
// Pure shared argv parser for the E1-E7 enforcer gate scripts (#1943). Supports both
// `--flag value` (separate tokens) and `--flag=value` forms. Extracted to a lib so the
// 6 enforcer gate scripts don't each carry an identical copy (debt-ratchet duplication).
//
// No entry point, no process.exit (see check-fail-closed-audit SKIP_FILES). Pure semantics.

/**
 * Read a flag value from argv. Supports `--flag value` and `--flag=value`.
 * @param {string} flag
 * @param {readonly string[]} argv
 * @returns {string | null}
 */
export function arg(flag, argv) {
  const i = argv.indexOf(`--${flag}`)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]
  const eq = argv.find((x) => x.startsWith(`--${flag}=`))
  return eq ? eq.slice(`--${flag}=`.length) : null
}
