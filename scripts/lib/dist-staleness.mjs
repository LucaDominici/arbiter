// SPDX-License-Identifier: Apache-2.0
// CATALOG: #1984/#2089 — shared stale-dist guard consumed by
// CATALOG:   check-self-dogfood.mjs (R-02 external CI-surface parity) and
// CATALOG:   check-codex-self-parity.mjs (emission via compiled dist). Both
// CATALOG:   gates dynamically import compiled JS from dist/ because scripts/
// CATALOG:   cannot import .ts directly (#1267); their catch blocks only handled
// CATALOG:   a MISSING build, not a STALE one — a stale dist silently reported
// CATALOG:   green. A single freshness helper closes the gap for both call sites.
// CATALOG:
// CATALOG:   #2089: the freshness check was mtime-based (newest src/ mtime vs
// CATALOG:   newest dist/ mtime), which false-positived stale in two ways with no
// CATALOG:   content change: (a) CI cache-restore skew — `git checkout` resets
// CATALOG:   src/ mtimes to checkout time while an actions/cache-restored dist/
// CATALOG:   keeps its older cache mtime, so any cache HIT looks stale; (b) local
// CATALOG:   edit-then-verify skew — any Edit/Write bumps a src/ file's mtime to
// CATALOG:   now even when the bytes are unchanged (touch / same-content rewrite).
// CATALOG:   It now compares a CONTENT hash of the watched src/ files against the
// CATALOG:   hash writeDistManifest() records inside dist/ at build time, so
// CATALOG:   filesystem timestamps never enter the decision.
//
// Pure comparison — checkDistFresh() has no process exit; callers decide how to
// surface `fresh: false` (both fail closed with an exit-2-class error).
// writeDistManifest() is the one writer: it is invoked ONLY from the full
// `npm run build` (scripts/write-dist-manifest.mjs), never from build-kit.mjs —
// build-kit reruns after the CI cache-restore and would regenerate the manifest
// against current src/, making the freshness guard vacuous.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { walkRepo } from './glob-walk.mjs'

/** Default src/ subtrees the dist-consuming gates actually depend on (#1984). */
export const DEFAULT_WATCHED_SRC_DIRS = [
  'src/generators',
  'src/templates',
  'src/utils',
  'src/config',
]

/** Manifest, written inside dist/ so it travels with an actions/cache save+restore (#2089). */
export const MANIFEST_REL_PATH = 'dist/.src-manifest.json'

/**
 * sha256 over every watched src/ file: repo-root-relative POSIX path + NUL +
 * bytes + NUL, in path order. Keyed on the RELATIVE path (never the absolute
 * root) so the digest is identical across machines/CI runners with different
 * checkout locations. walkRepo already prunes dist/ and vendor trees and yields
 * paths relative to the walked dir.
 *
 * @param {string} root - repo root containing the watched src dirs.
 * @param {string[]} [srcDirs] - override the watched src subtrees.
 * @returns {string} lowercase hex sha256.
 */
export function computeWatchedSrcHash(root, srcDirs = DEFAULT_WATCHED_SRC_DIRS) {
  /** @type {Array<[string, Buffer]>} */
  const entries = []
  for (const dir of srcDirs) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const rel of walkRepo(abs)) {
      try {
        entries.push([`${dir}/${rel}`, readFileSync(join(abs, rel))])
      } catch {
        // FAIL-OPEN-INTENT: a single unreadable file cannot make the whole hash
        // throw — it is excluded here AND (identically) by writeDistManifest, so
        // a consistently-unreadable file hashes the same on both sides. Only a
        // TRANSIENTLY unreadable file diverges, and that fails closed (stale).
      }
    }
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const h = createHash('sha256')
  for (const [relKey, content] of entries) {
    h.update(relKey)
    h.update('\0')
    h.update(content)
    h.update('\0')
  }
  return h.digest('hex')
}

/**
 * Record the watched src/ content hash at dist/.src-manifest.json. Invoked as
 * the LAST step of `npm run build` (scripts/write-dist-manifest.mjs). Throws on
 * write failure — fail-closed by nature (a build that cannot record its manifest
 * must not report success).
 *
 * @param {string} root - repo root; dist/ is created if absent.
 * @param {{ srcDirs?: string[] }} [opts]
 * @returns {string} the recorded hash.
 */
export function writeDistManifest(root, opts = {}) {
  const srcDirs = opts.srcDirs ?? DEFAULT_WATCHED_SRC_DIRS
  const srcHash = computeWatchedSrcHash(root, srcDirs)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, MANIFEST_REL_PATH), `${JSON.stringify({ srcHash })}\n`)
  return srcHash
}

/** Read the recorded srcHash, or null if dist/manifest is absent/malformed. */
function readManifestHash(root) {
  const manifestPath = join(root, MANIFEST_REL_PATH)
  if (!existsSync(manifestPath)) return null
  // JSON.parse can throw only on a truncated/corrupt manifest (interrupted
  // write) — a loud throw there is the correct fail-closed outcome, and a
  // rebuild fixes it. The common missing-manifest path is handled above.
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  return parsed && typeof parsed.srcHash === 'string' ? parsed.srcHash : null
}

/**
 * Report whether dist/ is fresh relative to the watched src/ subtrees by
 * comparing content hashes (#2089 — never filesystem mtimes). Fails closed
 * (fresh: false) when dist/ is missing, its manifest is missing/malformed, or
 * the current watched src/ content differs from what the manifest recorded.
 *
 * @param {string} root - repo root containing both `dist/` and the src dirs.
 * @param {{ srcDirs?: string[] }} [opts] - override the watched src subtrees.
 * @returns {{ fresh: boolean, reason?: string }}
 */
export function checkDistFresh(root, opts = {}) {
  const srcDirs = opts.srcDirs ?? DEFAULT_WATCHED_SRC_DIRS
  if (!existsSync(join(root, 'dist'))) {
    return {
      fresh: false,
      reason: 'dist/ is missing or empty. Run "npm run build" first.',
    }
  }
  const recorded = readManifestHash(root)
  if (recorded === null) {
    return {
      fresh: false,
      reason:
        'dist/ build manifest (dist/.src-manifest.json) is missing — the build ' +
        'is stale or predates this check. Run "npm run build" first.',
    }
  }
  if (computeWatchedSrcHash(root, srcDirs) !== recorded) {
    return {
      fresh: false,
      reason:
        'dist/ was built from different src/ content than is present now — the ' +
        'build is stale. Run "npm run build" first.',
    }
  }
  return { fresh: true }
}
