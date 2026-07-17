// SPDX-License-Identifier: Apache-2.0
// CATALOG: #1984 — shared stale-dist guard consumed by check-self-dogfood.mjs
// CATALOG:   (R-02 external CI-surface parity) and check-codex-self-parity.mjs
// CATALOG:   (emission via compiled dist). Both gates dynamically import
// CATALOG:   compiled JS from dist/ because scripts/ cannot import .ts
// CATALOG:   directly (#1267); their existing catch blocks only handled a
// CATALOG:   MISSING/unimportable build, not a STALE one built before the
// CATALOG:   current src/ changes — a stale dist silently reported green.
// CATALOG:   A single mtime-comparison helper closes the gap for both call
// CATALOG:   sites instead of duplicating the walk-and-compare logic.
//
// Pure module — no process exit. Callers decide how to surface `fresh: false`
// (both current consumers fail closed with an exit-2-class error).
import { statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { walkRepo } from './glob-walk.mjs'

/** Default src/ subtrees the dist-consuming gates actually depend on (#1984). */
export const DEFAULT_WATCHED_SRC_DIRS = [
  'src/generators',
  'src/templates',
  'src/utils',
  'src/config',
]

/**
 * Newest mtimeMs found by walking `root`/`relDir`, or -Infinity if the dir is
 * absent/empty/unreadable (walkRepo already swallows per-entry stat errors).
 */
function newestMtimeMs(root, relDir) {
  const abs = join(root, relDir)
  if (!existsSync(abs)) return -Infinity
  let newest = -Infinity
  for (const rel of walkRepo(abs)) {
    try {
      const mtimeMs = statSync(join(abs, rel)).mtimeMs
      if (mtimeMs > newest) newest = mtimeMs
    } catch {
      // FAIL-OPEN-INTENT: a single unreadable file cannot make the whole
      // freshness check throw — it is excluded from the max and the
      // comparison proceeds over the remaining, readable files.
    }
  }
  return newest
}

/**
 * Compare the newest mtime under `dist/` against the newest mtime under the
 * watched src/ subtrees. Fails closed (fresh: false) when dist/ is missing,
 * empty, or predates the newest watched source file — the same class of
 * failure as a missing/unimportable build.
 *
 * @param {string} root - repo root containing both `dist/` and the src dirs.
 * @param {{ srcDirs?: string[] }} [opts] - override the watched src subtrees.
 * @returns {{ fresh: boolean, reason?: string }}
 */
export function checkDistFresh(root, opts = {}) {
  // NOTE: this guard trusts filesystem mtimes, which assumes a freshly-built
  // dist/. A tar-based cache restore (e.g. actions/cache) preserves each
  // archived file's original mtime, so a cache-restored dist/ can compare as
  // fresh (or stale) independent of whether it actually matches current src/.
  // CI jobs that wire cache-restore together with this guard must rebuild
  // dist/ after restoring, not rely on the restored mtimes.
  const srcDirs = opts.srcDirs ?? DEFAULT_WATCHED_SRC_DIRS
  const distMtime = newestMtimeMs(root, 'dist')
  if (distMtime === -Infinity) {
    return {
      fresh: false,
      reason: 'dist/ is missing or empty. Run "npm run build" first.',
    }
  }
  let newestSrc = -Infinity
  for (const dir of srcDirs) {
    const m = newestMtimeMs(root, dir)
    if (m > newestSrc) newestSrc = m
  }
  if (newestSrc > distMtime) {
    return {
      fresh: false,
      reason:
        'dist/ predates the newest watched src/ file — the build is stale. ' +
        'Run "npm run build" first.',
    }
  }
  return { fresh: true }
}
