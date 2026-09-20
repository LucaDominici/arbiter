// SPDX-License-Identifier: Apache-2.0
//
// `arbiter finding promote` — drain the incidental-finding spool into tracked issues.
//
// `arbiter finding add` (#1401) appends one JSON line per finding to `.arbiter/findings/<shard>.jsonl`.
// This command reads every shard, dedups within the spool by fingerprint, RE-VALIDATES each
// survivor against HEAD (so a finding whose code is gone is dropped, never filed), dedups against
// already-open issues via an embedded `<!-- arbiter-fp:FP -->` body marker, then promotes the
// survivors to GitHub issues labelled `finding`+`tech-debt`+`priority/Pn`. Each promoted issue
// number is recorded under `.arbiter/evidence/findings-promote/tech-debt.json` so `gen-gap.mjs`
// surfaces it in GAP.md with ZERO gen-gap edits.
//
// Then it DRAINS (#2733): every fingerprint now durable elsewhere — filed as a new issue, dropped
// as stale, or already tracked by an OPEN issue — is removed from the spool and receipted in
// `.arbiter/evidence/findings-promote/drained.jsonl`. The spool means "still open" to two readers
// (`collectFindingsMetrics` in `scripts/debt-lib.mjs` and the `stop-finding-loss` Stop hook), so
// leaving promoted entries behind kept the debt ratchet red for capture the rules require.
// A finding inside the closed-issue cooldown, a deferred one, and an unparseable line all stay.
//
// Spool absent/empty → no-op (exit 0, files nothing).
//
// Re-validate-against-HEAD ladder (RT-A2):
//   1. `file` present AND missing on disk      → DROP   (reliable signal that the code is gone)
//   2. `graphNode` present AND graph fresh      → DROP if the node is gone; KEEP if present
//   3. symbol-only with no graph (low-conf)     → do NOT bare-grep-drop; route to age-sweep
//   4. age-sweep: unpromoted older than N days  → promote; younger → defer
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runCli, CliError } from '../utils/run-cli.js'
import { createGhIssue, appendTechDebtIssue } from '../utils/github-issue-helper.js'
import { loadGraphSnapshot } from '../graph/load.js'
import {
  ensureDir,
  readFileTranslated,
  writeFile,
  assertWritten,
  appendFileTranslated,
} from '../utils/fs.js'

/** One drained finding line — the canonical `FindingEntry` shape from `task-note.ts` (SSOT). */
type CreateGhIssueInput = Parameters<typeof createGhIssue>[1]
type CreateGhIssueResult = ReturnType<typeof createGhIssue>

