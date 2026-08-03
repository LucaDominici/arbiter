#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — unwired guard-script detector (INV-89)
//
// CATALOG: reverse wiring-coherence for guard scripts, widening the class
// CATALOG: check-emission-coherence.mjs's checkUnreferencedScripts (INV-123)
// CATALOG: already catches. Rejected fold-in into that script: (1) its
// CATALOG: candidate glob is check-*.mjs only — blind to check-*.sh,
// CATALOG: verify-*.sh, and scripts/qa/check-* (the motivating incident: a
// CATALOG: 375-line hand-authored verify-requirements-matrix.sh never seen by
// CATALOG: a .mjs-only scan); (2) it never recognizes run.sh as a gate
// CATALOG: entrypoint; (3) a malformed manifest here is its own exit-2 schema
// CATALOG: class, not folded into the exit-1 problem list. Reference corpus is
// CATALOG: the same surfaces (check-all.mjs, scripts/**, .claude/hooks/**,
// CATALOG: settings.json, Makefile, githooks, workflows, commands) plus run.sh
// CATALOG: and package.json — a superset, not a narrower scan. Allowlisting
// CATALOG: (below) deliberately REUSES scripts/optional-emissions.json rather
// CATALOG: than inventing a second exceptions file: it is the canonical,
// CATALOG: already-emitted-to-every-target INV-123 manifest for precisely this
// CATALOG: "emitted unconditionally, wired only sometimes" concept (its own
// CATALOG: $comment documents the REVERSE #1518 direction this check exists
// CATALOG: to enforce) — one shared list for both checks, not two that can
// CATALOG: drift apart.
//
// Detects a "guard script" (scripts/check-*.mjs, scripts/check-*.sh,
// scripts/verify-*.sh, scripts/qa/check-*, .claude/hooks/*.mjs) that exists
// on disk but is never referenced from any recognized gate entrypoint.
// Emitted-but-unwired gives a false sense of coverage: the script never runs,
// yet its existence reads as "this class of drift is checked".
//
// Allowlist: scripts/optional-emissions.json (shared with check-emission-
// coherence.mjs, INV-123) —
//   { "optional": [{ "path": "scripts/qa/check-foo.sh", "rationale": "..." }] }
// Absent file = empty allowlist (no error, day-1 safe). A malformed file (bad
// JSON / missing "optional" array / entry missing path or rationale) is a
// SCHEMA error (exit 2) — never silently downgraded to a normal FAIL, and
// never a silent allowlist-without-reason.
//
// Exit codes (INV-53): 0 = every candidate referenced, allowlisted, or no
// scripts/ directory or .claude/hooks/ directory at all (vacuous SKIP). 1 =
// >=1 unreferenced guard script (not allowlisted). 2 = allowlist schema error.
//
// Usage: node scripts/check-unwired-guards.mjs [--help]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SELF_NAME = 'check-unwired-guards.mjs'
const ALLOWLIST_REL = 'scripts/optional-emissions.json'

const HELP = `Usage: node scripts/check-unwired-guards.mjs [options]

Detects a guard script (scripts/check-*.mjs, scripts/check-*.sh,
scripts/verify-*.sh, scripts/qa/check-*, .claude/hooks/*.mjs) that is emitted
but never referenced by any recognized gate entrypoint (scripts/check-all.mjs,
run.sh, another scripts/** file, .claude/hooks/**, .claude/settings.json,
Makefile, .githooks/*, package.json, .claude/commands/*.md, or a
.github/workflows/*.yml). Exits 1 naming the file(s) when found unreferenced.

An entry in scripts/optional-emissions.json (shared with the INV-123
emission-coherence gate) with a non-empty rationale silences one candidate
(printed as ALLOWLISTED, still visible for auditability). A malformed
manifest is a schema error (exit 2).

Options:
  --help, -h      Show this help and exit

Exit codes:
  0   every candidate referenced, allowlisted, or no scripts/ or .claude/hooks/ dir (vacuous SKIP)
  1   >=1 unreferenced guard script
  2   allowlist schema error
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}

// Recursively collect every file path (relative to `dir`) under `dir/sub`.
function collectFiles(dir, sub, acc) {
  const abs = join(dir, sub)
  if (!existsSync(abs)) return
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${sub}/${entry.name}`
    if (entry.isDirectory()) collectFiles(dir, rel, acc)
    else acc.push(rel)
  }
}

// Read `dir/rel` into `corpus` keyed by `rel`, silently skipping an absent file.
function addToCorpus(dir, rel, corpus) {
  const abs = join(dir, rel)
  if (existsSync(abs)) corpus.set(rel, readFileSync(abs, 'utf8'))
}

