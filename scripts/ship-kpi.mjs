#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/ship-kpi.mjs (#2398) — throughput KPI report from git + gh, no LLM.
//
// Root cause fixed: session handovers hand-quote throughput numbers ("1 PR
// merged/24h, 67 commits/PR, ~60% review-loop...") gathered by eyeballing
// `gh pr list`/`git log` output once, ad hoc, per wave. This script makes
// that reproducible: same window, same predicates, every time.
//
// CI-red-at-open approximation: GitHub does not expose the FIRST check-run
// snapshot for a merged PR, only the CURRENT statusCheckRollup. `ciRedAtOpen`
// therefore reports whether the rollup carries a FAILURE conclusion NOW,
// which under-counts red-at-open PRs that were re-run to green before
// inspection. Documented, not fixed — no cheaper data source exists via `gh`.
//
// Usage: ship-kpi --since <date> [--until <date>] [--repo owner/name]
//                  [--json <path>] [--sessions <dir>]
//        ship-kpi --self-test   (pure predicate fixtures, no `gh`/`git` calls)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ghJson } from './lib/gh-audit-io.mjs'
import { classify } from './pr-merge-watch.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.claude/projects/-home-luca-work-repos-arbiter')

// ---- Pure classifiers (exported, covered by --self-test + vitest) --------

const EVIDENCE_SUBJECT_RE =
  /^chore\(.*\): (refresh|record|correlate|finalize|complete|align) .*(evidence|manifest)/i
const REVIEW_LOOP_RE =
  /\b(close|harden|bind|reject|preserve|confine|restore)\b.*\b(gap|gaps|bypass|bypasses|evidence|review|regression|blocker|blockers)\b/i
