// SPDX-License-Identifier: Apache-2.0
// secret-presence-core.mjs — pure detection for the fail-loud secret-presence guard (#1497).
//
// A LIBRARY module under scripts/lib/, NOT a `check-*.mjs`, so it is exempt from the INV-94
// CATALOG-marker requirement (check-script-cohesion only scans /^check-.+\.mjs$/).
//
// The fake-green it catches: a workflow run-step that depends on a secret, tests that secret for
// emptiness, and then `exit 0` (silent skip) — so a missing/empty secret turns the gate GREEN with
// the real work never done. The ONLY sanctioned skip is an explicit `vars.SKIP_<NAME>` opt-out
// (greppable, audited); otherwise the empty-secret branch must `exit 1` loud.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// Informational workflows whose best-effort steps are not gates (mirrors the
// check-workflow-test-integrity exemption). A silent skip here is legitimate.
const INFORMATIONAL_PATTERNS = ['heartbeat', 'nightly', 'weekly', 'monthly', 'notify']

// GitHub auto-provides this token to every workflow; it is never "empty", so a skip-on-empty for
// it is not a fake-green vector. All OTHER secrets can be unset in a fork/new repo/misconfig.
const ALWAYS_PRESENT_SECRET = 'GITHUB_TOKEN'

/**
 * Split a workflow's text into its `steps:` list items. Robust to deeper-indented `- ` lines
 * inside run scripts (a new step starts only at the established step-dash indent) and to multiple
 * jobs. Conservative by design — a step split early by an EJS control line yields at most a
 * false-negative, never a false-positive.
 *
 * @param {string} content
 * @returns {string[]} step blocks (each the joined lines of one step)
 */
export function extractSteps(content) {
  const lines = content.split('\n')
  const steps = []
  let cur = null
  let inSteps = false
  let stepsIndent = null
  let stepDashIndent = null
  const flush = () => {
    if (cur) steps.push(cur.join('\n'))
    cur = null
  }
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur) cur.push(line)
      continue
    }
    const indent = line.length - line.trimStart().length
    const stepsKey = /^(\s*)steps:\s*$/.exec(line)
    if (stepsKey) {
      flush()
      inSteps = true
      stepsIndent = stepsKey[1].length
      stepDashIndent = null
      continue
    }
    if (!inSteps) continue
    // End the steps block only on a real YAML key dedented to <= the `steps:` indent (a sibling or
    // parent mapping key). EJS control tags (`<% } %>`), `#` comments and blank lines at column 0 —
    // common in `.ejs` templates — must NOT end the block, or steps after them are missed.
    if (indent <= stepsIndent && /^\s*[\w-]+:(\s|$)/.test(line)) {
      flush()
      inSteps = false
      continue
    }
    const dash = /^(\s*)-\s/.exec(line)
    if (dash && (stepDashIndent === null || dash[1].length === stepDashIndent)) {
      stepDashIndent = dash[1].length
      flush()
      cur = [line]
      continue
    }
    if (cur) cur.push(line)
  }
  flush()
  return steps
}

/**
 * Analyze a single step block for the unguarded silent-skip-on-empty-secret idiom.
 * @param {string} stepText
 * @returns {string|null} comma-joined secret-backed var names when a violation is found, else null.
 */
export function analyzeStep(rawStepText) {
  // Strip comments first: a commented-out opt-out (`# SKIP_FAKE=true`) must NOT satisfy the guard,
  // and a commented `exit 0` is not a real skip. Drop a `#` comment that starts a line or follows
  // whitespace — sufficient for workflow run scripts (we only inspect skip/test/SKIP tokens, never
  // echo payloads). This closes the "bogus comment fakes the opt-out" fake-green.
  const stepText = rawStepText
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '$1'))
    .join('\n')

  // Secret-backed variables: `VAR: ${{ secrets.X }}` (env) or `VAR="${{ secrets.X }}"` (run assign).
  const secretVars = new Set()
  const reBind = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*"?\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}/g
  let m
  while ((m = reBind.exec(stepText))) {
    if (m[2] === ALWAYS_PRESENT_SECRET) continue
    secretVars.add(m[1])
  }
  // Direct emptiness test on an interpolated secret: `-z "${{ secrets.X }}"`.
  const directSecretEmpty = /-[zn]\s+"?\$\{\{\s*secrets\.([A-Za-z0-9_]+)/.exec(stepText)
  const direct = directSecretEmpty && directSecretEmpty[1] !== ALWAYS_PRESENT_SECRET

  if (secretVars.size === 0 && !direct) return null

  // The step must reach a silent skip: a bare `exit 0`.
  if (!/\bexit\s+0\b/.test(stepText)) return null

  // The emptiness test must reference a secret-backed variable (ties the skip to the secret).
  let emptyOnSecret = Boolean(direct)
  for (const v of secretVars) {
    if (new RegExp(`-[zn]\\s+"?\\$\\{?${v}\\b`).test(stepText)) {
      emptyOnSecret = true
      break
    }
  }
  if (!emptyOnSecret) return null

  // Sanctioned opt-out: a REAL `SKIP_<NAME> = true` shell comparison in the (comment-stripped) run
  // — the audited, greppable switch that gates the skip. A `vars.SKIP_<NAME>` env binding alone is
  // NOT enough (a declared-but-unused var must not disarm the guard); the run must actually test it.
  // A loud `exit 1`-only branch never reaches here (it has no `exit 0`).
  const hasOptOut = /SKIP_[A-Za-z0-9_]+["}]*\s*(?:==?|!=)\s*["']?true/.test(stepText)
  if (hasOptOut) return null

  return secretVars.size > 0 ? [...secretVars].join(', ') : `secrets.${directSecretEmpty[1]}`
}

/**
 * Scan one workflow (or `.ejs` template) file for unguarded secret-skip steps.
 * @param {string} filePath
 * @returns {string[]} human-readable findings (empty when clean / exempt / unreadable).
 */
export function findSecretSkipViolations(filePath) {
  const name = basename(filePath).replace(/\.ejs$/, '')
  if (INFORMATIONAL_PATTERNS.some((p) => name.includes(p))) return []
  let content
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }
  const findings = []
  for (const step of extractSteps(content)) {
    const vars = analyzeStep(step)
    if (vars) {
      const stepName = /name:\s*(.+)/.exec(step)
      const label = stepName ? stepName[1].trim() : '(unnamed step)'
      findings.push(
        `${filePath}: step "${label}" skips on empty secret (${vars}) without vars.SKIP_ opt-out`,
      )
    }
  }
  return findings
}
