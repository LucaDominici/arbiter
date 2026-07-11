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
// reference in the emission must resolve to a file that actually exists. Scans
// check-all.mjs, .claude/hooks/hooks.mjs, .githooks/*, .github/workflows/*,
// .claude/settings.json, .codex/config.toml (#1885 — the codex-adapter hook-path
// ghost), the Makefile, and every .claude/commands/*.md playbook
// (#1345 — the Makefile/command blind spot that hid the done-evidence &
// route-auditors ghosts). Catches "referenced but never emitted" ghosts (the
// class behind #1318/#1319/#1345) in milliseconds, no toolchains — affordable
// across the FULL (language × level × mode) matrix on every PR (the matrix runner
// is the integration test).
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

// Scan a free-form text source (Makefile recipe, command playbook) for references
// of the form `scripts/<name>.(mjs|sh|cjs|js)` and `.claude/hooks/<name>.mjs`. These
// references are UNGUARDED by construction — a Makefile recipe line or a command-doc
// instruction carries no existsSync()/[ -f ] guard — so per INV-123 an unguarded
// missing reference can NEVER be silenced by the manifest and ALWAYS fails.
function checkPlainTextRefs(dir, rel, content, label, problems) {
  const seen = new Set()
  const refRe = /(?:\.claude\/hooks\/[\w./-]+\.mjs|scripts\/[\w./-]+\.(?:mjs|sh|cjs|js))/g
  for (const m of content.matchAll(refRe)) {
    const ref = m[0]
    if (seen.has(ref)) continue
    seen.add(ref)
    if (existsSync(join(dir, ref))) continue
    problems.push(`${label} references missing ${ref} (unguarded)`)
  }
}

function checkMakefile(dir, problems) {
  const c = read(dir, 'Makefile')
  if (c === null) return
  checkPlainTextRefs(dir, 'Makefile', c, 'Makefile', problems)
}

function checkCommands(dir, problems) {
  const cmdDir = join(dir, '.claude/commands')
  if (!existsSync(cmdDir)) return
  for (const f of readdirSync(cmdDir)) {
    if (!f.endsWith('.md')) continue
    const c = read(dir, `.claude/commands/${f}`)
    if (c === null) continue
    checkPlainTextRefs(dir, `.claude/commands/${f}`, c, `.claude/commands/${f}`, problems)
  }
}

// #1885: .codex/config.toml wires `.claude/hooks/*.mjs` scripts through
// `command = "node .codex/codex-adapter.mjs <hook-path>"` entries. A TOML
// command string carries no existsSync/[ -f ] guard, so a dangling ref is
// unguarded by construction (same class as the Makefile/command-doc scan) —
// this is the ghost that crashed every bash/apply_patch call on a codex-only
// project before the hook-parity fix.
function checkCodexConfig(dir, problems) {
  const c = read(dir, '.codex/config.toml')
  if (c === null) return
  const seen = new Set()
  for (const m of c.matchAll(/\.claude\/hooks\/([\w.-]+\.mjs)/g)) {
    const hookFile = m[1]
    if (seen.has(hookFile)) continue
    seen.add(hookFile)
    if (!existsSync(join(dir, '.claude/hooks', hookFile))) {
      problems.push(`.codex/config.toml references missing .claude/hooks/${hookFile}`)
    }
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

// Recursively collect every `.mjs` path (relative to `dir`) under `sub`.
function collectMjs(dir, sub, acc) {
  const root = join(dir, sub)
  if (!existsSync(root)) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = `${sub}/${entry.name}`
    if (entry.isDirectory()) collectMjs(dir, rel, acc)
    else if (entry.name.endsWith('.mjs')) acc.push(rel)
  }
}

// #1518 — REVERSE coherence. The forward checks above resolve every reference to an
// emitted file (reference → file); they CANNOT catch a script that is EMITTED but
// never INVOKED. That is the other half of the registry↔check-all activation seam: a
// registry `enabled:` predicate broader than the template's `<% if %>` guard emits a
// gate script at a level/cell where nothing references it. The dead file ships into
// every target project's tree and the divergence is invisible to the forward gate.
//
// This asserts the reverse: every emitted `scripts/check-*.mjs` is referenced by the
// execution/reference surface (check-all.mjs, githooks, workflows, settings, hooks,
// Makefile, commands) OR transitively by another emitted `.mjs` (e.g. a guard-registry
// helper). An intentionally-unreferenced overlay script is allowlisted via
// optional-emissions.json — symmetric with the forward guarded-missing path.
//
// Blind spot (accepted, documented): two mutually-referencing dead scripts pass. The
// truly-orphan case — referenced by NOTHING — is the one that ships a dead file, and
// that is exactly what this catches, cheaply and toolchain-free across the matrix.
function checkUnreferencedScripts(dir, optional, problems) {
  const scriptsDir = join(dir, 'scripts')
  if (!existsSync(scriptsDir)) return
  const gateScripts = readdirSync(scriptsDir).filter(
    (f) => /^check-.*\.mjs$/.test(f) && f !== 'check-all.mjs',
  )
  if (gateScripts.length === 0) return

  // Build a content map of every reference-bearing surface, read once.
  const mjs = []
  collectMjs(dir, 'scripts', mjs)
  collectMjs(dir, '.claude/hooks', mjs)
  /** @type {Map<string, string>} */
  const corpus = new Map()
  for (const rel of mjs) {
    const c = read(dir, rel)
    if (c !== null) corpus.set(rel, c)
  }
  const addSurface = (rel) => {
    const c = read(dir, rel)
    if (c !== null) corpus.set(rel, c)
  }
  addSurface('scripts/check-all.mjs')
  addSurface('.claude/settings.json')
  addSurface('Makefile')
  for (const h of ['pre-commit', 'pre-push', 'commit-msg']) addSurface(`.githooks/${h}`)
  const wfDir = join(dir, '.github/workflows')
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir)) if (/\.ya?ml$/.test(f)) addSurface(`.github/workflows/${f}`)
  }
  const cmdDir = join(dir, '.claude/commands')
  if (existsSync(cmdDir)) {
    for (const f of readdirSync(cmdDir)) if (f.endsWith('.md')) addSurface(`.claude/commands/${f}`)
  }

  for (const g of gateScripts) {
    const self = `scripts/${g}`
    if (optional.has(self)) continue
    let referenced = false
    for (const [rel, content] of corpus) {
      if (rel === self) continue
      if (content.includes(g)) {
        referenced = true
        break
      }
    }
    if (!referenced) {
      problems.push(`scripts/${g} is emitted but never referenced (dead emission)`)
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
  checkUnreferencedScripts(dir, optional, problems)
  checkHooks(dir, problems)
  checkGithooks(dir, optional, problems)
  checkWorkflows(dir, problems)
  checkSettings(dir, problems)
  checkCodexConfig(dir, problems)
  checkMakefile(dir, problems)
  checkCommands(dir, problems)
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