interface SpoolFinding {
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

interface IssueSearchResult {
  issueNumber: number
  state: 'open' | 'closed'
  /** ISO close time when known — used for the closed-recently cooldown. */
  closedAt?: string
}

/**
 * Injectable side-effect surface. Production wires these to `gh`/`git`/the graph snapshot;
 * tests pass deterministic stubs so the promotion logic is exercised hermetically.
 */
interface PromoteDeps {
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

interface PromoteOptions {
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

type FindingsPromoteResult =
  | {
      ok: true
      promoted: Outcome[]
      dropped: Outcome[]
      skipped: Outcome[]
      deferred: Outcome[]
      /** Entries removed from the spool because they are durable elsewhere (#2733). */
      drained: Outcome[]
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
  const requiredStrings = [
    'ts',
    'note',
    'kind',
    'severity',
    'foundDuring',
    'file',
    'sha',
    'fingerprint',
  ]
  return (
    requiredStrings.every((key) => typeof o[key] === 'string') &&
    (o['line'] === null || (typeof o['line'] === 'number' && Number.isInteger(o['line']))) &&
    (o['graphNode'] === undefined || typeof o['graphNode'] === 'string')
  )
}

/** Read every `.arbiter/findings/*.jsonl` shard; unreadable or malformed data fails closed. */
function readSpool(dir: string): SpoolFinding[] {
  const findingsDir = join(dir, '.arbiter', 'findings')
  if (!existsSync(findingsDir)) return []
  let shards: string[]
  try {
    shards = readdirSync(findingsDir).filter((f) => f.endsWith('.jsonl'))
  } catch (err) {
    throw new Error(`findings spool directory is unreadable: ${String(err)}`, { cause: err })
  }
  const out: SpoolFinding[] = []
  for (const shard of shards.sort()) {
    let raw: string
    try {
      raw = readFileSync(join(findingsDir, shard), 'utf-8')
    } catch (err) {
      throw new Error(`${shard} is unreadable: ${String(err)}`, { cause: err })
    }
    for (const [index, line] of raw.split('\n').entries()) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch (err) {
        throw new Error(`${shard}:${index + 1} is not valid finding JSON: ${String(err)}`, {
          cause: err,
        })
      }
      if (!isSpoolFinding(parsed)) {
        throw new Error(`${shard}:${index + 1} does not match the finding schema`)
      }
      out.push(parsed)
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
 * Backs `arbiter finding list`. Empty when the spool is absent.
 */
function listSpoolFindings(dir: string): SpoolFinding[] {
  return dedupByFingerprint(readSpool(dir))
}

// ---------------------------------------------------------------------------
// Re-validate-against-HEAD ladder
// ---------------------------------------------------------------------------

type Verdict = 'promote' | 'drop' | 'age-sweep'
type FindingDisposition = 'READY' | 'STALE' | 'DEFERRED'

interface TriagedFinding {
  finding: SpoolFinding
  disposition: FindingDisposition
}

/**
 * Decide a single finding's fate against HEAD. Returns `age-sweep` for low-confidence
 * symbol-only findings (no reliable existence signal) so they are NEVER bare-grep-dropped.
 */
function revalidate(
  dir: string,
  f: SpoolFinding,
  deps: Pick<PromoteDeps, 'graphFresh' | 'graphHasNode'>,
): Verdict {
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

/** Classify every deduplicated finding without mutating the spool or contacting GitHub. */
function runFindingsTriage(
  opts: PromoteOptions,
  deps: Pick<PromoteDeps, 'graphFresh' | 'graphHasNode'>,
): TriagedFinding[] {
  const dir = opts.dir ?? process.cwd()
  const now = opts.now ?? new Date()
  const ageSweepDays = opts.ageSweepDays ?? DEFAULT_AGE_SWEEP_DAYS
  return listSpoolFindings(dir).map((finding) => {
    const verdict = revalidate(dir, finding, deps)
    const disposition: FindingDisposition =
      verdict === 'drop'
        ? 'STALE'
        : verdict === 'age-sweep' && ageInDays(finding.ts, now) < ageSweepDays
          ? 'DEFERRED'
          : 'READY'
    return { finding, disposition }
  })
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
    'Promoted from the `.arbiter/findings` spool by `arbiter finding promote`.',
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

type PromotionAction =
  | { kind: 'dropped' }
  /** `tracked`: an OPEN issue already carries this fingerprint. `false` = inside the
   *  closed-issue cooldown, where the finding is durable NOWHERE and must survive (#2733). */
  | { kind: 'skipped'; tracked: boolean }
  | { kind: 'deferred' }
  | { kind: 'promoted'; issueNumber: number }
  | { kind: 'failed'; reason: string }

function promoteOne(
  dir: string,
  finding: SpoolFinding,
  now: Date,
  ageSweepDays: number,
  deps: PromoteDeps,
): PromotionAction {
  const verdict = revalidate(dir, finding, deps)
  if (verdict === 'drop') return { kind: 'dropped' }
  if (verdict === 'age-sweep' && ageInDays(finding.ts, now) < ageSweepDays) {
    return { kind: 'deferred' }
  }
  const hit = deps.searchIssueByFingerprint(dir, finding.fingerprint)
  if (hit !== null && (hit.state === 'open' || recentlyClosed(hit, now))) {
    return { kind: 'skipped', tracked: hit.state === 'open' }
  }
  const result = deps.createIssue(dir, {
    title: `finding: ${finding.note.slice(0, 80)}`,
    body: buildBody(finding),
    labels: ['finding', 'tech-debt', severityToPriority(finding.severity)],
  })
  return result.ok
    ? { kind: 'promoted', issueNumber: result.issueNumber }
    : { kind: 'failed', reason: result.reason }
}

function ensureLabelFor(findings: readonly SpoolFinding[], dir: string, deps: PromoteDeps): void {
  if (findings.length > 0) deps.ensureFindingLabel(dir)
}

// ---------------------------------------------------------------------------
// Drain (#2733)
// ---------------------------------------------------------------------------

/** One fingerprint that left the spool because it is durable elsewhere. */
interface DrainRecord {
  fingerprint: string
  disposition: 'promoted' | 'dropped' | 'tracked'
  /** The issue this finding was filed as; absent for `dropped`/`tracked` entries. */
  issue?: number
  /**
   * The drained finding's ORIGINAL capture timestamp. The `stop-finding-loss` hook counts
   * receipts by this, not by the promote run's clock: promoting a previous session's spool
   * must not stand the guard down for a session that captured nothing itself.
   */
  capturedTs: string
  /**
   * The whole spool line. `promoted`/`tracked` findings survive in their issue; a `dropped`
   * one survives NOWHERE else, and rung 1 of `revalidate` drops on a missing path — which a
   * rename during the same task also produces. Keeping the line makes a false drop recoverable.
   */
  finding: SpoolFinding
}

/**
 * Remove the drained fingerprints from every spool shard and append one receipt line
 * per drain to `.arbiter/evidence/findings-promote/drained.jsonl`.
 *
 * The spool is the SSOT for STILL-OPEN findings: `collectFindingsMetrics`
 * (`scripts/debt-lib.mjs`) counts its fingerprints as open debt and the
 * `stop-finding-loss` hook counts its lines as this session's captures. Leaving a
 * promoted finding behind therefore keeps the debt ratchet red forever (#2733), and
 * draining it without a receipt makes the Stop hook report the capture as lost — so
 * the two writes belong together.
 *
 * Lines that do not parse, or carry no string fingerprint, are KEPT: nothing is deleted
 * unless it was proven drained. A shard that lost nothing is not rewritten at all, so the
 * per-shard isolation that lets concurrent `finding add` calls append without contending
 * still holds for every untouched shard. The write goes through the atomic temp+rename path
 * because the lines it preserves — cooldown and deferred findings — are durable nowhere else.
 *
 * ponytail: the affected shard is still a read-modify-write, so an append into THAT shard
 * between this read and write is lost. Acceptable because promote is an explicit single-run
 * operator command — switch to a tombstone file if concurrent promote+add becomes real.
 */
function toDrainRecord(f: SpoolFinding, disposition: DrainRecord['disposition']): DrainRecord {
  return { fingerprint: f.fingerprint, disposition, capturedTs: f.ts, finding: f }
}

function drainSpool(dir: string, records: readonly DrainRecord[], now: Date): void {
  if (records.length === 0) return
  const drained = new Set(records.map((r) => r.fingerprint))
  const findingsDir = join(dir, '.arbiter', 'findings')
  for (const shard of readdirSync(findingsDir).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(findingsDir, shard)
    const lines = readFileTranslated(path, 'utf-8').split('\n')
    let removed = 0
    const kept = lines.filter((line) => {
      const trimmed = line.trim()
      if (trimmed.length === 0) return false
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
        // `readSpool` has already rejected the whole run for malformed data by this point.
        // FAIL-OPEN-INTENT: an unparseable spool line is KEPT, which is the fail-CLOSED outcome for a deleter — the drain only removes what it proved durable elsewhere.
      } catch {
        return true
      }
      const fp = (parsed as { fingerprint?: unknown } | null)?.fingerprint
      if (typeof fp === 'string' && drained.has(fp)) {
        removed++
        return false
      }
      return true
    })
    if (removed === 0) continue // untouched shard — never rewritten
    const result = writeFile(path, kept.length > 0 ? kept.join('\n') + '\n' : '', {
      skipPreserveCheck: true,
    })
    assertWritten(result, `drained findings spool at ${path}`)
  }

  const evidenceDir = join(dir, '.arbiter', 'evidence', 'findings-promote')
  ensureDir(evidenceDir)
  const ts = now.toISOString()
  appendFileTranslated(
    join(evidenceDir, 'drained.jsonl'),
    records.map((r) => JSON.stringify({ ts, ...r })).join('\n') + '\n',
  )
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function runFindingsPromote(opts: PromoteOptions, deps: PromoteDeps): FindingsPromoteResult {
  const { dir = process.cwd(), now = new Date(), ageSweepDays = DEFAULT_AGE_SWEEP_DAYS } = opts

  const promoted: Outcome[] = []
  const dropped: Outcome[] = []
  const skipped: Outcome[] = []
  const deferred: Outcome[] = []
  const drained: Outcome[] = []
  const drainRecords: DrainRecord[] = []

  const unique = dedupByFingerprint(readSpool(dir))

  // Bootstrap the `finding` label once before any filing.
  ensureLabelFor(unique, dir, deps)

  const evidenceDir = join(dir, '.arbiter', 'evidence', 'findings-promote')
  let evidenceReady = false

  for (const f of unique) {
    const action = promoteOne(dir, f, now, ageSweepDays, deps)
    if (action.kind === 'dropped') {
      dropped.push(toOutcome(f))
      // The code this finding described is gone: it no longer describes reality.
      drained.push(toOutcome(f))
      drainRecords.push(toDrainRecord(f, 'dropped'))
      continue
    }
    if (action.kind === 'skipped') {
      skipped.push(toOutcome(f))
      // Only an OPEN issue makes the finding durable. A fingerprint inside the
      // closed-issue cooldown stays in the spool so it can be re-promoted later.
      if (action.tracked) {
        drained.push(toOutcome(f))
        drainRecords.push(toDrainRecord(f, 'tracked'))
      }
      continue
    }
    if (action.kind === 'deferred') {
      deferred.push(toOutcome(f))
      continue
    }
    // A failed filing aborts before any drain: a partial run never empties the spool.
    // Re-running is safe — the `arbiter-fp:` marker makes the search skip what was filed.
    if (action.kind === 'failed') return { ok: false, reason: action.reason }
    if (!evidenceReady) {
      ensureDir(evidenceDir)
      evidenceReady = true
    }
    appendTechDebtIssue(evidenceDir, action.issueNumber)
    promoted.push(toOutcome(f))
    drained.push(toOutcome(f))
    drainRecords.push({ ...toDrainRecord(f, 'promoted'), issue: action.issueNumber })
  }

  drainSpool(dir, drainRecords, now)

  return { ok: true, promoted, dropped, skipped, deferred, drained }
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
        'Promoted incidental finding (arbiter finding promote)',
      ],
      { cwd: dir, timeoutMs: 30_000 },
    )
  } catch (err: unknown) {
    // Label bootstrap is best-effort: a missing/erroring gh must not abort the drain.
    // FAIL-OPEN-INTENT: label creation is cosmetic; issue creation still supplies labels and fails closed.
    if (err instanceof CliError) return
    throw err
  }
}

interface GhIssueListItem {
  number: number
  state: string
  closedAt?: string | null
}

function isGhIssueListItem(value: unknown): value is GhIssueListItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<GhIssueListItem>
  if (typeof item.state !== 'string') return false
  return (
    typeof item.number === 'number' &&
    Number.isInteger(item.number) &&
    ['open', 'closed'].includes(item.state.toLowerCase()) &&
    (item.closedAt === undefined || item.closedAt === null || typeof item.closedAt === 'string')
  )
}

/** Search open+closed issues for the embedded fingerprint marker via gh full-text search. */
function searchIssueByFingerprint(dir: string, fingerprint: string): IssueSearchResult | null {
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
  const parsed: unknown = JSON.parse(result.stdout)
  if (!Array.isArray(parsed)) throw new Error('malformed GitHub issue search response')
  if (parsed.length === 0) return null
  const first: unknown = parsed[0]
  if (!isGhIssueListItem(first)) {
    throw new Error('malformed GitHub issue search response')
  }
  const state = first.state.toLowerCase() as 'open' | 'closed'
  const out: IssueSearchResult = { issueNumber: first.number, state }
  if (typeof first.closedAt === 'string' && first.closedAt.length > 0) out.closedAt = first.closedAt
  return out
}

/** Graph is fresh when graph.json's mtime is at-or-after HEAD's commit time. */
function graphFresh(dir: string): boolean {
  const graphPath = join(dir, '.arbiter', 'graph.json')
  if (!existsSync(graphPath)) return false
  const graphMtime = statSync(graphPath).mtimeMs
  const result = runCli('git', ['log', '-1', '--format=%cI', 'HEAD'], {
    cwd: dir,
    timeoutMs: 5000,
  })
  const headTime = Date.parse(result.stdout.trim())
  if (Number.isNaN(headTime)) return false
  return graphMtime >= headTime
}

function graphHasNode(dir: string, nodeId: string): boolean {
  const graphPath = join(dir, '.arbiter', 'graph.json')
  const outcome = loadGraphSnapshot(graphPath)
  if (!outcome.ok) return false
  return outcome.snapshot.nodes.some((n) => n.id === nodeId)
}

/** Production deps: the real gh / git / graph side effects. */
const defaultPromoteDeps: PromoteDeps = {
  ensureFindingLabel,
  searchIssueByFingerprint,
  createIssue: (dir, input) => createGhIssue(dir, input),
  graphFresh,
  graphHasNode,
}

export const findingOperations = {
  list: listSpoolFindings,
  triage: runFindingsTriage,
  promote: runFindingsPromote,
  defaultDeps: defaultPromoteDeps,
}
