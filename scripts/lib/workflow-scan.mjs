// SPDX-License-Identifier: Apache-2.0
// workflow-scan.mjs — shared helpers for the workflow/action check-*.mjs gate scripts (#1096).
//
// Two pieces of boilerplate were duplicated across the workflow/action checkers:
//
//   1. collectYamlFiles(dir) — a recursive .yml/.yaml walker (symlink-skipping),
//      defined verbatim in 5 scripts (check-action-pins, check-workflow-job-naming,
//      check-workflow-runners, check-workflow-sha-pinning, check-workflow-test-integrity).
//   2. The `--help` / `--dir` argument block (Usage + Options + dir resolution),
//      duplicated in the W6 anti-drift validators.
//
// This is a LIBRARY module under scripts/lib/, NOT a `check-*.mjs`, so it is
// exempt from the INV-94 CATALOG-marker requirement (check-script-cohesion only
// scans files matching /^check-.+\.mjs$/).
//
// The extraction is behavior-preserving: each export reproduces the exact logic
// of the inlined originals. collectYamlFiles takes an optional onReadError hook
// because check-action-pins emits a warn line on readdir failure while the W6
// scripts swallow it silently — the hook keeps both behaviors byte-identical.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Recursively collect `.yml`/`.yaml` file paths under `dir`.
 *
 * Mirrors the inlined walker: returns [] when the directory does not exist,
 * skips symbolic links, recurses into subdirectories, and on a readdir error
 * returns the results gathered so far (after invoking `onReadError`, if given).
 *
 * @param {string} dir Directory to scan.
 * @param {{ onReadError?: (dir: string, err: Error) => void }} [opts]
 *   onReadError is invoked when readdirSync throws (e.g. EACCES). When omitted,
 *   the error is swallowed silently, matching the W6 validators.
 * @returns {string[]} Absolute (or `dir`-relative) paths of matching files.
 */
export function collectYamlFiles(dir, { onReadError } = {}) {
  if (!existsSync(dir)) return []
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (onReadError) onReadError(dir, /** @type {Error} */ (err))
    return results
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(full, { onReadError }))
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(full)
    }
  }
  return results
}

/**
 * Recursively collect workflow TEMPLATE files (`.ejs`) that live under any
 * `workflows/` directory within `templatesRoot` (e.g. `src/templates/`).
 *
 * Arbiter emits these templates verbatim into a consumer project's
 * `.github/workflows/`, so a non-SHA / fabricated action pin in a template
 * ships a broken, unverifiable reference to every generated project while the
 * arbiter self-gate (which only walks arbiter's own `.github/`) stays green.
 * This walker lets the pin gate also vet the emitted source (#1491).
 *
 * Returns [] when `templatesRoot` does not exist. Mirrors collectYamlFiles:
 * skips symlinks, recurses into subdirectories, invokes `onReadError` (if
 * given) on a readdir failure and returns results gathered so far.
 *
 * @param {string} templatesRoot Root of the template tree (e.g. src/templates).
 * @param {{ onReadError?: (dir: string, err: Error) => void }} [opts]
 * @returns {string[]} Paths of `*.ejs` files under a `workflows/` directory.
 */
export function collectWorkflowTemplates(templatesRoot, { onReadError } = {}) {
  if (!existsSync(templatesRoot)) return []
  const results = []
  const walk = (dir, inWorkflows) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if (onReadError) onReadError(dir, /** @type {Error} */ (err))
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, inWorkflows || entry.name === 'workflows')
      } else if (inWorkflows && entry.isFile() && entry.name.endsWith('.ejs')) {
        results.push(full)
      }
    }
  }
  walk(templatesRoot, false)
  return results
}

/**
 * Scan `args` for a `--dir` flag in either `--dir value` or `--dir=value` form.
 * A LEFT-TO-RIGHT scan that overwrites on each match is "last flag wins" for free,
 * across both forms mixed (#2675 Codex round-2).
 *
 * @param {string[]} args
 * @returns {{ given: boolean, value: string | undefined }} `given` is true when any
 *   `--dir`/`--dir=` token appears; `value` is the raw (unvalidated) text that followed
 *   it, or `undefined` for a trailing bare `--dir` with nothing after it.
 */
function scanDirFlag(args) {
  let given = false
  let value
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dir') {
      given = true
      value = args[i + 1]
    } else if (a.startsWith('--dir=')) {
      given = true
      value = a.slice('--dir='.length)
    }
  }
  return { given, value }
}

/**
 * A `--dir` value that cannot be a real path: missing, empty, or flag-shaped (starts with
 * `--`, meaning `--dir` swallowed the NEXT flag as its own value rather than being given one).
 * #2675 Codex round-3: `--dir --help` used to swallow `--help` as this validity check ran
 * AFTER the generic `--help` scan, so the malformed `--dir` was invisible and the process
 * printed help and exited 0 instead of refusing the invocation it actually received.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isUnusableDirValue(value) {
  return value === undefined || value === '' || value.startsWith('--')
}

/**
 * Handle the shared `--help`/`-h` and `--dir <path>`/`--dir=<path>` arguments.
 *
 * If `--help` or `-h` is present, the provided `usage` string is written to
 * stdout and the process exits 0 (matching the inlined blocks). Otherwise the
 * resolved working directory is returned: the `--dir` value (resolved) when
 * supplied, else `process.cwd()`.
 *
 * #2675 Codex round-1: a bare `--dir` (no value), or a `--dir` naming a path that
 * does not exist or is not a directory, used to fall back to `process.cwd()`
 * SILENTLY — an explicit scan-root request that could never be honored was
 * indistinguishable from none being given at all, and the caller's own
 * fixture-less SKIP paths would then quietly report clean on the live repo
 * instead of the intended (missing) target. Both are now a loud `exit(2)`:
 * an unusable `--dir` must never be read as "use the default". Round-2 closed
 * `--dir ''` (empty is not `undefined`, but `resolve('')` IS `process.cwd()`) and
 * made a repeated flag deterministic (last occurrence, across `--dir v` and
 * `--dir=v` both). Round-3 accepts `--dir=v` and validates the --dir value BEFORE
 * the `--help` scan, so `--dir --help` refuses rather than printing help.
 *
 * Script-specific flags (e.g. `--runner`) are NOT consumed here; the caller
 * parses them from the same `args` array as before.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {{ usage: string }} opts Pre-formatted usage text (already including a
 *   trailing newline), printed verbatim on `--help`.
 * @returns {{ cwd: string }} Resolved working directory.
 */
export function parseHelpAndDir(args, { usage }) {
  const { given, value } = scanDirFlag(args)
  if (given && isUnusableDirValue(value)) {
    process.stderr.write('--dir requires a path argument\n')
    process.exit(2)
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage)
    process.exit(0)
  }
  if (!given) return { cwd: process.cwd() }
  const resolved = resolve(value)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    process.stderr.write(`--dir ${value} does not exist or is not a directory\n`)
    process.exit(2)
  }
  return { cwd: resolved }
}
