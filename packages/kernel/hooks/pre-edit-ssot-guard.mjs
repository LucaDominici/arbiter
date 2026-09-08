#!/usr/bin/env node
// Arbiter hook: hard-block edits to governance/SSOT documents
// Fires on: PreToolUse → Edit|Write
// Exit 2: block — stderr returned to Claude as error context; user is NOT prompted
//
// Bypass (#2045 — both now logged to .arbiter/evidence/bypass-log.jsonl):
//   1. ARBITER_SSOT_BYPASS=1 (session-scoped — see CONTRIBUTING.md). Logged on every
//      hook invocation while set, parity with pre-edit-plan-anchor's ARBITER_PLAN_BYPASS
//      accounting (#1949) — no longer a silent exit.
//   2. One-shot file at .arbiter/ssot-bypass: write a single-line reason and retry the
//      edit. Consumed (deleted) on the NEXT guarded-file attempt regardless of outcome;
//      logged as a BYPASS event only when the reason is non-empty.
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

// Anchor to repo root so external paths with matching names are not blocked.
const gitResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
})
// Fall back to CWD when git is unavailable (e.g. rsync temp dir); still anchors correctly.
const repoRoot = gitResult.stdout.trim() || process.cwd()

if (process.env.ARBITER_SSOT_BYPASS === '1') {
  logBypass(repoRoot, {
    env: 'ARBITER_SSOT_BYPASS',
    value: '1',
    bypassed: true,
    gate: 'pre-edit-ssot-guard',
  })
  process.exit(0)
}

const file = resolveToolInputPath()

// #565: another repo's governance documents are not this repo's SSOT. The `rel` anchor
// below is cwd-derived, so with the session cwd inside that repo its own AGENTS.md would
// otherwise match — which is how a sibling repo's edit got blocked from here.
if (!isPathInThisRepo(file)) process.exit(0)

const absFile = resolve(file)
const rel = relative(repoRoot, absFile)

// If file is outside the repo, allow it.
if (rel.startsWith('..')) process.exit(0)

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

// One-shot file bypass (#2045). Consumed (deleted) on this guarded-file attempt
// regardless of outcome.
const BYPASS_FILE = join(repoRoot, '.arbiter', 'ssot-bypass')
if (existsSync(BYPASS_FILE)) {
  let reason = ''
  try {
    reason = readFileSync(BYPASS_FILE, 'utf-8').trim()
    // FAIL-OPEN-INTENT: an unreadable bypass file is treated as an empty reason (falls through to blocked below), never throws past the guard decision.
  } catch {
    reason = ''
  }
  try {
    rmSync(BYPASS_FILE, { force: true })
    // FAIL-OPEN-INTENT: a deletion failure must not block the bypass/deny decision below — best-effort one-shot consumption.
  } catch {
    /* best-effort deletion; the bypass/deny decision below proceeds regardless */
  }
  if (reason.length > 0) {
    logBypass(repoRoot, {
      file: rel,
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
    `bypass, or write a one-line reason to .arbiter/ssot-bypass for a one-shot bypass on retry.\n`,
)
process.exit(2)
