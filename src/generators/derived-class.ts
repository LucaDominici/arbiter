// SPDX-License-Identifier: Apache-2.0
/**
 * Codex-track "derived" file manifest (#1983).
 *
 * `arbiter update` never refreshes the codex-track files emitted with
 * `skipIfExists: true` — once `.agents/rules/*`, `.claude/hooks/*` (codex-only
 * projects), or `.codex/codex-adapter.mjs` exist on disk in a governed repo,
 * a later template fix (e.g. a CANON-22-class section landing in
 * `90-exec-protocol.md.ejs`) never reaches it. `update --refresh-derived`
 * (#1983) is the opt-in escape hatch — analogous to `update --adopt` (#1926)
 * — that force-refreshes exactly this set.
 *
 * The set is DERIVED from the same declarative sources the generators
 * themselves consume (`CODEX_DERIVED_RULES`, `SHARED_GUARD_HOOKS`), never a
 * hand-copied path list — the two can never independently drift on which
 * files are "codex-track derived".
 *
 * Deliberately excludes `.agents/plan/README.md`: that file is a scaffold
 * directory marker (task-plan folder stand-in), not derived-from-Claude-template
 * content, and is out of scope for this refresh set.
 */

import { CODEX_DERIVED_RULES } from './codex-known-limitations.js'
import { SHARED_GUARD_HOOKS } from './codex-hooks.js'

/** Posix, targetDir-relative keys of every codex-track file this refresh set covers. */
export const DERIVED_TRACK_KEYS: readonly string[] = [
  ...CODEX_DERIVED_RULES.map((rule) => `.agents/rules/${rule.file}`),
  '.claude/hooks/lib.mjs',
  ...SHARED_GUARD_HOOKS.map((hook) => `.claude/hooks/${hook}`),
  '.claude/hooks/check-no-skipped-tests.mjs',
  '.codex/codex-adapter.mjs',
]

const DERIVED_TRACK_KEY_SET = new Set(DERIVED_TRACK_KEYS)

/**
 * True when `key` (a manifest-style, posix-normalized, targetDir-relative
 * path — see {@link import('../state/generated-manifest.js').manifestKey})
 * names a codex-track derived file eligible for `update --refresh-derived`.
 */
export function isDerivedTrackKey(key: string): boolean {
  return DERIVED_TRACK_KEY_SET.has(key)
}