const FEAT_RE = /^feat(\(|:)/i
const HOOK_BLOCK_RE = /hook error: \[node \.claude\/hooks\/([a-z-]+)\.mjs\]/g

export function isEvidenceOnlySubject(subject) {
  return EVIDENCE_SUBJECT_RE.test(subject ?? '')
}

export function isEvidenceOnlyCommit(subject, touchedOnlyEvidencePaths) {
  return isEvidenceOnlySubject(subject) || touchedOnlyEvidencePaths === true
}

export function isReviewLoopSubject(subject) {
  return REVIEW_LOOP_RE.test(subject ?? '')
}

/** Index of the first commit subject that is NOT `feat(...)`/`feat:` — or -1. */
export function firstNonFeatIndex(subjects) {
  return subjects.findIndex((s) => !FEAT_RE.test(s))
}

/** Review-loop commits are only counted AFTER the first non-feat commit (spec: #2398). */
export function countReviewLoopCommits(subjects) {
  const boundary = firstNonFeatIndex(subjects)
  if (boundary === -1) return 0
  return subjects.slice(boundary + 1).filter(isReviewLoopSubject).length
}

/** True only when every path in a commit's diffstat lives under .arbiter/ or .agents/. */
export function isAllEvidencePaths(paths) {
  return (
    paths.length > 0 && paths.every((p) => p.startsWith('.arbiter/') || p.startsWith('.agents/'))
  )
}

/** Parse `git show --stat --format=` output into the list of touched paths. */
export function parseGitShowStatPaths(output) {
  return (output ?? '')
    .split('\n')
    .map((line) => /^\s*(\S.*?)\s+\|\s+\d+/.exec(line)?.[1])
    .filter(Boolean)
}

export function leadTimeHours(firstCommitIso, mergedAtIso) {
  const ms = new Date(mergedAtIso).getTime() - new Date(firstCommitIso).getTime()
  return Math.round((ms / 3_600_000) * 10) / 10
}

export function median(numbers) {
  if (numbers.length === 0) return 0
  const sorted = [...numbers].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function pct(part, total) {
  if (total === 0) return 0
  return Math.round((part / total) * 1000) / 10
}

export function hasFailureConclusion(rollup) {
  return Array.isArray(rollup) && rollup.some((c) => c.conclusion === 'FAILURE')
}

/** Open PR older than `staleHours` whose rollup is not `classify()`-green. */
export function isStaleOpenPr(pr, nowMs, staleHours = 2) {
  const ageHours = (nowMs - new Date(pr.createdAt).getTime()) / 3_600_000
  if (ageHours <= staleHours) return false
  return classify(pr.statusCheckRollup ?? []) !== 'green'
}

/** @param {{subject:string, touchedOnlyEvidencePaths?: boolean}[]} commits */
export function classifyPrCommits(commits) {
  const subjects = commits.map((c) => c.subject)
  const evidenceOnlyCount = commits.filter((c) =>
    isEvidenceOnlyCommit(c.subject, c.touchedOnlyEvidencePaths),
  ).length
  return { evidenceOnlyCount, reviewLoopCount: countReviewLoopCommits(subjects) }
}

/** @param {{number:number, mergedAt:string, additions?:number, deletions?:number, statusCheckRollup?: unknown[]}} pr */
export function buildPrRow(pr, commits) {
  const { evidenceOnlyCount, reviewLoopCount } = classifyPrCommits(commits)
  return {
    number: pr.number,
    commits: commits.length,
    evidenceOnlyCommits: evidenceOnlyCount,
    reviewLoopCommits: reviewLoopCount,
    leadTimeHours: commits.length > 0 ? leadTimeHours(commits[0].authoredDate, pr.mergedAt) : 0,
    ciRedAtOpen: hasFailureConclusion(pr.statusCheckRollup),
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
  }
}

export function computeAggregate({
  rows,
  issuesClosedCount,
  windowHours,
  mainSubjects,
  openPrs,
  nowMs,
}) {
  const totalCommits = rows.reduce((s, r) => s + r.commits, 0)
  const totalEvidenceOnly = rows.reduce((s, r) => s + r.evidenceOnlyCommits, 0)
  const totalReviewLoop = rows.reduce((s, r) => s + r.reviewLoopCommits, 0)
  const staleOpenPrs = openPrs.filter((pr) => isStaleOpenPr(pr, nowMs))
  const mainEvidenceOnly = mainSubjects.filter(isEvidenceOnlySubject).length
  return {
    prsMerged: rows.length,
    issuesClosed: issuesClosedCount,
    issuesPer24h:
      windowHours > 0 ? Math.round((issuesClosedCount / windowHours) * 24 * 10) / 10 : 0,
    medianCommitsPerPr: median(rows.map((r) => r.commits)),
    medianLeadTimeHours: median(rows.map((r) => r.leadTimeHours)),
    pctEvidenceOnlyCommits: pct(totalEvidenceOnly, totalCommits),
    pctReviewLoopCommits: pct(totalReviewLoop, totalCommits),
    openPrsStale: staleOpenPrs.map((pr) => pr.number),
    pctMainEvidenceOnlyCommits: pct(mainEvidenceOnly, mainSubjects.length),
  }
}

/** Count `hook error: [node .claude/hooks/<name>.mjs]` lines in *.jsonl files mtime'd in-window. */
export function countHookBlocks(dir, sinceMs, untilMs) {
  if (!existsSync(dir)) return {}
  const counts = {}
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const full = join(dir, name)
    let mtimeMs
    try {
      mtimeMs = statSync(full).mtimeMs
      // FAIL-OPEN-INTENT: an unstattable session log is skipped, not counted - this is a reporting metric over a best-effort log dir, never a gate verdict.
    } catch {
      continue
    }
    if (mtimeMs < sinceMs || mtimeMs > untilMs) continue
    let content
    try {
      content = readFileSync(full, 'utf-8')
      // FAIL-OPEN-INTENT: an unreadable session log is skipped, not counted - see above.
    } catch {
      continue
    }
    for (const match of content.matchAll(HOOK_BLOCK_RE)) {
      counts[match[1]] = (counts[match[1]] ?? 0) + 1
    }
  }
  return counts
}

// ---- I/O layer (gh + git) -------------------------------------------------

function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }).trim()
}

function ghJsonOrThrow(args, label) {
  const result = ghJson(args)
  if (!result.ok) throw new Error(`${label}: ${result.reason}`)
  return result.data
}

function mergedSearch(since, until) {
  return until ? `merged:${since}..${until}` : `merged:>=${since}`
}

function closedSearch(since, until) {
  return until ? `closed:${since}..${until}` : `closed:>=${since}`
}

function repoArgs(repo) {
  return repo ? ['--repo', repo] : []
}

function fetchMergedPrNumbers(repo, since, until) {
  const data = ghJsonOrThrow(
    [
      'pr',
      'list',
      '--state',
      'merged',
      '--search',
      mergedSearch(since, until),
      '--json',
      'number',
      '--limit',
      '200',
      ...repoArgs(repo),
    ],
    'gh pr list (merged)',
  )
  return data.map((pr) => pr.number)
}

function fetchOpenPrs(repo) {
  return ghJsonOrThrow(
    [
      'pr',
      'list',
      '--state',
      'open',
      '--json',
      'number,createdAt,statusCheckRollup',
      '--limit',
      '200',
      ...repoArgs(repo),
    ],
    'gh pr list (open)',
  )
}

function fetchIssuesClosedCount(repo, since, until) {
  const data = ghJsonOrThrow(
    [
      'issue',
      'list',
      '--state',
      'closed',
      '--search',
      closedSearch(since, until),
      '--json',
      'number',
      '--limit',
      '500',
      ...repoArgs(repo),
    ],
    'gh issue list (closed)',
  )
  return data.length
}

