#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: #2387 — guards the orchestration surface (commands/skills + their template twins)
// CATALOG: against the two instruction-drift classes newer models silently obey: a referenced
// CATALOG: skill/command/agent that does not exist, and a mandatory ceremony step re-marked
// CATALOG: optional. Both shipped live before this gate (skill-forced-eval pointed at three
// CATALOG: non-existent names; wave-drain's adversarial plan gate was headed "Optional").
// CATALOG: rejected fold-in into check-hook-doc-parity.mjs (reconciles settings.json against the
// CATALOG: CLAUDE.md table — a JSON<->table pair, not prose reference resolution).
// CATALOG: rejected fold-in into check-constraint-scan.mjs (maps prohibitions to enforcers —
// CATALOG: the inverse traversal: prohibition->enforcer, not reference->existence).
//
// Checks:
//   A. reference integrity — every skill / command / agent named in orchestration prose
//      resolves to a real .claude/skills/<n>/SKILL.md, .claude/commands/<n>.md or
//      .claude/agents/<n>.md. Zero-heuristic.
//   B. optional-marked ceremony — an optionality marker is refused on a line that ALSO names a
//      mandatory ceremony step. Both halves must co-occur on one line, from fixed vocabularies,
//      so ordinary optional arguments ("the slug is optional") never trip it.
//
// Usage:
//   node scripts/check-orchestration-integrity.mjs
//   node scripts/check-orchestration-integrity.mjs --root=<dir>   (test fixtures)
//   node scripts/check-orchestration-integrity.mjs --help
//
// Exit codes (INV-53): 0=PASS, 1=FAIL (drift found), 2=ERROR (bad usage).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

const HELP = `Usage: node scripts/check-orchestration-integrity.mjs [options]

Guards the orchestration surface against instruction drift (#2387).

Options:
  --root=<dir>   Scan this repo root instead of the current directory (tests).
  --help, -h     Show this help and exit.

Exit codes: 0=PASS, 1=FAIL (drift found), 2=ERROR (bad usage).
`

/** Directories whose markdown is orchestration prose, relative to a repo root. */
const SURFACE_DIRS = [
  join('.claude', 'commands'),
  join('.claude', 'skills'),
  join('.claude', 'hooks'),
  join('src', 'templates', 'claude', 'commands'),
  join('src', 'templates', 'claude', 'skills'),
  join('src', 'templates', 'claude', 'hooks'),
]

/** Where a bare name may resolve, relative to a repo root. `%s` is the name. */
const REGISTRY_SHAPES = [
  join('.claude', 'skills', '%s', 'SKILL.md'),
  join('.claude', 'commands', '%s.md'),
  join('.claude', 'agents', '%s.md'),
  join('src', 'templates', 'claude', 'skills', '%s', 'SKILL.md.ejs'),
  join('src', 'templates', 'claude', 'commands', '%s.md.ejs'),
  join('src', 'templates', 'claude', 'agents', '%s.md.ejs'),
]

// Slash-command form: `/name` as a standalone invocation. Deliberately narrow, because the
// surface is dense with things that merely contain a slash:
//   - preceded only by start-of-line, whitespace or an opening paren/quote — never by a backtick,
//     so `` `any`/placeholder `` and `` `package.json`/lockfiles `` are prose, not references;
//   - followed only by whitespace, sentence punctuation or end-of-line, so `/tmp/issue.md`,
//     `/dev/null`, `require('...')` and the regex literals `/def|class/` and `/from\s+/` are
//     paths and patterns, not references.
const SLASH_REF = /(^|[\s("'])\/([a-z][a-z0-9-]{2,})(?=[\s,;:!?)\]}'"]|\.(?!\w)|$)/g
// Backticked name adjacent to the word "skill", either order: `tdd` skill / skill `wave-drain`.
const SKILL_REF_AFTER = /`([a-z][a-z0-9-]{2,})`\s+skill\b/g
const SKILL_REF_BEFORE = /\bskills?\s+`([a-z][a-z0-9-]{2,})`/g

/** Names that look like references but are harness builtins, not repo files. */
const BUILTIN_NAMES = new Set([
  'clear',
  'help',
  'compact',
  'model',
  'config',
  'agents',
  'plan',
  'impact',
])

const OPTIONALITY_MARKERS = [
  'optional',
  'optionally',
  'may skip',
  'can skip',
  'if desired',
  'if you want',
  'when convenient',
  'nice to have',
]

const CEREMONY_TERMS = [
  'plan gate',
  'plan review',
  'red-team',
  'red team',
  'adversarial verif',
  'adversarial review',
  'refutation',
  'code review',
  'tdd',
  'full gate',
  'acceptance criteria',
]

/**
 * Extract referenced skill/command/agent names from one line of prose.
 * Deduplicated, in first-seen order. Builtins are never returned.
 */
export function parseReferences(text) {
  const seen = new Set()
  const out = []
  const add = (name) => {
    if (BUILTIN_NAMES.has(name) || seen.has(name)) return
    seen.add(name)
    out.push(name)
  }
  for (const re of [SLASH_REF, SKILL_REF_AFTER, SKILL_REF_BEFORE]) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) add(m[2] ?? m[1])
  }
  return out
}

