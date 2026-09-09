#!/usr/bin/env node
// Arbiter hook: hard-block edits to governance/SSOT documents
// Fires on: PreToolUse → Edit|Write
// Exit 2: block — stderr returned to Claude as error context; user is NOT prompted
//
// Bypass (#2045 — both now logged to .arbiter/evidence/bypass-log.jsonl):
//   1. ARBITER_SSOT_BYPASS=1 (session-scoped — see CONTRIBUTING.md). Logged on every
//      hook invocation while set, parity with pre-edit-plan-anchor's ARBITER_PLAN_BYPASS
//      accounting (#1949) — no longer a silent exit.
//   2. One-shot file at .arbiter/ssot-bypass, PATH-SCOPED since #2493: line 1 is the
//      path the bypass authorizes (repo-relative or absolute), lines 2+ are the reason.
//      It is honoured ONLY for that exact path and consumed only by an attempt on it, so
//      a marker written to authorize X can no longer be spent authorizing an edit to Y.
//      A marker naming no target authorizes nothing (and is consumed, so it cannot
//      linger looking live).
//
// Anchoring (#2493): every repo-relative decision below — `rel`, the arbiter.json
// pattern read, the marker location, the file-bypass evidence log — is anchored at the
// worktree the EDITED FILE lives in (`git -C <the file's dir> rev-parse --show-toplevel`),
// not at the hook process's cwd. Anchoring at the process cwd silently un-guarded every
// sanctioned worktree: `arbiter worktree open` places those at
// `<repoParent>/<repoName>.worktrees/<slug>` (src/worktree/paths.ts), a SIBLING of the
// main root, so `relative(mainRoot, fileInWorktree)` began with '..' and the guard
// exited 0 before matching a single pattern. Repo MEMBERSHIP is NOT re-derived here —
// isPathInThisRepo() owns it (git identity, not a path prefix; see lib.mjs); this anchor
// only decides WHICH worktree's state to read.
//
// Guarded paths: DEFAULT_SSOT_PATTERNS below, extended with arbiter.json
// `governance.ssotGuardPatterns` (array of repo-relative substrings) when present.
// Additive only — config cannot remove a default-guarded path.
import { spawnSync } from 'node:child_process'
import { resolve, relative, join, dirname } from 'node:path'
import { readFileSync, existsSync, rmSync, mkdirSync, appendFileSync } from 'node:fs'
import { resolveToolInputPath, isPathInThisRepo } from './lib.mjs'

const DEFAULT_SSOT_PATTERNS = [
  'AGENTS.md',
  '.claude/CLAUDE.md',
  '.agents/CODEX.md',
  'docs/METHOD/',
  'docs/SYSTEM/DECISIONS',
  'docs/SYSTEM/CANON.md',
  'docs/ADR/',
]

// Best-effort bypass accounting (#1949 handoff, extended #2045) — never blocks, never
// changes user-facing behavior. Inlined (hooks cannot import scripts/lib) from the
// defensive shape of appendJsonl in scripts/lib/loud-bypass.mjs.
function logBypass(repoRoot, record) {
  try {
    const logPath = join(repoRoot, '.arbiter', 'evidence', 'bypass-log.jsonl')
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n',
      'utf-8',
    )
  } catch (err) {
    try {
      process.stderr.write(
        `arbiter-bypass log-append-failed gate=pre-edit-ssot-guard err=${String(err?.message ?? err)}\n`,
      )
      // FAIL-OPEN-INTENT: stderr write itself is best-effort bypass accounting, never the gate — must not block or throw past the bypass exit below (mirrors pre-edit-plan-anchor.mjs.ejs).
    } catch {
      /* swallow */
    }
  }
}