// Recursively collect every file under `dir/sub` whose relative path matches
// `extRe`, adding each to `corpus`.
function collectByExtension(dir, sub, extRe, corpus) {
  const files = []
  collectFiles(dir, sub, files)
  for (const rel of files) {
    if (extRe.test(rel)) addToCorpus(dir, rel, corpus)
  }
}

// Non-recursive: every direct child of `dir/sub` passing `nameTest`, added to
// `corpus`. No-op when `dir/sub` does not exist.
function collectShallowDir(dir, sub, nameTest, corpus) {
  const abs = join(dir, sub)
  if (!existsSync(abs)) return
  for (const name of readdirSync(abs)) {
    if (nameTest(name)) addToCorpus(dir, `${sub}/${name}`, corpus)
  }
}

// Build the reference corpus: every surface a guard script could plausibly be
// invoked/mentioned from. Superset of check-emission-coherence.mjs's own
// corpus (scripts/**, .claude/hooks/**, settings.json, Makefile, githooks,
// workflows, commands) plus run.sh and package.json.
function buildCorpus(dir) {
  const corpus = new Map()
  collectByExtension(dir, 'scripts', /\.(mjs|sh|cjs)$/, corpus)
  collectByExtension(dir, '.claude/hooks', /\.mjs$/, corpus)
  addToCorpus(dir, 'run.sh', corpus)
  addToCorpus(dir, 'package.json', corpus)
  addToCorpus(dir, 'Makefile', corpus)
  addToCorpus(dir, '.claude/settings.json', corpus)
  for (const h of ['pre-commit', 'pre-push', 'commit-msg']) {
    addToCorpus(dir, `.githooks/${h}`, corpus)
  }
  collectShallowDir(dir, '.github/workflows', (f) => /\.ya?ml$/.test(f), corpus)
  collectShallowDir(dir, '.claude/commands', (f) => f.endsWith('.md'), corpus)
  return corpus
}

const TOP_LEVEL_CANDIDATE_RE = /^(check-.*\.mjs|check-.*\.sh|verify-.*\.sh)$/

// A top-level scripts/ entry is a candidate unless it's the check-all.mjs
// entrypoint or this script's own filename.
function isTopLevelCandidate(name) {
  return name !== 'check-all.mjs' && name !== SELF_NAME && TOP_LEVEL_CANDIDATE_RE.test(name)
}

// scripts/qa/check-* candidates (any extension). No-op when scripts/qa/ absent.
function collectQaCandidates(scriptsDir, candidates) {
  const qaDir = join(scriptsDir, 'qa')
  if (!existsSync(qaDir)) return
  for (const entry of readdirSync(qaDir, { withFileTypes: true })) {
    if (entry.isFile() && /^check-/.test(entry.name)) {
      candidates.add(`scripts/qa/${entry.name}`)
    }
  }
}

// Candidate guard scripts: scripts/check-*.{mjs,sh}, scripts/verify-*.sh,
// (any extension) scripts/qa/check-*, and direct-child .claude/hooks/*.mjs
// except dispatcher hooks.mjs and shared helper lib.mjs.
function collectCandidates(dir) {
  const scriptsDir = join(dir, 'scripts')
  const hooksDir = join(dir, '.claude/hooks')
  if (!existsSync(scriptsDir) && !existsSync(hooksDir)) return null
  const candidates = new Set()
  if (existsSync(scriptsDir)) {
    for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
      if (entry.isFile() && isTopLevelCandidate(entry.name)) {
        candidates.add(`scripts/${entry.name}`)
      }
    }
    collectQaCandidates(scriptsDir, candidates)
  }
  if (existsSync(hooksDir)) {
    for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith('.mjs') &&
        entry.name !== 'hooks.mjs' &&
        entry.name !== 'lib.mjs'
      ) {
        candidates.add(`.claude/hooks/${entry.name}`)
      }
    }
  }
  return [...candidates].sort()
}

// A candidate is referenced iff its full repo-relative path appears as a
// substring in any OTHER corpus file (relative-path matching per Q2 — avoids
// same-basename-different-dir collisions; string-contains, not shell parsing,
// per Q3 — this is a lint, not a shell interpreter).
function isReferenced(candidateRel, corpus) {
  for (const [rel, content] of corpus) {
    if (rel === candidateRel) continue
    if (content.includes(candidateRel)) return true
  }
  return false
}

// Return .mjs handler basenames registered in the optional hooks.mjs
// dispatcher table. Its only .mjs string literals are handler filenames.
function handlersTableWiredNames(corpus) {
  const source = corpus.get('.claude/hooks/hooks.mjs')
  const names = new Set()
  if (!source) return names
  for (const match of source.matchAll(/['"]([^'"]+\.mjs)['"]/g)) {
    names.add(match[1])
  }
  return names
}

