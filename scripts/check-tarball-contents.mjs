#!/usr/bin/env node
// CATALOG: Publish-boundary leak gate — inspects the actual `npm pack` manifest and
// CATALOG: fails if a forbidden path (docs/internal/** maintainer runbooks, stray
// CATALOG: *.arbiter-backup editor artifacts) would ship to the registry. Distinct
// CATALOG: from check-pack-size.mjs (byte budget, not content) and from
// CATALOG: check-private-paths-ignored.mjs (git-ignore status, not the published tarball).
/**
 * Verifies the published npm tarball ships NO maintainer-internal or working-tree
 * cruft. The `package.json` "files" allowlist is the primary curation, but a
 * wholesale directory entry (e.g. `"docs"`) silently re-includes everything beneath
 * it — including `docs/internal/**` runbooks and stray `*.arbiter-backup` editor
 * artifacts — and an in-directory `.npmignore` subpath is NOT honored once the parent
 * is in `files[]`. This guard inspects the ACTUAL `npm pack` manifest (not the source
 * tree, not `.gitignore`) so a leak is caught at the only surface that matters: what a
 * consumer downloads from the registry.
 *
 * Usage:
 *   node scripts/check-tarball-contents.mjs           # L1 gate
 *   node scripts/check-tarball-contents.mjs --strict  # prepublishOnly (identical policy)
 *
 * Exit codes:
 *   0 — no forbidden path in the tarball
 *   1 — at least one forbidden path would ship
 *   2 — could not run `npm pack` / parse its output
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Forbidden-path matchers. Each entry has a human `label` and a `test(path)` predicate
 * run against every tarball entry path (POSIX, package-root-relative, no leading `./`).
 * Kept declarative so the policy is one obvious list and `classifyTarball` stays pure.
 */
export const FORBIDDEN = [
  {
    label: 'maintainer-internal docs (docs/internal/**)',
    test: (p) => p === 'docs/internal' || p.startsWith('docs/internal/'),
  },
  {
    label: 'editor/working-tree backup (*.arbiter-backup)',
    test: (p) => p.endsWith('.arbiter-backup'),
  },
]

/**
 * Required-path matchers. The leak guard catches what ships that should NOT; this
 * catches what must ship but is MISSING. Runtime data files that the compiled code
 * reads at execution time (resolved next to their emitted `.js`) must be in the
 * tarball or the published command throws `ENOENT` on first read — invisible to
 * source-tree gates and to the dev checkout (where `src/` is still present). The
 * kit catalog/derived data was exactly this class of silent omission (#1575, same
 * family as the closed #1011). Each entry has a human `label` and a `test(path)`
 * predicate; the manifest must contain at least one path that satisfies it.
 */
export const REQUIRED = [
  {
    label: 'kit catalog runtime data (dist/kit/catalog.json)',
    test: (p) => p === 'dist/kit/catalog.json',
  },
  {
    label: 'kit derived runtime data (dist/kit/derived.json)',
    test: (p) => p === 'dist/kit/derived.json',
  },
  {
    label: 'kit canonical-mapping runtime data (dist/kit/canonical-mapping.json)',
    test: (p) => p === 'dist/kit/canonical-mapping.json',
  },
]

/**
 * Pure classifier. Given the list of tarball entry paths, returns every forbidden
 * path with the label of the rule it tripped. Side-effect-free so every rule is
 * unit-testable without spawning `npm pack`.
 *
 * @param {string[]} paths package-root-relative POSIX paths
 * @returns {Array<{ path: string, label: string }>} violations (empty = clean)
 */
export function classifyTarball(paths) {
  const violations = []
  for (const raw of paths) {
    // Normalise to the form npm emits: POSIX separators, no leading "./".
    const p = String(raw).replace(/\\/g, '/').replace(/^\.\//, '')
    for (const rule of FORBIDDEN) {
      if (rule.test(p)) {
        violations.push({ path: p, label: rule.label })
        break
      }
    }
  }
  return violations
}

/**
 * Pure presence check. Given the tarball entry paths, returns every REQUIRED rule
 * that nothing in the manifest satisfies. Side-effect-free so the required-asset
 * policy is unit-testable without spawning `npm pack`.
 *
 * @param {string[]} paths package-root-relative POSIX paths
 * @returns {Array<{ label: string }>} unmet requirements (empty = all present)
 */
export function findMissingRequired(paths) {
  const normalised = paths.map((raw) => String(raw).replace(/\\/g, '/').replace(/^\.\//, ''))
  const missing = []
  for (const rule of REQUIRED) {
    if (!normalised.some((p) => rule.test(p))) missing.push({ label: rule.label })
  }
  return missing
}

/**
 * Runs `npm pack --dry-run --json`, classifies the manifest, writes a report, and
 * returns the exit code. Does not call process.exit so it stays importable/testable.
 *
 * @returns {number} exit code
 */
export function checkTarballContents() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf-8' })

  if (result.status !== 0) {
    process.stderr.write(`check-tarball-contents: npm pack failed\n${result.stderr}\n`)
    return 2
  }

  let packed
  try {
    packed = JSON.parse(result.stdout)
  } catch {
    process.stderr.write(`check-tarball-contents: failed to parse npm pack JSON output\n`)
    return 2
  }

  const entry = packed[0] ?? {}
  const files = Array.isArray(entry.files) ? entry.files.map((f) => f.path) : null
  if (!files) {
    process.stderr.write(`check-tarball-contents: file list missing from npm pack output\n`)
    return 2
  }

  const violations = classifyTarball(files)
  const missing = findMissingRequired(files)

  if (violations.length > 0 || missing.length > 0) {
    if (violations.length > 0) {
      process.stderr.write(
        `check-tarball-contents: FAIL — ${violations.length} forbidden path(s) would ship:\n`,
      )
      for (const v of violations) {
        process.stderr.write(`  ${v.path}  [${v.label}]\n`)
      }
      process.stderr.write(
        `\nCurate package.json "files" (negate the offending subpath, e.g. "!docs/internal")\n` +
          `or remove the working-tree artifact. A wholesale dir entry re-includes everything beneath it.\n`,
      )
    }
    if (missing.length > 0) {
      process.stderr.write(
        `check-tarball-contents: FAIL — ${missing.length} required runtime asset(s) are MISSING:\n`,
      )
      for (const m of missing) {
        process.stderr.write(`  [${m.label}]\n`)
      }
      process.stderr.write(
        `\nThe compiled code reads these at runtime; without them the published command\n` +
          `throws ENOENT on first use. Ensure the build step copies them into dist/ and\n` +
          `that package.json "files" ships the dist subtree.\n`,
      )
    }
    return 1
  }

  process.stdout.write(
    `check-tarball-contents: OK (${files.length} files, no forbidden paths, ${REQUIRED.length} required asset(s) present)\n`,
  )
  return 0
}

// Only run when invoked directly (not when imported by tests). Wrapped so any
// unexpected error fails CLOSED (exit 1) rather than crashing with an unhandled
// rejection that a CI step might treat as a soft skip (INV-96 / FAIL_CLOSED.md).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(checkTarballContents())
  } catch (err) {
    process.stderr.write(`check-tarball-contents: unexpected error — ${err?.message ?? err}\n`)
    process.exit(1)
  }
}
