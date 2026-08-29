// SPDX-License-Identifier: Apache-2.0
//
// #2408: the dated allowlist shared by the three doc gates (check-doc-links,
// check-doc-style, check-phantom-command-scan). Removing `internal` from the
// link/style SKIP lists and teaching the phantom scan to read fenced blocks
// surfaces defects whose FIX is a prose/product decision owned by a sibling
// M-A/M-B issue — those files get a dated entry here instead of a silent skip,
// so the gate is green AND the debt is on a clock.
//
// Entry shape: { path, rule, reason, issue, expires }
//   path    repo-relative POSIX path of the file being excused
//   rule    which gate the excuse applies to (see RULES)
//   reason  why it cannot be fixed as a path/frontmatter one-liner right now
//   issue   the batch issue that owns the real fix
//   expires ISO date; the gate goes RED the day after
//
// FAIL-CLOSED by construction: a missing file, a malformed file, a
// malformed entry or an expired entry all exit non-zero. There is no
// "could not read the allowlist, so allow everything" branch — that would
// turn the escape hatch into a bypass.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved from THIS module's location, not process.cwd(): the gates are also
// run against synthetic fixture trees (cwd=<tmpdir>), where a cwd-relative
// lookup would silently find nothing and quietly fail open.
const DEFAULT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'doc-gate-allowlist.json',
)

export const RULES = new Set(['doc-links', 'doc-style', 'phantom-command'])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const REQUIRED_KEYS = ['path', 'rule', 'reason', 'issue', 'expires']

function fail(message) {
  process.stdout.write(`  doc-gate-allowlist: ${message}\n`)
  process.exit(1)
}

/**
 * Shape-validate ONE entry. Every failure is fatal: a malformed excuse is a
 * silent hole in three gates at once.
 */
function validateEntry(entry, index, path) {
  const missing = REQUIRED_KEYS.filter((k) => typeof entry?.[k] !== 'string' || !entry[k])
  if (missing.length > 0) fail(`${path} entry #${index} missing key(s): ${missing.join(', ')}`)
  if (!RULES.has(entry.rule)) fail(`${path} entry #${index} has unknown rule "${entry.rule}"`)
  if (!ISO_DATE.test(entry.expires))
    fail(`${path} entry #${index} expires "${entry.expires}" is not an ISO date (YYYY-MM-DD)`)
}

/** Resolve the allowlist path: `--allowlist=<path>` on argv (fixture seam) or the default. */
function resolveAllowlistPath() {
  const override = process.argv.find((a) => a.startsWith('--allowlist='))
  return override ? resolve(override.slice('--allowlist='.length)) : DEFAULT_PATH
}

/** Read + JSON-parse the allowlist, exiting non-zero on anything unreadable. */
function readAllowlistEntries(path) {
  if (!existsSync(path)) fail(`${path} not found — the allowlist is required (fail-closed)`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    // Surfaced and exited inline rather than through fail(): an unreadable or
    // unparseable allowlist must visibly stop the gate at the catch site.
    process.stdout.write(
      `  doc-gate-allowlist: ${path} failed to parse: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
  if (!Array.isArray(parsed?.entries)) fail(`${path} has no \`entries\` array`)
  return parsed.entries
}

/**
 * Load the allowlist and return the excused-path set for one `rule`.
 *
 * Expiry is validated across EVERY entry, not just the requested rule's: an
 * entry that has run out of time is stale debt no matter which gate happens to
 * load the file first.
 *
 * The path may be overridden with `--allowlist=<path>` on the calling gate's
 * argv (fixture seam, same shape as check-phantom-command-scan's `--ledger=`).
 *
 * @param {string} rule one of RULES
 * @param {string} [todayIso] ISO date to compare `expires` against (defaults to today)
 * @returns {{ has: (relPath: string) => boolean, size: number, path: string }}
 */
export function loadDocGateAllowlist(rule, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!RULES.has(rule)) fail(`unknown rule "${rule}" (known: ${[...RULES].join(', ')})`)

  const path = resolveAllowlistPath()
  const entries = readAllowlistEntries(path)

  const excused = new Set()
  const expired = []
  for (const [i, entry] of entries.entries()) {
    validateEntry(entry, i, path)
    if (entry.expires < todayIso) expired.push(`${entry.path} (${entry.rule}, ${entry.issue})`)
    if (entry.rule === rule) excused.add(entry.path)
  }

  if (expired.length > 0) {
    fail(
      `${expired.length} entry/entries expired — fix the file or re-date the entry with its owner:\n` +
        expired.map((e) => `    expired: ${e}`).join('\n'),
    )
  }

  return { has: (relPath) => excused.has(relPath), size: excused.size, path }
}

/** Human-readable one-liner every gate prints, on every exit path. */
export function allowlistSummary(gate, allow) {
  const rel = relative(process.cwd(), allow.path)
  return `  ${gate}: ${allow.size} file(s) allowlisted (${rel.startsWith('..') ? allow.path : rel})\n`
}
