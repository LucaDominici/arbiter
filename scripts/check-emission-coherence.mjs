#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — emission-coherence gate (INV-123, #1331)
//
// CATALOG: cross-reference coherence of an arbitrary GENERATED tree — every
// CATALOG: script/hook/workflow/settings reference must resolve to an emitted file.
// CATALOG: rejected fold-in into check-self-dogfood.mjs — that checks template-vs-
// CATALOG: materialized BYTE-DRIFT of arbiter's OWN checked-in tree; this checks
// CATALOG: reference EXISTENCE across the full matrix in a tmpdir (different input
// CATALOG: root, lifecycle, and failure class).
// CATALOG: rejected fold-in into check-workflow-sha-pinning.mjs / -job-naming.mjs —
// CATALOG: those lint .github/workflows in the repo; this lints a generated tmpdir
// CATALOG: and additionally resolves scripts/hooks/githooks/settings references.
//
// Static lint of an arbiter-generated tree: every script / hook / workflow
// reference in the emission must resolve to a file that actually exists. Catches
// "referenced but never emitted" ghosts (the class behind #1318/#1319) in
// milliseconds, no toolchains — affordable across the FULL (language × level ×
// mode) matrix on every PR (the matrix runner is the integration test).
//
// Semantics (#1331 AC2, red-team RT-02):
//   - UNGUARDED missing reference  → ALWAYS FAIL (crash class).
//   - GUARDED missing reference    → FAIL unless declared in
//     `scripts/optional-emissions.json` (intentional optional, e.g. an
//     industry/frontend overlay script only emitted for some configs).
//   A reference is "guarded" iff `existsSync('<path>')` for the same path appears
//   in the referencing file. The manifest can NEVER silence an unguarded ref —
//   it is strictly weaker than a suppression. Manifest entries require a
//   non-empty `rationale` (RT-03).
//
// Workflow hygiene (RT-01): `uses:` refs starting with `./` (local composite
// actions) or `docker://` (container actions) are skipped by the SHA-pin rule —
// neither carries a 40-hex commit pin. Job-name scan covers top-level `jobs:`
// mapping keys only.
//
// Exports for unit tests: checkEmissionCoherence, loadOptionalManifest.
// CLI: node scripts/check-emission-coherence.mjs <generated-dir>
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

function read(dir, rel) {
  try {
    return readFileSync(join(dir, rel), 'utf8')
  } catch {
    return null
  }
}

/**
 * Load the optional-emissions manifest from a generated tree.
 * Returns { paths: Set<string>, problems: string[] } — `problems` carries any
 * manifest-integrity violation (missing rationale, malformed shape) so a manifest
 * can never silently allowlist with an empty rationale (RT-03).
 */
export function loadOptionalManifest(dir) {
  const raw = read(dir, 'scripts/optional-emissions.json')
  if (raw === null) return { paths: new Set(), problems: [] }
  const problems = []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      paths: new Set(),
      problems: [`optional-emissions.json is not valid JSON: ${err.message}`],
    }
  }
  const entries = Array.isArray(parsed?.optional) ? parsed.optional : null
  if (entries === null) {
    return { paths: new Set(), problems: ['optional-emissions.json must have an "optional" array'] }
  }
  const paths = new Set()
  for (const entry of entries) {
    if (typeof entry?.path !== 'string' || entry.path.length === 0) {
      problems.push('optional-emissions.json entry missing a "path" string')
      continue
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length === 0) {
      problems.push(`optional-emissions.json entry "${entry.path}" has an empty/missing rationale`)
      continue
    }
    paths.add(entry.path)
  }
  return { paths, problems }
}

// A `scripts/X.mjs` reference is guarded iff existsSync('scripts/X.mjs') (single
// OR double quoted) appears anywhere in the referencing file.
function isGuarded(content, scriptPath) {
  const esc = scriptPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`existsSync\\(\\s*['"\`]${esc}['"\`]`).test(content)
}

