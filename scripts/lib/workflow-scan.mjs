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

import { existsSync, readdirSync } from 'node:fs'
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
 * Handle the shared `--help`/`-h` and `--dir <path>` arguments.
 *
 * If `--help` or `-h` is present, the provided `usage` string is written to
 * stdout and the process exits 0 (matching the inlined blocks). Otherwise the
 * resolved working directory is returned: the `--dir <path>` value (resolved)
 * when supplied, else `process.cwd()`.
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
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage)
    process.exit(0)
  }
  const dirArg = args.indexOf('--dir')
  const cwd = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()
  return { cwd }
}