// Compute the transitive wired set for direct-child hook candidates. A hook is
// initially wired by a full-path reference or by the hooks.mjs HANDLERS table;
// relative hook-import relationships then propagate that wiring to closure.
function computeWiredHookBasenames(corpus, hookCandidates) {
  const names = new Set(hookCandidates.map((rel) => rel.slice('.claude/hooks/'.length)))
  const wired = new Set()
  const handlers = handlersTableWiredNames(corpus)
  const imports = new Map()

  for (const name of names) {
    const rel = `.claude/hooks/${name}`
    if (isReferenced(rel, corpus) || handlers.has(name)) wired.add(name)

    const imported = new Set()
    const source = corpus.get(rel) ?? ''
    for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
      const importedName = match[1].endsWith('.mjs') ? match[1] : `${match[1]}.mjs`
      if (names.has(importedName)) imported.add(importedName)
    }
    imports.set(name, imported)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [importer, importedNames] of imports) {
      for (const imported of importedNames) {
        if (wired.has(importer) && !wired.has(imported)) {
          wired.add(imported)
          changed = true
        }
      }
    }
  }
  return wired
}

function schemaError(msg) {
  process.stderr.write(`check-unwired-guards: SCHEMA ERROR — ${msg}\n`)
  process.exit(2)
}

// Parse the allowlist JSON and return its "optional" array. Any malformed
// shape calls schemaError(), which exits 2 and never returns.
function parseAllowlistJson(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // Inlined (not via schemaError()) so the FAIL-CLOSED audit's per-catch-body
    // scan sees the surface+exit tokens directly in this block (INV-96).
    process.stderr.write(
      `check-unwired-guards: SCHEMA ERROR — ${ALLOWLIST_REL} is not valid JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(2)
  }
  if (!Array.isArray(parsed?.optional)) {
    schemaError(`${ALLOWLIST_REL} must have an "optional" array`)
  }
  return parsed.optional
}

// A valid entry has a non-empty "path" and a non-empty "rationale"; otherwise
// schemaError() exits 2 and never returns.
function validateAllowlistEntry(entry) {
  if (typeof entry?.path !== 'string' || entry.path.length === 0) {
    schemaError(`${ALLOWLIST_REL} entry missing a "path" string`)
  }
  if (typeof entry.rationale !== 'string' || entry.rationale.trim().length === 0) {
    schemaError(`${ALLOWLIST_REL} entry "${entry.path}" has an empty/missing rationale`)
  }
}

// Load the allowlist. Absent file => empty map (no error).
function loadAllowlist(dir) {
  const path = join(dir, ALLOWLIST_REL)
  if (!existsSync(path)) return new Map()
  const entries = parseAllowlistJson(readFileSync(path, 'utf8'))
  const result = new Map()
  for (const entry of entries) {
    validateAllowlistEntry(entry)
    result.set(entry.path, entry.rationale)
  }
  return result
}

function main() {
  const dir = process.cwd()
  const allowlist = loadAllowlist(dir)
  const candidates = collectCandidates(dir)
  if (candidates === null) {
    process.stdout.write('check-unwired-guards: SKIP — no scripts/ or .claude/hooks/ directory\n')
    process.exit(0)
  }
  const corpus = buildCorpus(dir)
  const hookCandidates = candidates.filter((rel) => rel.startsWith('.claude/hooks/'))
  const wiredHookBasenames = computeWiredHookBasenames(corpus, hookCandidates)
  const problems = []
  for (const rel of candidates) {
    const isHook = rel.startsWith('.claude/hooks/')
    if (isHook ? wiredHookBasenames.has(rel.slice('.claude/hooks/'.length)) : isReferenced(rel, corpus)) {
      continue
    }
    const rationale = allowlist.get(rel)
    if (rationale) {
      process.stdout.write(`[ALLOWLISTED] ${rel} — ${rationale}\n`)
      continue
    }
    problems.push(rel)
  }
  if (problems.length > 0) {
    process.stdout.write(
      `check-unwired-guards: FAIL — ${problems.length} unreferenced guard script(s) ` +
        '(searched scripts/check-all.mjs, run.sh, scripts/**, .claude/hooks/**, ' +
        '.claude/settings.json, Makefile, .githooks/*, package.json, ' +
        '.claude/commands/*.md, .github/workflows/*.yml):\n',
    )
    for (const p of problems) process.stdout.write(`  - ${p}\n`)
    process.exit(1)
  }
  process.stdout.write(
    'check-unwired-guards: OK — every guard script is referenced or allowlisted\n',
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  process.stderr.write(
    `check-unwired-guards: ERROR — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