/** True when `name` resolves to a real skill, command or agent under `root`. */
function referenceResolves(root, name) {
  return REGISTRY_SHAPES.some((shape) => existsSync(join(root, shape.replace('%s', name))))
}

/** Every scannable file under the surface dirs of `root`, absolute paths, sorted. */
function surfaceFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
      // FAIL-OPEN-INTENT: an unreadable surface dir is an absent surface, not a drift verdict.
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(md|md\.ejs|mjs|mjs\.ejs)$/.test(e.name)) out.push(p)
    }
  }
  for (const rel of SURFACE_DIRS) {
    const abs = join(root, rel)
    try {
      if (statSync(abs).isDirectory()) walk(abs)
      // FAIL-OPEN-INTENT: a surface dir this repo does not have contributes nothing to scan.
    } catch {
      continue
    }
  }
  return out.sort()
}

function readLines(file) {
  try {
    return readFileSync(file, 'utf-8').split('\n')
    // FAIL-OPEN-INTENT: a file removed mid-scan is skipped, never a spurious failure.
  } catch {
    return []
  }
}

/**
 * Check A — references with nothing behind them.
 * Returns [{file, line, reference}], file relative to `root`.
 */
export function findDanglingReferences(root = process.cwd()) {
  const found = []
  for (const file of surfaceFiles(root)) {
    const lines = readLines(file)
    for (let i = 0; i < lines.length; i++) {
      for (const ref of parseReferences(lines[i])) {
        if (referenceResolves(root, ref)) continue
        found.push({ file: relative(root, file), line: i + 1, reference: ref })
      }
    }
  }
  return found
}

/**
 * Check B — an optionality marker sharing a line with a mandatory ceremony term.
 * Returns [{file, line, marker, ceremony}], file relative to `root`.
 */
export function findOptionalCeremony(root = process.cwd()) {
  const found = []
  for (const file of surfaceFiles(root)) {
    const lines = readLines(file)
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase()
      const marker = OPTIONALITY_MARKERS.find((m) => lower.includes(m))
      if (marker === undefined) continue
      const ceremony = CEREMONY_TERMS.find((c) => lower.includes(c))
      if (ceremony === undefined) continue
      found.push({ file: relative(root, file), line: i + 1, marker, ceremony })
    }
  }
  return found
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP)
    return 0
  }
  const rootFlag = argv.find((a) => a.startsWith('--root='))
  const unknown = argv.find((a) => a.startsWith('--') && a !== '--help' && !a.startsWith('--root='))
  if (unknown !== undefined) {
    process.stderr.write(`check-orchestration-integrity: unknown argument ${unknown}\n${HELP}`)
    return 2
  }
  const root = rootFlag ? resolve(rootFlag.slice('--root='.length)) : process.cwd()

  const dangling = findDanglingReferences(root)
  const optional = findOptionalCeremony(root)

  for (const d of dangling) {
    process.stderr.write(
      `check-orchestration-integrity: ${d.file}:${d.line} references "${d.reference}", ` +
        `which is not a skill, command or agent in this repo — fix the name or add the file\n`,
    )
  }
  for (const o of optional) {
    process.stderr.write(
      `check-orchestration-integrity: ${o.file}:${o.line} marks "${o.ceremony}" as ` +
        `"${o.marker}" — a ceremony step newer models read literally; state it unconditionally ` +
        `or move the condition into an explicit, recorded criterion\n`,
    )
  }

  const total = dangling.length + optional.length
  if (total > 0) {
    process.stderr.write(
      `\ncheck-orchestration-integrity: FAIL — ${dangling.length} dangling reference(s), ` +
        `${optional.length} optional-marked ceremony line(s)\n`,
    )
    return 1
  }
  process.stdout.write(
    `check-orchestration-integrity: OK — ${surfaceFiles(root).length} orchestration file(s) clean\n`,
  )
  return 0
}

if (isMainModule(import.meta.url)) {
  // Fail closed: an unexpected crash exits 2 (ERROR), never falls through to the shell's
  // default success code — a gate that dies silently reads as a passing gate.
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    process.stderr.write(
      `check-orchestration-integrity: ERROR — ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
