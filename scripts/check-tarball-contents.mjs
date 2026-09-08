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
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { isMainModule } from './lib/run-helpers.mjs'

export const CONSUMER_SCRIPT_ALLOWLIST = new Set()

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
/**
 * Source files that resolve an engine script against the PACKAGE ROOT at runtime. Any
 * `scripts/*.mjs` literal inside one of these is a path the published CLI will try to spawn,
 * so it MUST be in the tarball.
 */
const ENGINE_RESOLVER_ROOT = join('src', 'commands')

/**
 * #2335, and again in #2480: the engine scripts `arbiter doc-set` / `arbiter gold-audit` spawn
 * were omitted from `package.json` files[], so every command threw MODULE_NOT_FOUND for every
 * real consumer and only ever "worked" on a dev checkout, where `scripts/` happens to sit next
 * to the globally-linked `dist/cli.js`. The #2335 fix was a hand-maintained list of literal
 * paths — so it never ratcheted, and the fourth engine (check-arc42-slots.mjs) walked straight
 * through it two waves later.
 *
 * This DERIVES the set instead: every `scripts/*.mjs` literal in a file that calls
 * `packageRoot()`. Adding a route to `engineFor()` now makes its script required automatically,
 * which is what makes the omission unrepresentable rather than merely discouraged (CANON-22 —
 * fix the root cause, not the instance).
 *
 * @param {string} root repo root
 * @returns {string[] | {error: string}} sorted engine paths, or an error when the resolver
 *   directory cannot be read — callers MUST check `.error` before iterating (see #2480 review).
 */