// A githook `node X.mjs` invocation is guarded iff a shell file/exec test for the
// same path — `[ -f "X" ]` / `[ -x "X" ]` (any quoting) — appears in the hook.
// A guarded githook reference is optional-eligible (consult the manifest), exactly
// like an existsSync-guarded check-all reference.
function isShellGuarded(content, scriptPath) {
  const esc = scriptPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\[\\s*-[fx]\\s+["']?${esc}["']?\\s*\\]`).test(content)
}

function checkCheckAll(dir, optional, problems) {
  const checkAll = read(dir, 'scripts/check-all.mjs')
  if (checkAll === null) {
    problems.push('scripts/check-all.mjs not emitted')
    return
  }
  const seen = new Set()
  for (const m of checkAll.matchAll(/['"`](scripts\/[\w./-]+\.mjs)['"`]/g)) {
    const ref = m[1]
    if (seen.has(ref)) continue
    seen.add(ref)
    if (ref === 'scripts/check-all.mjs') continue
    if (existsSync(join(dir, ref))) continue
    if (isGuarded(checkAll, ref)) {
      if (!optional.has(ref)) {
        problems.push(
          `check-all guards missing ${ref} but it is not declared in optional-emissions.json`,
        )
      }
    } else {
      problems.push(`check-all references missing ${ref} (unguarded)`)
    }
  }
}

function checkHooks(dir, problems) {
  const hooks = read(dir, '.claude/hooks/hooks.mjs')
  if (hooks === null) return
  for (const m of hooks.matchAll(/['"`]([\w-]+\.mjs)['"`]/g)) {
    const name = m[1]
    if (name === 'hooks.mjs' || name === 'lib.mjs') continue
    if (!existsSync(join(dir, '.claude/hooks', name))) {
      problems.push(`hooks.mjs registers missing handler .claude/hooks/${name}`)
    }
  }
}

function checkGithooks(dir, optional, problems) {
  for (const h of ['pre-commit', 'pre-push', 'commit-msg']) {
    const c = read(dir, `.githooks/${h}`)
    if (c === null) continue
    for (const m of c.matchAll(/node\s+([\w./-]+\.mjs)/g)) {
      const ref = m[1]
      if (existsSync(join(dir, ref))) continue
      if (isShellGuarded(c, ref)) {
        if (!optional.has(ref)) {
          problems.push(
            `.githooks/${h} guards missing ${ref} but it is not declared in optional-emissions.json`,
          )
        }
        continue
      }
      problems.push(`.githooks/${h} invokes missing ${ref}`)
    }
  }
}

function checkWorkflow(dir, file, problems) {
  const c = read(dir, `.github/workflows/${file}`)
  if (c === null) return
  for (const m of c.matchAll(/uses:\s*([\w./-]+(?::\/\/[\w./:-]+)?)@([\w.-]+)/g)) {
    const ref = m[1]
    // Local composite actions (./...) and container actions (docker://...) carry
    // no 40-hex commit pin — they are legitimately not SHA-pinnable (RT-01).
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue
    if (!/^[0-9a-f]{40}$/.test(m[2])) problems.push(`${file}: non-SHA pin ${ref}@${m[2]}`)
  }
  const jobsBlock = c.split(/(?:^|\n)jobs:[ \t]*\n/)[1]
  if (jobsBlock != null) {
    for (const jm of jobsBlock.matchAll(/^ {2}([\w-]+):\s*\n((?: {2,}.*\n?|\s*\n)*)/gm)) {
      if (!/^ {4}name:/m.test(jm[2])) problems.push(`${file}: job "${jm[1]}" has no name:`)
    }
  }
  for (const m of c.matchAll(/node\s+(scripts\/[\w./-]+\.mjs)/g)) {
    if (!existsSync(join(dir, m[1]))) problems.push(`${file} invokes missing ${m[1]}`)
  }
}

function checkWorkflows(dir, problems) {
  const wfDir = join(dir, '.github/workflows')
  if (!existsSync(wfDir)) return
  for (const f of readdirSync(wfDir)) {
    if (!/\.ya?ml$/.test(f)) continue
    checkWorkflow(dir, f, problems)
  }
}

function checkSettings(dir, problems) {
  const settings = read(dir, '.claude/settings.json')
  if (settings === null) return
  const seen = new Set()
  for (const m of settings.matchAll(/node\s+([\w./-]+\.mjs)/g)) {
    const ref = m[1]
    if (seen.has(ref)) continue
    seen.add(ref)
    if (!existsSync(join(dir, ref))) {
      problems.push(`.claude/settings.json invokes missing ${ref}`)
    }
  }
}

/**
 * Lint a generated tree for cross-reference coherence.
 * @param {string} dir - root of the generated tree.
 * @returns {{ problems: string[] }} - deduplicated, sorted problem messages.
 */
export function checkEmissionCoherence(dir) {
  const { paths: optional, problems: manifestProblems } = loadOptionalManifest(dir)
  const problems = [...manifestProblems]
  checkCheckAll(dir, optional, problems)
  checkHooks(dir, problems)
  checkGithooks(dir, optional, problems)
  checkWorkflows(dir, problems)
  checkSettings(dir, problems)
  return { problems: [...new Set(problems)].sort() }
}

const isMain = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const target = process.argv[2]
  if (target == null) {
    process.stderr.write('usage: node scripts/check-emission-coherence.mjs <generated-dir>\n')
    process.exit(2)
  }
  const { problems } = checkEmissionCoherence(target)
  if (problems.length > 0) {
    process.stdout.write(`emission-coherence: FAIL — ${problems.length} problem(s):\n`)
    for (const p of problems) process.stdout.write(`  - ${p}\n`)
    process.exit(1)
  }
  process.stdout.write('emission-coherence: OK — every reference resolves\n')
  process.exit(0)
}
