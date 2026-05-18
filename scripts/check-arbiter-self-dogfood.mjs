#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter self-dogfood gate (INV-75 + INV-76 internal).
//
// Mirrors the gate logic of src/templates/scripts/check-action-pins.mjs.ejs and
// check-workflow-perms.mjs.ejs against arbiter's own .github/workflows so the
// framework that ships these gates also passes them.
//
// Baseline-ratchet model (mirrors .bloat-baseline.json):
//   - Current violation counts are frozen in .self-dogfood-baseline.json.
//   - Gate FAILS if any count grows above its baseline (monotone improvement).
//   - Gate PASSES when counts match or shrink. Refresh baseline only after
//     intentional fixes; never bump silently to make the gate green.
//
// Drift note: the inline logic below MUST stay in sync with the EJS templates
// in src/templates/scripts/. Render-equivalence is covered by template render
// tests in __tests__/templates/github-setup-render.test.ts.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CWD = process.cwd()
const REPO_ROOT = join(__dirname, '..')
const BASELINE_PATH = join(REPO_ROOT, '.self-dogfood-baseline.json')
const EXEMPTIONS_PATH = join(REPO_ROOT, '.arbiter', 'workflow-exemptions.json')

function loadExemptions() {
  if (!existsSync(EXEMPTIONS_PATH)) return { actionPinsExempt: [], workflowPermsExempt: [] }
  try {
    const raw = JSON.parse(readFileSync(EXEMPTIONS_PATH, 'utf-8'))
    return {
      actionPinsExempt: Array.isArray(raw.actionPinsExempt) ? raw.actionPinsExempt : [],
      workflowPermsExempt: Array.isArray(raw.workflowPermsExempt) ? raw.workflowPermsExempt : [],
    }
  } catch (err) {
    console.error(
      `check-arbiter-self-dogfood: exemptions at ${EXEMPTIONS_PATH} malformed JSON (${err.message}); treating as empty`,
    )
    return { actionPinsExempt: [], workflowPermsExempt: [] }
  }
}

const EXEMPTIONS = loadExemptions()

function isExempt(absFile, exemptList) {
  const rel = absFile.startsWith(REPO_ROOT) ? absFile.slice(REPO_ROOT.length + 1) : absFile
  return exemptList.includes(rel)
}

function collectYamlFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      // Surface symlink skips so a symlinked-away workflow tree cannot
      // silently hide violations during traversal.
      console.error(`  skipping symlink: ${join(dir, entry.name)}`)
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectYamlFiles(full))
    else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')))
      out.push(full)
  }
  return out
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function countWorkflowPermsViolations() {
  const dir = join(REPO_ROOT, '.github', 'workflows')
  if (!existsSync(dir)) return 0
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => join(dir, f))
  let count = 0
  for (const file of files) {
    if (isExempt(file, EXEMPTIONS.workflowPermsExempt)) continue
    const content = readFileSync(file, 'utf-8')
    const m = content.match(/^permissions:[ \t]*(.*)$/m)
    if (!m) {
      count++
      continue
    }
    if (m[1].trim() === 'write-all') count++
  }
  return count
}

function countActionPinsViolations() {
  const SHA = /^[0-9a-f]{40}$/i
  const USES = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)["']?/gm
  const files = [
    ...collectYamlFiles(join(REPO_ROOT, '.github', 'workflows')),
    ...collectYamlFiles(join(REPO_ROOT, '.github', 'actions')),
  ]
  let count = 0
  for (const file of files) {
    if (isExempt(file, EXEMPTIONS.actionPinsExempt)) continue
    const content = readFileSync(file, 'utf-8')
    for (const match of content.matchAll(USES)) {
      const action = stripQuotes(match[1])
      const ref = stripQuotes(match[2])
      if (action.startsWith('.') || action.startsWith('docker://')) continue
      if (!SHA.test(ref)) count++
    }
  }
  return count
}

const args = process.argv.slice(2)
const refresh = args.includes('--refresh-baseline')

// Refuse to operate if BOTH expected directories are absent — protects against
// running from the wrong cwd, a partial worktree, or an uninitialized submodule
// that would otherwise lock in a misleading zero-baseline.
const hasWorkflowsDir = existsSync(join(REPO_ROOT, '.github', 'workflows'))
const hasActionsDir = existsSync(join(REPO_ROOT, '.github', 'actions'))
if (!hasWorkflowsDir && !hasActionsDir) {
  console.error(
    `check-arbiter-self-dogfood: neither .github/workflows nor .github/actions exists at ${REPO_ROOT} — refusing to run (wrong cwd?)`,
  )
  process.exit(2)
}

const current = {
  workflowPermsViolations: countWorkflowPermsViolations(),
  actionPinsViolations: countActionPinsViolations(),
}

if (refresh) {
  const payload = {
    capturedAt: new Date().toISOString(),
    note: 'Arbiter self-dogfood baseline. Counts must shrink monotonically.',
    ...current,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n')
  console.log(`check-arbiter-self-dogfood: baseline refreshed → ${BASELINE_PATH}`)
  console.log(JSON.stringify(current, null, 2))
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `check-arbiter-self-dogfood: no baseline at ${BASELINE_PATH}; run with --refresh-baseline first`,
  )
  process.exit(2)
}

const REQUIRED_KEYS = ['workflowPermsViolations', 'actionPinsViolations']
let baseline
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
} catch (err) {
  console.error(
    `check-arbiter-self-dogfood: baseline at ${BASELINE_PATH} is malformed JSON (${err.message}); re-run with --refresh-baseline to repair`,
  )
  process.exit(2)
}
const missingKeys = REQUIRED_KEYS.filter((k) => typeof baseline[k] !== 'number')
if (missingKeys.length > 0) {
  console.error(
    `check-arbiter-self-dogfood: baseline at ${BASELINE_PATH} missing numeric keys: ${missingKeys.join(', ')}; re-run with --refresh-baseline`,
  )
  process.exit(2)
}

const failures = []
for (const key of REQUIRED_KEYS) {
  if (current[key] > baseline[key]) {
    failures.push(`${key}: ${current[key]} > baseline ${baseline[key]} (new violations introduced)`)
  }
}

if (failures.length === 0) {
  const shrank = [
    current.workflowPermsViolations < baseline.workflowPermsViolations
      ? `workflowPerms ${baseline.workflowPermsViolations}→${current.workflowPermsViolations}`
      : null,
    current.actionPinsViolations < baseline.actionPinsViolations
      ? `actionPins ${baseline.actionPinsViolations}→${current.actionPinsViolations}`
      : null,
  ].filter(Boolean)
  const tail = shrank.length ? ` (improvement: ${shrank.join(', ')})` : ''
  console.log(
    `check-arbiter-self-dogfood: PASS — workflow-perms=${current.workflowPermsViolations}/${baseline.workflowPermsViolations} action-pins=${current.actionPinsViolations}/${baseline.actionPinsViolations}${tail}`,
  )
  if (shrank.length) {
    console.log(
      `check-arbiter-self-dogfood: refresh baseline with --refresh-baseline to lock in the improvement`,
    )
  }
  process.exit(0)
}

console.error('check-arbiter-self-dogfood: FAIL — new violations introduced')
for (const f of failures) console.error(`  ${f}`)
process.exit(1)