function fetchPrDetail(repo, number) {
  return ghJsonOrThrow(
    [
      'pr',
      'view',
      String(number),
      '--json',
      'commits,createdAt,mergedAt,additions,deletions,statusCheckRollup',
      ...repoArgs(repo),
    ],
    `gh pr view #${number}`,
  )
}

/** git show --stat for `sha`; undefined (message-only fallback) if the sha isn't local. */
function touchedOnlyEvidencePaths(sha) {
  let out
  try {
    out = execFileSync('git', ['show', '--stat', '--format=', sha], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    // FAIL-OPEN-INTENT: `undefined` is this function's documented "sha is not local" answer - the caller then falls back to the commit message, which is the point of the contract.
  } catch {
    return undefined
  }
  return isAllEvidencePaths(parseGitShowStatPaths(out))
}

function fetchPrRow(repo, number) {
  const pr = fetchPrDetail(repo, number)
  const commits = (pr.commits ?? []).map((c) => ({
    subject: c.messageHeadline,
    authoredDate: c.authoredDate,
    touchedOnlyEvidencePaths: touchedOnlyEvidencePaths(c.oid),
  }))
  // `gh pr view --json` (per #2398 spec's field list) does not include `number` —
  // it's already known from the `pr list` call that produced this PR, so inject it.
  return buildPrRow({ ...pr, number }, commits)
}

// `git log --since/--until` resolve in the LOCAL timezone while the `gh` search
// queries above are UTC-dated — up to a ~12h skew between this main-log stat
// and the PR/issue stats near a window edge. Same documented-approximation
// class as `ciRedAtOpen`; not fixed (git has no `--since-utc`).
function fetchMainSubjects(since, until) {
  const args = ['log', 'origin/main', `--since=${since}`, '--pretty=format:%s']
  if (until) args.push(`--until=${until} 23:59:59`)
  const out = git(args)
  return out === '' ? [] : out.split('\n')
}

// ---- CLI --------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    since: null,
    until: null,
    repo: null,
    json: null,
    sessions: DEFAULT_SESSIONS_DIR,
    selfTest: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') opts.selfTest = true
    else if (a === '--since') opts.since = argv[++i]
    else if (a === '--until') opts.until = argv[++i]
    else if (a === '--repo') opts.repo = argv[++i]
    else if (a === '--json') opts.json = argv[++i]
    else if (a === '--sessions') opts.sessions = argv[++i]
  }
  return opts
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function renderMarkdown({ since, until, rows, aggregate, hookBlocks }) {
  const lines = []
  lines.push(`# Ship KPI — ${since} → ${until}`, '')
  lines.push('## Per-PR', '')
  lines.push(
    '| PR | Commits | Evidence-only | Review-loop | Lead time (h) | CI red at open | +/- |',
  )
  lines.push(
    '|----|---------|---------------|-------------|----------------|----------------|-----|',
  )
  for (const r of rows) {
    lines.push(
      `| #${r.number} | ${r.commits} | ${r.evidenceOnlyCommits} | ${r.reviewLoopCommits} | ${r.leadTimeHours} | ${r.ciRedAtOpen ? 'yes' : 'no'} | +${r.additions}/-${r.deletions} |`,
    )
  }
  lines.push('', '## Aggregate', '')
  lines.push('| Metric | Value |', '|--------|-------|')
  lines.push(`| PRs merged | ${aggregate.prsMerged} |`)
  lines.push(`| Issues closed | ${aggregate.issuesClosed} |`)
  lines.push(`| Issues/24h | ${aggregate.issuesPer24h} |`)
  lines.push(`| Median commits/PR | ${aggregate.medianCommitsPerPr} |`)
  lines.push(`| Median lead time (h) | ${aggregate.medianLeadTimeHours} |`)
  lines.push(`| % evidence-only commits | ${aggregate.pctEvidenceOnlyCommits}% |`)
  lines.push(`| % review-loop commits | ${aggregate.pctReviewLoopCommits}% |`)
  lines.push(
    `| Open PRs stale (>2h, not green) | ${aggregate.openPrsStale.length === 0 ? 'none' : aggregate.openPrsStale.map((n) => `#${n}`).join(', ')} |`,
  )
  lines.push(`| % main commits evidence-only (window) | ${aggregate.pctMainEvidenceOnlyCommits}% |`)
  if (Object.keys(hookBlocks).length > 0) {
    lines.push('', '## Hook blocks (session logs)', '')
    lines.push('| Hook | Blocks |', '|------|--------|')
    for (const [name, count] of Object.entries(hookBlocks).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${name} | ${count} |`)
    }
  }
  return lines.join('\n') + '\n'
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.selfTest) process.exit(runSelfTest())

  if (!opts.since) {
    process.stderr.write(
      'usage: ship-kpi --since <date> [--until <date>] [--repo owner/name] [--json <path>] [--sessions <dir>]\n' +
        '       ship-kpi --self-test\n',
    )
    process.exit(2)
  }

  const until = opts.until
  const prNumbers = fetchMergedPrNumbers(opts.repo, opts.since, until)
  const rows = prNumbers.map((n) => fetchPrRow(opts.repo, n))
  const openPrs = fetchOpenPrs(opts.repo)
  const issuesClosedCount = fetchIssuesClosedCount(opts.repo, opts.since, until)
  const mainSubjects = fetchMainSubjects(opts.since, until)

  const sinceMs = new Date(`${opts.since}T00:00:00Z`).getTime()
  const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : Date.now()
  const windowHours = (untilMs - sinceMs) / 3_600_000

  const aggregate = computeAggregate({
    rows,
    issuesClosedCount,
    windowHours,
    mainSubjects,
    openPrs,
    nowMs: Date.now(),
  })

  const hookBlocks = countHookBlocks(opts.sessions, sinceMs, untilMs)

  const untilLabel = until ?? today()
  const payload = {
    since: opts.since,
    until: untilLabel,
    repo: opts.repo,
    generatedAt: new Date().toISOString(),
    ciRedAtOpenApproximation:
      'ciRedAtOpen reflects the CURRENT statusCheckRollup, not the first run at PR-open time — GitHub does not retain that snapshot via gh.',
    rows,
    aggregate,
    hookBlocks,
  }

  process.stdout.write(
    renderMarkdown({ since: opts.since, until: untilLabel, rows, aggregate, hookBlocks }),
  )

  const jsonPath = opts.json ?? join('.arbiter/evidence/kpi', `${untilLabel}.json`)
  mkdirSync(join(jsonPath, '..'), { recursive: true })
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n')
  process.stderr.write(`ship-kpi: wrote ${jsonPath}\n`)
}

// ---- Self-test ----------------------------------------------------------

const SELF_TEST_FIXTURES = [
  {
    name: 'evidence-only subject matches (chore refresh ... evidence)',
    run: () => isEvidenceOnlySubject('chore(#2354): refresh wave evidence'),
    expected: true,
  },
  {
    name: 'evidence-only path-only commit (non-matching subject, all .arbiter/ paths)',
    run: () => isEvidenceOnlyCommit('fix(#100): typo', true),
    expected: true,
  },
  {
    name: 'non-evidence commit is not evidence-only',
    run: () => isEvidenceOnlyCommit('feat(#100): add widget', false),
    expected: false,
  },
  {
    name: 'review-loop subject matches (close gaps)',
    run: () => isReviewLoopSubject('fix(#100): close review gaps'),
    expected: true,
  },
  {
    name: 'review-loop count skips leading feat commits, counts after first non-feat',
    run: () =>
      countReviewLoopCommits([
        'feat(#1): add thing',
        'feat(#1): add more',
        'fix(#1): typo',
        'fix(#1): harden bypass',
      ]) === 1,
    expected: true,
  },
  {
    name: 'review-loop count is 0 when every commit is feat (no boundary)',
    run: () => countReviewLoopCommits(['feat(#1): a', 'feat(#1): b']) === 0,
    expected: true,
  },
  {
    name: 'median of even-length array averages the two middle values',
    run: () => median([1, 2, 3, 4]) === 2.5,
    expected: true,
  },
  {
    name: 'pct(0, 0) is 0, not NaN',
    run: () => pct(0, 0) === 0,
    expected: true,
  },
  {
    name: 'hasFailureConclusion true when any conclusion is FAILURE',
    run: () => hasFailureConclusion([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }]),
    expected: true,
  },
  {
    name: 'isStaleOpenPr false when PR is younger than 2h even if red',
    run: () =>
      isStaleOpenPr(
        {
          createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
          statusCheckRollup: [{ conclusion: 'FAILURE' }],
        },
        Date.now(),
      ) === false,
    expected: true,
  },
]

function runSelfTest() {
  let failures = 0
  for (const { name, run, expected } of SELF_TEST_FIXTURES) {
    const got = run()
    const ok = got === expected
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name} (expected ${expected}, got ${got})\n`)
    if (!ok) failures++
  }
  return failures === 0 ? 0 : 1
}

if (isMainModule(import.meta.url)) {
  try {
    await main()
  } catch (err) {
    process.stderr.write(`ship-kpi: unexpected error: ${err?.stack ?? err}\n`)
    process.exit(2)
  }
}
