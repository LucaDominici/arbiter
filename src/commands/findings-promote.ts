// SPDX-License-Identifier: Apache-2.0
//
// `arbiter findings promote` (#1403) — DRAIN the incidental-finding spool into tracked issues.
//
// `arbiter note` (#1401) appends one JSON line per finding to `.arbiter/findings/<shard>.jsonl`.
// This command reads every shard, dedups within the spool by fingerprint, RE-VALIDATES each
// survivor against HEAD (so a finding whose code is gone is dropped, never filed), dedups against
// already-open issues via an embedded `<!-- arbiter-fp:FP -->` body marker, then promotes the
// survivors to GitHub issues labelled `finding`+`tech-debt`+`priority/Pn`. Each promoted issue
// number is recorded under `.arbiter/evidence/findings-promote/tech-debt.json` so `gen-gap.mjs`
// surfaces it in GAP.md with ZERO gen-gap edits.
//
// Spool absent/empty → no-op (exit 0, files nothing).
//
// Re-validate-against-HEAD ladder (RT-A2):
//   1. `file` present AND missing on disk      → DROP   (reliable signal that the code is gone)
//   2. `graphNode` present AND graph fresh      → DROP if the node is gone; KEEP if present
//   3. symbol-only with no graph (low-conf)     → do NOT bare-grep-drop; route to age-sweep
//   4. age-sweep: unpromoted older than N days  → promote; younger → defer
import { existsSync, readFileSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import {
  createGhIssue,
  appendTechDebtIssue,
  type CreateGhIssueInput,
  type CreateGhIssueResult,
} from '../utils/github-issue-helper.js'
import { loadGraphSnapshot } from '../graph/load.js'

/** One drained finding line — the canonical `FindingEntry` shape from `task-note.ts` (SSOT). */
export interface SpoolFinding {
  ts: string
  note: string
  kind: string
  severity: string
  foundDuring: string
  file: string
  line: number | null
  sha: string
  graphNode?: string
  fingerprint: string
}

export interface IssueSearchResult {
  issueNumber: number
  state: 'open' | 'closed'
  /** ISO close time when known — used for the closed-recently cooldown. */
  closedAt?: string
}

/**
 * Injectable side-effect surface. Production wires these to `gh`/`git`/the graph snapshot;
 * tests pass deterministic stubs so the promotion logic is exercised hermetically.
 */
export interface PromoteDeps {
  /** Idempotently create the `finding` label (it does not exist by default). */
  ensureFindingLabel: (dir: string) => void
  /** Find an existing issue carrying the `<!-- arbiter-fp:FP -->` marker; null when none. */
  searchIssueByFingerprint: (dir: string, fingerprint: string) => IssueSearchResult | null
  /** File a GitHub issue (delegates to the shared github-issue-helper). */
  createIssue: (dir: string, input: CreateGhIssueInput) => CreateGhIssueResult
  /** Is the persisted graph snapshot newer than HEAD (i.e. safe to trust for node checks)? */
  graphFresh: (dir: string) => boolean
  /** Does the fresh graph contain this node id? */
  graphHasNode: (dir: string, nodeId: string) => boolean
}

export interface PromoteOptions {
  dir?: string
  /** Findings unpromoted longer than this many days get force-decided by the age-sweep. */
  ageSweepDays?: number
  /** Test seam: the "now" reference for the age-sweep. */
  now?: Date
}

interface Outcome {
  fingerprint: string
  note: string
  severity: string
}

export type FindingsPromoteResult =
  | {
      ok: true
      promoted: Outcome[]
      dropped: Outcome[]
      skipped: Outcome[]
      deferred: Outcome[]
    }
  | { ok: false; reason: string }

const DEFAULT_AGE_SWEEP_DAYS = 14
const COOLDOWN_DAYS = 30

// ---------------------------------------------------------------------------
// Spool reading + within-spool dedup
// ---------------------------------------------------------------------------

function isSpoolFinding(v: unknown): v is SpoolFinding {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o['fingerprint'] === 'string' && typeof o['note'] === 'string'
}

/** Read every `.arbiter/findings/*.jsonl` shard; malformed lines are skipped (never throw). */
function readSpool(dir: string): SpoolFinding[] {
  const findingsDir = join(dir, '.arbiter', 'findings')
  if (!existsSync(findingsDir)) return []
  let shards: string[]
  try {
    shards = readdirSync(findingsDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out: SpoolFinding[] = []
  for (const shard of shards.sort()) {
    let raw: string
    try {
      raw = readFileSync(join(findingsDir, shard), 'utf-8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (isSpoolFinding(parsed)) out.push(parsed)
      } catch {
        // malformed line — skip
      }
    }
  }
  return out
}

/** Keep the FIRST occurrence of each fingerprint (deterministic across shards, sorted). */
function dedupByFingerprint(findings: readonly SpoolFinding[]): SpoolFinding[] {
  const seen = new Set<string>()
  const out: SpoolFinding[] = []
  for (const f of findings) {
    if (seen.has(f.fingerprint)) continue
    seen.add(f.fingerprint)
    out.push(f)
  }
  return out
}

/**
 * Read + within-spool-dedup the findings spool without promoting anything.
 * Backs `arbiter findings list` (the manual escape hatch). Empty when the spool is absent.
 */
export function listSpoolFindings(dir: string): SpoolFinding[] {
  return dedupByFingerprint(readSpool(dir))
}

// ---------------------------------------------------------------------------
// Re-validate-against-HEAD ladder
// ---------------------------------------------------------------------------

type Verdict = 'promote' | 'drop' | 'age-sweep'

/**
 * Decide a single finding's fate against HEAD. Returns `age-sweep` for low-confidence
 * symbol-only findings (no reliable existence signal) so they are NEVER bare-grep-dropped.
 */
function revalidate(dir: string, f: SpoolFinding, deps: PromoteDeps): Verdict {
  // Rung 1: a named file that is gone on disk is a reliable "code removed" signal → drop.
  if (f.file.length > 0) {
    if (!existsSync(join(dir, f.file))) return 'drop'
  }

  // Rung 2: a graph node, checkable only when the graph is fresh.
  if (f.graphNode !== undefined && f.graphNode.length > 0 && deps.graphFresh(dir)) {
    return deps.graphHasNode(dir, f.graphNode) ? 'promote' : 'drop'
  }

  // Rung 3: file present on disk → reliable enough to promote now.
  if (f.file.length > 0) return 'promote'

  // Rung 4: symbol-only with no fresh graph → low confidence, defer to the age-sweep.
  return 'age-sweep'
}

function ageInDays(ts: string, now: Date): number {
  const then = Date.parse(ts)
  if (Number.isNaN(then)) return 0
  return (now.getTime() - then) / (24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

/** Map a finding severity band to one of the EXISTING priority labels. */
function severityToPriority(severity: string): 'priority/P0' | 'priority/P1' | 'priority/P2' {
  const s = severity.toLowerCase()
  if (s === 'high' || s === 'critical' || s === 'p0') return 'priority/P0'
  if (s === 'med' || s === 'medium' || s === 'p1') return 'priority/P1'
  return 'priority/P2'
}

function buildBody(f: SpoolFinding): string {
  return [
    `<!-- arbiter-fp:${f.fingerprint} -->`,
    '',
    '## Finding',
    '',
    f.note,
    '',
    '## Context',
    '',
    `- kind: ${f.kind}`,
    `- severity: ${f.severity}`,
    `- found during: ${f.foundDuring}`,
    f.file.length > 0
      ? `- file: ${f.file}${f.line !== null ? `:${f.line}` : ''}`
      : '- file: (none)',
    f.graphNode !== undefined ? `- graph node: ${f.graphNode}` : '',
    `- captured at sha: ${f.sha}`,
    '',
    '## Source',
    '',
    'Promoted from the `.arbiter/findings` spool by `arbiter findings promote` (#1403).',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

function toOutcome(f: SpoolFinding): Outcome {
  return { fingerprint: f.fingerprint, note: f.note, severity: f.severity }
}

function recentlyClosed(hit: IssueSearchResult, now: Date): boolean {
  if (hit.state !== 'closed') return false
  if (hit.closedAt === undefined) return true // closed but unknown when → stay in cooldown
  return ageInDays(hit.closedAt, now) < COOLDOWN_DAYS
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function runFindingsPromote(opts: PromoteOptions, deps: PromoteDeps): FindingsPromoteResult {
  const dir = opts.dir ?? process.cwd()
  const now = opts.now ?? new Date()
  const ageSweepDays = opts.ageSweepDays ?? DEFAULT_AGE_SWEEP_DAYS

  const unique = dedupByFingerprint(readSpool(dir))
  const promoted: Outcome[] = []
  const dropped: Outcome[] = []
  const skipped: Outcome[] = []
  const deferred: Outcome[] = []

  if (unique.length === 0) {
    return { ok: true, promoted, dropped, skipped, deferred }
  }

  // Bootstrap the `finding` label once before any filing.
  deps.ensureFindingLabel(dir)

  const evidenceDir = join(dir, '.arbiter', 'evidence', 'findings-promote')
  let evidenceReady = false

  for (const f of unique) {
    const verdict = revalidate(dir, f, deps)

    if (verdict === 'drop') {
      dropped.push(toOutcome(f))
      continue
    }

    if (verdict === 'age-sweep') {
      if (ageInDays(f.ts, now) < ageSweepDays) {
        deferred.push(toOutcome(f))
        continue
      }
      // old enough → fall through to promote
    }

    // Dedup against existing issues via the embedded fingerprint marker.
    const hit = deps.searchIssueByFingerprint(dir, f.fingerprint)
    if (hit !== null && (hit.state === 'open' || recentlyClosed(hit, now))) {
      skipped.push(toOutcome(f))
      continue
    }

    const result = deps.createIssue(dir, {
      title: `finding: ${f.note.slice(0, 80)}`,
      body: buildBody(f),
      labels: ['finding', 'tech-debt', severityToPriority(f.severity)],
    })
    if (!result.ok) {
      // Soft-fail this finding (e.g. gh unavailable) but keep going for the rest.
      skipped.push(toOutcome(f))
      continue
    }

    if (!evidenceReady) {
      mkdirSync(evidenceDir, { recursive: true })
      evidenceReady = true
    }
    appendTechDebtIssue(evidenceDir, result.issueNumber)
    promoted.push(toOutcome(f))
  }

  return { ok: true, promoted, dropped, skipped, deferred }
}

// ---------------------------------------------------------------------------
// Default (production) deps — real gh / git / graph wiring
// ---------------------------------------------------------------------------

/** Idempotently ensure the `finding` label exists (`--force` upserts color/description). */
function ensureFindingLabel(dir: string): void {
  try {
    runCli(
      'gh',
      [
        'label',
        'create',
        'finding',
        '--force',
        '--color',
        '5319e7',
        '--description',
        'Promoted incidental finding (arbiter findings promote)',
      ],
      { cwd: dir, timeoutMs: 30_000 },
    )
  } catch (err: unknown) {
    // Label bootstrap is best-effort: a missing/erroring gh must not abort the drain.
    if (err instanceof CliError) return
    throw err
  }
}

interface GhIssueListItem {
  number: number
  state: string
  closedAt?: string | null
}

/** Search open+closed issues for the embedded fingerprint marker via gh full-text search. */
function searchIssueByFingerprint(dir: string, fingerprint: string): IssueSearchResult | null {
  let raw: string
  try {
    const result = runCli(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'all',
        '--search',
        `arbiter-fp:${fingerprint} in:body`,
        '--json',
        'number,state,closedAt',
        '--limit',
        '5',
      ],
      { cwd: dir, timeoutMs: 30_000 },
    )
    raw = result.stdout
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const first = parsed[0] as GhIssueListItem
  if (typeof first.number !== 'number') return null
  const state = first.state.toLowerCase() === 'open' ? 'open' : 'closed'
  const out: IssueSearchResult = { issueNumber: first.number, state }
  if (typeof first.closedAt === 'string' && first.closedAt.length > 0) out.closedAt = first.closedAt
  return out
}

/** Graph is fresh when graph.json's mtime is at-or-after HEAD's commit time. */
function graphFresh(dir: string): boolean {
  const graphPath = join(dir, '.arbiter', 'graph.json')
  if (!existsSync(graphPath)) return false
  let graphMtime: number
  try {
    graphMtime = statSync(graphPath).mtimeMs
  } catch {
    return false
  }
  try {
    const result = runCli('git', ['log', '-1', '--format=%cI', 'HEAD'], {
      cwd: dir,
      timeoutMs: 5000,
    })
    const headTime = Date.parse(result.stdout.trim())
    if (Number.isNaN(headTime)) return false
    return graphMtime >= headTime
  } catch {
    return false
  }
}

function graphHasNode(dir: string, nodeId: string): boolean {
  const graphPath = join(dir, '.arbiter', 'graph.json')
  const outcome = loadGraphSnapshot(graphPath)
  if (!outcome.ok) return false
  return outcome.snapshot.nodes.some((n) => n.id === nodeId)
}

/** Production deps: the real gh / git / graph side effects. */
export const defaultPromoteDeps: PromoteDeps = {
  ensureFindingLabel,
  searchIssueByFingerprint,
  createIssue: (dir, input) => createGhIssue(dir, input),
  graphFresh,
  graphHasNode,
}