export function derivedEngineScripts(root = process.cwd()) {
  let entries
  try {
    entries = readdirSync(join(root, ENGINE_RESOLVER_ROOT)).filter((f) => f.endsWith('.ts'))
  } catch (err) {
    // Fail CLOSED, and surface it here rather than only through the return value: an unreadable
    // command directory must never become a silent "no engines", because an empty required set is
    // exactly the #2335 shape this derivation exists to make unrepresentable.
    const detail = `cannot read engine resolver directory ${ENGINE_RESOLVER_ROOT}: ${err.message}`
    process.stderr.write(`check-tarball-contents: ${detail}\n`)
    return { error: detail }
  }
  const found = new Set()
  for (const file of entries) {
    const text = readFileSync(join(root, ENGINE_RESOLVER_ROOT, file), 'utf-8')
    // The RESOLVER LIST is derived too. Naming the two files that call packageRoot() today was the
    // same hand-maintained weakness one level up: a third command that started resolving an engine
    // would have been invisible. Every command file is scanned, and only those that actually call
    // packageRoot() can contribute a path.
    if (!text.includes('packageRoot()')) continue
    // Quotes of all three kinds, and a path class that admits subdirectories — `scripts/engines/x.mjs`
    // was missed by a class that excluded the separator.
    for (const m of text.matchAll(/['"`](scripts\/[A-Za-z0-9._/-]+\.mjs)['"`]/g)) found.add(m[1])
  }
  return [...found].sort()
}

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
  {
    label: 'doc-set/gold-audit engine script (scripts/check-doc-style.mjs)',
    test: (p) => p === 'scripts/check-doc-style.mjs',
  },
  {
    label: 'doc-set/gold-audit shared engine lib (scripts/lib/doc-set-resolve.mjs)',
    test: (p) => p === 'scripts/lib/doc-set-resolve.mjs',
  },
  {
    label: 'doc-set/gold-audit shared engine lib (scripts/lib/gold-audit-lib.mjs)',
    test: (p) => p === 'scripts/lib/gold-audit-lib.mjs',
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
export function findMissingRequired(paths, engines = []) {
  const normalised = paths.map((raw) => String(raw).replace(/\\/g, '/').replace(/^\.\//, ''))
  const missing = []
  for (const rule of REQUIRED) {
    if (!normalised.some((p) => rule.test(p))) missing.push({ label: rule.label })
  }
  // Derived rules, appended to the hand-written ones: an engine the published CLI resolves
  // against packageRoot() must be in the tarball or the command throws MODULE_NOT_FOUND and the
  // consumer's gate reports it as a content violation.
  for (const engine of engines) {
    if (!normalised.includes(engine)) {
      missing.push({ label: `CLI-resolved engine script (${engine}) — derived, see #2335/#2480` })
    }
  }
  return missing
}

/** Return development-only lifecycle commands leaked into the packed manifest. */
export function findUnexpectedPublishedScripts(manifest) {
  const scripts = manifest?.scripts
  if (scripts === undefined) return []
  if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return ['<invalid scripts field>']
  }
  return Object.keys(scripts).filter((name) => !CONSUMER_SCRIPT_ALLOWLIST.has(name))
}

function tarEntryName(tar, offset) {
  const readString = (start, length) =>
    tar
      .subarray(offset + start, offset + start + length)
      .toString('utf-8')
      .replace(/\0.*$/s, '')
  const name = readString(0, 100)
  const prefix = readString(345, 155)
  return prefix === '' ? name : `${prefix}/${name}`
}

function readPackedManifest(tarballPath) {
  const tar = gunzipSync(readFileSync(tarballPath))
  let offset = 0
  while (offset + 512 <= tar.length) {
    const name = tarEntryName(tar, offset)
    if (name === '') break
    const sizeText = tar
      .subarray(offset + 124, offset + 136)
      .toString('ascii')
      .replace(/\0.*$/s, '')
      .trim()
    const size = Number.parseInt(sizeText || '0', 8)
    const contentStart = offset + 512
    if (name === 'package/package.json') {
      return JSON.parse(tar.subarray(contentStart, contentStart + size).toString('utf-8'))
    }
    offset = contentStart + Math.ceil(size / 512) * 512
  }
  throw new Error('package/package.json missing from tarball')
}

function packForInspection() {
  const destination = mkdtempSync(join(tmpdir(), 'arbiter-tarball-check-'))
  const result = spawnSync('npm', ['pack', '--json', '--pack-destination', destination], {
    encoding: 'utf-8',
  })
  if (result.status !== 0) {
    rmSync(destination, { recursive: true, force: true })
    return { error: `npm pack failed\n${result.stderr}` }
  }
  try {
    const packed = JSON.parse(result.stdout)
    const entry = packed[0] ?? {}
    const files = Array.isArray(entry.files) ? entry.files.map((f) => f.path) : null
    if (!files || typeof entry.filename !== 'string') {
      return { error: 'file list or filename missing from npm pack output' }
    }
    const manifest = readPackedManifest(join(destination, entry.filename))
    return { files, manifest }
    // FAIL-OPEN-INTENT: converted to an explicit error result; checkTarballContents surfaces it and exits 2.
  } catch (error) {
    return {
      error: `failed to inspect npm pack output: ${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

/**
 * Runs `npm pack --json`, classifies both the file list and packed package.json,
 * writes a report, and returns the exit code. Does not call process.exit so it
 * stays importable/testable.
 *
 * @returns {number} exit code
 */
export function checkTarballContents() {
  const packed = packForInspection()
  if (packed.error) {
    process.stderr.write(`check-tarball-contents: ${packed.error}\n`)
    return 2
  }
  const { files, manifest } = packed
  const engines = derivedEngineScripts()
  if (engines.error !== undefined) return 2
  const violations = classifyTarball(files)
  const missing = findMissingRequired(files, engines)
  const unexpectedScripts = findUnexpectedPublishedScripts(manifest)

  if (violations.length > 0 || missing.length > 0 || unexpectedScripts.length > 0) {
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
    if (unexpectedScripts.length > 0) {
      process.stderr.write(
        `check-tarball-contents: FAIL — published package.json exposes development scripts:\n` +
          unexpectedScripts.map((name) => `  ${name}\n`).join('') +
          `\nOnly the explicit consumer allowlist may ship: ${[...CONSUMER_SCRIPT_ALLOWLIST].join(', ') || '(empty)'}.\n`,
      )
    }
    return 1
  }

  process.stdout.write(
    `check-tarball-contents: OK (${files.length} files, no forbidden paths, ` +
      `${REQUIRED.length + engines.length} required asset(s) present ` +
      `(${engines.length} derived), consumer scripts clean)\n`,
  )
  return 0
}

// Only run when invoked directly (not when imported by tests). Wrapped so any
// unexpected error fails CLOSED (exit 1) rather than crashing with an unhandled
// rejection that a CI step might treat as a soft skip (INV-96 / FAIL_CLOSED.md).
if (isMainModule(import.meta.url)) {
  try {
    process.exit(checkTarballContents())
  } catch (err) {
    process.stderr.write(`check-tarball-contents: unexpected error — ${err?.message ?? err}\n`)
    process.exit(1)
  }
}