/** Nearest existing ancestor directory of `abs` — a Write may target a not-yet-created tree. */
function nearestExistingDir(abs) {
  let dir = dirname(abs)
  for (;;) {
    if (existsSync(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Worktree root that owns `abs` (#2493), or null when git cannot name one. */
function worktreeRootFor(abs) {
  const dir = nearestExistingDir(abs)
  if (dir === null) return null
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
  if (r.status !== 0) return null
  return r.stdout.trim() || null
}

// The hook PROCESS's own checkout. Used only for the session-scoped env-var bypass
// accounting below, which fires before repo membership is known — anchoring that log at
// the edited file instead would write evidence into whatever foreign repo it belongs to.
// Falls back to CWD when git is unavailable (e.g. an rsync temp dir).
const selfResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
})
const selfRoot = selfResult.stdout.trim() || process.cwd()

// fd 0 is consumable once, so this must be read before any branch that exits.
const file = resolveToolInputPath()

if (process.env.ARBITER_SSOT_BYPASS === '1') {
  logBypass(selfRoot, {
    env: 'ARBITER_SSOT_BYPASS',
    value: '1',
    bypassed: true,
    gate: 'pre-edit-ssot-guard',
  })
  process.exit(0)
}

// #565: another repo's governance documents are not this repo's SSOT. The `rel` anchor
// below is cwd-derived, so with the session cwd inside that repo its own AGENTS.md would
// otherwise match — which is how a sibling repo's edit got blocked from here.
if (!isPathInThisRepo(file)) process.exit(0)

const absFile = resolve(file)
// #2493: anchor at the EDITED FILE's worktree, not this process's cwd. Fail-closed
// (INV-96) when git cannot name one: fall back to this process's root rather than
// skipping the guard.
const repoRoot = worktreeRootFor(absFile) ?? selfRoot
const relRaw = relative(repoRoot, absFile)

// Membership was already settled above by isPathInThisRepo (git identity). A '..' here
// therefore means the ANCHOR is wrong, not that the file is foreign — and the pre-#2493
// code exited 0 on exactly this condition, which is what left every sibling worktree
// unguarded. Match on the absolute path instead so a mis-anchored in-repo file stays
// guarded; foreign paths never reach this line.
const rel = relRaw.startsWith('..') ? absFile : relRaw

// Config-driven guarded-path list (#2045): read arbiter.json at runtime rather than
// baking the pattern list into this file, so adding a guarded path never requires
// touching (or regenerating) the hook. `governance.ssotGuardPatterns` ADDS to
// DEFAULT_SSOT_PATTERNS — it cannot subtract from it, so a config typo or an empty
// list can never silently drop coverage for AGENTS.md et al. Fail-open to just the
// defaults on any read/parse error or an absent/malformed key.
function loadSsotPatterns(root) {
  try {
    const cfg = JSON.parse(readFileSync(join(root, 'arbiter.json'), 'utf-8'))
    const extra = cfg?.governance?.ssotGuardPatterns
    if (Array.isArray(extra) && extra.every((p) => typeof p === 'string')) {
      return [...DEFAULT_SSOT_PATTERNS, ...extra]
    }
    // FAIL-OPEN-INTENT: an absent/malformed ssotGuardPatterns falls through to DEFAULT_SSOT_PATTERNS below, never to "no guard".
  } catch {
    // FAIL-OPEN-INTENT: an unreadable/invalid arbiter.json falls through to DEFAULT_SSOT_PATTERNS below, never to "no guard".
  }
  return DEFAULT_SSOT_PATTERNS
}

const SSOT_PATTERNS = loadSsotPatterns(repoRoot)

const matched = SSOT_PATTERNS.some((pattern) => rel.includes(pattern))
if (!matched) process.exit(0)

// One-shot file bypass (#2045), PATH-SCOPED since #2493: line 1 names the single path
// the marker authorizes, lines 2+ carry the reason. Anchored at the edited file's own
// worktree, so a marker written in one worktree cannot authorize an edit in another.
const BYPASS_FILE = join(repoRoot, '.arbiter', 'ssot-bypass')
if (existsSync(BYPASS_FILE)) {
  let raw = ''
  try {
    raw = readFileSync(BYPASS_FILE, 'utf-8')
    // FAIL-OPEN-INTENT: an unreadable bypass file is treated as an empty marker (falls through to blocked below), never throws past the guard decision.
  } catch {
    raw = ''
  }
  const lines = raw.split('\n')
  const target = (lines[0] ?? '').trim()
  const reason = lines.slice(1).join('\n').trim()
  // An UNSCOPED marker (no target line) authorizes nothing — that shape is exactly the
  // #2493 defect, where a marker meant for X was silently spent on Y. It is still
  // consumed so a malformed file cannot sit around looking like a live authorization.
  const authorizes = target.length > 0 && resolve(repoRoot, target) === absFile
  if (target.length === 0 || authorizes) {
    try {
      rmSync(BYPASS_FILE, { force: true })
      // FAIL-OPEN-INTENT: a deletion failure must not block the bypass/deny decision below — best-effort one-shot consumption.
    } catch {
      /* best-effort deletion; the bypass/deny decision below proceeds regardless */
    }
  }
  // A marker for a DIFFERENT path is left in place: it is one-shot for ITS target, and
  // an unrelated attempt must not be able to destroy a pending authorization either.
  if (authorizes && reason.length > 0) {
    logBypass(repoRoot, {
      file: rel,
      target,
      reason,
      bypassed: true,
      gate: 'pre-edit-ssot-guard',
      mechanism: 'file',
    })
    process.exit(0)
  }
}

process.stderr.write(
  `[arbiter] SSOT GUARD: ${file} is a high-authority governance document.\n` +
    `Editing requires explicit ADR or amendment. Set ARBITER_SSOT_BYPASS=1 for a session-scoped\n` +
    `bypass, or write "<path>\\n<reason>" (path on line 1, reason on line 2) to\n` +
    `${join(relative(process.cwd(), repoRoot) || '.', '.arbiter', 'ssot-bypass')} for a one-shot bypass of THAT path on retry.\n`,
)
process.exit(2)
