// SPDX-License-Identifier: Apache-2.0
//
// #1259 — thin `gh` adapter that fetches exactly the AffinityIssue signals for a
// ship subject + its candidate siblings. Isolated from the pure scorer so the
// scorer stays I/O-free and #1263 (batch) can supply its own issue set instead.
// All shell-outs go through the shared runCli helper (INV-12).
import { runCliJson } from '../utils/run-cli.js'
import { readUnifiedState } from '../commands/task-state.js'
import { renderShipAffinity, type AffinityIssue } from './affinity.js'

/** Raw `gh issue` shape (only the fields the rubric scores over). */
interface GhIssueRaw {
  number: number
  labels?: Array<{ name: string }>
  milestone?: { title: string } | null
}

const SIBLING_CAP = 30

function stripHash(id: string): string {
  return id.startsWith('#') ? id.slice(1) : id
}

/**
 * Validate `gh issue {view,list}` JSON before it is trusted as a
 * {@link GhIssueRaw}. `runCliJson` returns `unknown` so callers narrow it; a
 * blind `as GhIssueRaw` cast let a missing `number` surface downstream as the
 * id `#undefined`. `toAffinityIssue` already degrades gracefully on
 * `labels`/`milestone`, so only `number` needs a hard assertion. (#1536)
 */
function assertGhIssueRaw(value: unknown, ctx: string): GhIssueRaw {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Record<string, unknown>)['number'] !== 'number'
  ) {
    throw new Error(`Unexpected ${ctx} output: missing numeric "number" field`)
  }
  return value as GhIssueRaw
}

function parseGhIssueRawList(raw: unknown): GhIssueRaw[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `Unexpected gh issue list output: expected array, got ${raw === null ? 'null' : typeof raw}`,
    )
  }
  return raw.map((item, i) => assertGhIssueRaw(item, `gh issue list[${i}]`))
}

function toAffinityIssue(raw: GhIssueRaw): AffinityIssue {
  const issue: AffinityIssue = {
    id: `#${raw.number}`,
    labels: (raw.labels ?? []).map((l) => l.name),
  }
  if (raw.milestone && raw.milestone.title) issue.milestone = raw.milestone.title
  return issue
}

/**
 * Fetch the subject issue and its candidate siblings (other OPEN issues in the
 * same milestone, capped). Throws on `gh` failure — callers (`renderShipAffinity`)
 * catch and degrade to an "unavailable" advisory so the ship never blocks.
 */
export function fetchAffinityContext(
  subjectId: string,
  opts: { dir?: string } = {},
): { subject: AffinityIssue; candidates: AffinityIssue[] } {
  const num = stripHash(subjectId)
  const cwdOpt = opts.dir !== undefined ? { cwd: opts.dir } : {}

  const rawSubject = assertGhIssueRaw(
    runCliJson('gh', ['issue', 'view', num, '--json', 'number,labels,milestone'], cwdOpt),
    'gh issue view',
  )
  const subject = toAffinityIssue(rawSubject)

  // No milestone → no same-milestone siblings to correlate against (solo).
  if (subject.milestone === undefined) return { subject, candidates: [] }

  const rawList = parseGhIssueRawList(
    runCliJson(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--milestone',
        subject.milestone,
        '--limit',
        String(SIBLING_CAP),
        '--json',
        'number,labels,milestone',
      ],
      cwdOpt,
    ),
  )

  const candidates = rawList
    .map(toAffinityIssue)
    .filter((c) => c.id !== subject.id)
    .slice(0, SIBLING_CAP)

  return { subject, candidates }
}

/**
 * `gh`-backed convenience for the `arbiter ship` CLI action: render the affinity
 * lines for a subject issue using the real `gh` fetcher. Never throws (delegates
 * to renderShipAffinity, which degrades a failed fetch to an advisory line).
 */
export function renderShipAffinityWithGh(subjectId: string, opts: { dir?: string } = {}): string[] {
  return renderShipAffinity(subjectId, {
    loadIssues: (id) => fetchAffinityContext(id, opts.dir !== undefined ? { dir: opts.dir } : {}),
  })
}

/**
 * #1259 — resolve the ship subject issue id (CLI arg or persisted task state) and
 * render its affinity step-output lines. Returns an advisory when no id is
 * available; always returns ≥1 line and never throws.
 *
 * `render` is injectable so the id-resolution glue is unit-testable without `gh`.
 */
export function shipAffinityLines(
  id: string | undefined,
  dir: string | undefined,
  render: (subject: string, opts: { dir?: string }) => string[] = renderShipAffinityWithGh,
): string[] {
  const subject = id ?? readUnifiedState(dir ?? process.cwd())?.taskId
  if (subject === undefined || subject.length === 0) {
    return ['Affinity: unavailable — no issue id to compute against.']
  }
  return render(subject, dir !== undefined ? { dir } : {})
}
