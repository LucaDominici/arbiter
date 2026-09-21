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
//                  [--json <path>] [--sessions <dir>] [--codex-sessions <dir>]
//        ship-kpi --self-test   (pure predicate fixtures, no `gh`/`git` calls)
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { ghJson } from './lib/gh-audit-io.mjs'
import { classify } from './pr-merge-watch.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.claude/projects')
const DEFAULT_CODEX_SESSIONS_DIR = join(homedir(), '.codex/sessions')
const KPI_HISTORY_DIR = join(process.cwd(), '.arbiter/evidence/kpi')
const BASELINE_PATH = join(process.cwd(), 'scripts/data/ship-kpi-baseline.json')
const THRESHOLDS_PATH = join(process.cwd(), 'scripts/data/ship-kpi-thresholds.json')
const REMOVED_CONTROLS_PATH = join(process.cwd(), 'scripts/data/ship-kpi-removed-controls.json')
const TUNING_LOG_PATH = join(process.cwd(), 'docs/internal/SYSTEM/SHIP_TUNING_LOG.md')

// ---- Pure classifiers (exported, covered by --self-test + vitest) --------

const EVIDENCE_SUBJECT_RE =
  /^chore\(.*\): (refresh|record|correlate|finalize|complete|align) .*(evidence|manifest)/i
const REVIEW_LOOP_RE =
  /\b(close|harden|bind|reject|preserve|confine|restore)\b.*\b(gap|gaps|bypass|bypasses|evidence|review|regression|blocker|blockers)\b/i
const FEAT_RE = /^feat(\(|:)/i
const HOOK_BLOCK_RE = /hook error: \[node \.claude\/hooks\/([a-z-]+)\.mjs\]/g
const LEAD_TIME_KINDS = [
  'work',
  'verify',
  'preflight',
  'fullGate',
  'review',
  'ciWait',
  'ciRun',
  'rework',
]
const REVIEWER_RE = /review|red[-_ ]?team|verifier|ac[-_ ]?fit/i
const FULL_GATE_RE = /check-all\.mjs\s+L2\b|arbiter\s+(?:check|gate)\s+run\b/i
const PREFLIGHT_RE = /check-all\.mjs\s+L1\b|\bpreflight\b/i
const NON_HUMAN_PROMPT_PREFIXES = [
  '<task-notification>',
  '<system-reminder>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '[Request interrupted',
]
let configuredWeights = null

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
  if (numbers.length === 0) return null
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

function display(value) {
  return value ?? 'NO DATA'
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rounded(value, places = 1) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Weight known token components without turning an entirely unknown split into zero. */
export function costUnits(tokens, weights) {
  if (finiteNumber(tokens) !== null) return tokens
  const values = ['input', 'cache', 'output'].map((key) => finiteNumber(tokens?.[key]))
  if (values.every((value) => value === null)) return null
  const effectiveWeights = weights ?? configuredCostWeights()
  if (['input', 'cache', 'output'].some((key) => finiteNumber(effectiveWeights?.[key]) === null)) {
    throw new Error('costWeights must define finite input, cache, and output weights')
  }
  return values.reduce((total, value, index) => {
    const key = ['input', 'cache', 'output'][index]
    const weight = effectiveWeights[key]
    return total + (value ?? 0) * weight
  }, 0)
}

/** Split ordered phase events; an unavailable phase stays null, never zero. */
export function splitLeadTime(events) {
  const kinds = leadTimeKinds(events)
  const result = Object.fromEntries(kinds.map((kind) => [kind, null]))
  if (!Array.isArray(events)) return result
  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i]
    const next = events[i + 1]
    const kind = current?.kind
    const start = Date.parse(current?.t ?? '')
    const end = Date.parse(next?.t ?? '')
    if (validLeadTimeEvent(kind, start, end)) addLeadTime(result, kind, start, end)
  }
  return result
}

function leadTimeKinds(events) {
  const hasMeasuredPhase =
    Array.isArray(events) &&
    events.some((event) => ['preflight', 'fullGate', 'ciRun'].includes(event?.kind))
  return hasMeasuredPhase
    ? LEAD_TIME_KINDS
    : ['work', 'verify', 'review', 'ciWait', 'rework', 'ceremony']
}

function validLeadTimeEvent(kind, start, end) {
  return (
    (LEAD_TIME_KINDS.includes(kind) || kind === 'ceremony') &&
    Number.isFinite(start) &&
    Number.isFinite(end)
  )
}

function addLeadTime(result, kind, start, end) {
  const seconds = rounded(Math.max(0, end - start) / 1000)
  result[kind] = result[kind] === null ? seconds : rounded(result[kind] + seconds)
}

function parseSessionLine(line) {
  try {
    return JSON.parse(line)
    // FAIL-OPEN-INTENT: malformed session lines are skipped because this is a best-effort delivery metric; the affected fields remain null rather than becoming zero.
  } catch {
    return null
  }
}

function usageValue(usage, ...names) {
  for (const name of names) {
    const value = finiteNumber(usage?.[name])
    if (value !== null) return value
  }
  return null
}

function addMetric(total, value) {
  return value === null ? total : (total ?? 0) + value
}

/** Aggregate Claude JSONL usage without turning absent usage into zero. */
export function sessionUsage(lines) {
  const state = { input: null, output: null, cache: null, humanMessages: 0, seenUsage: new Set() }
  for (const line of Array.isArray(lines) ? lines : []) {
    const event = parseSessionLine(line)
    if (event === null) continue
    const role = event.message?.role ?? event.type
    if (isGenuineClaudeUser(event, role)) state.humanMessages++
    consumeSessionUsage(state, event)
  }
  return {
    input: state.input,
    output: state.output,
    cache: state.cache,
    humanMessages: state.humanMessages,
  }
}

function consumeSessionUsage(state, event) {
  const usage = event.message?.usage ?? event.usage
  if (!usage || !shouldCountClaudeUsage(state.seenUsage, event)) return
  updateClaudeUsage(state, usage)
}

/** Select the treatment, widening sensitive/train deliveries before size fallback. */
export function stratumOf(delivery) {
  if (delivery?.sensitive === true || delivery?.train === true) return 'Sensitive-train'
  if (hasTreatment(delivery)) return delivery.treatment
  const changedLoc = finiteNumber(delivery?.changedLoc)
  if (changedLoc === null) return null
  return changedLoc < 200 ? 'XS-S' : 'Standard'
}

function hasTreatment(delivery) {
  return typeof delivery?.treatment === 'string' && delivery.treatment.trim() !== ''
}

/** Median and nearest-rank p90, ignoring null and non-finite values. */
export function quantiles(values) {
  const sorted = (Array.isArray(values) ? values : [])
    .filter((value) => finiteNumber(value) !== null)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return { median: null, p90: null }
  const mid = Math.floor(sorted.length / 2)
  const medianValue = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const p90Index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1)
  return { median: medianValue, p90: sorted[p90Index] }
}

function ratio(value, baseline) {
  if (value === null || baseline === null || baseline <= 0) return null
  return rounded(value / baseline, 2)
}

function sourceKnown(delivery, source) {
  return Array.isArray(delivery?.sourcesKnown) && delivery.sourcesKnown.includes(source)
}

function sessionSourceKnown(delivery) {
  return sourceKnown(delivery, 'claude') || sourceKnown(delivery, 'codex')
}

function measuredFloor(delivery) {
  const names = ['preflight', 'fullGate', 'review', 'ci']
  const values = [
    finiteNumber(delivery?.preflight),
    finiteNumber(delivery?.fullGate),
    finiteNumber(delivery?.review),
    finiteNumber(delivery?.ciRun) ?? finiteNumber(delivery?.ci),
  ]
  return {
    total: values.reduce((sum, value) => sum + (value ?? 0), 0),
    missing: names.filter((_, index) => values[index] === null),
  }
}

/** AC-3: compare delivery lead time/cost with its measured floor plus frozen writer reference. */
export function overheadIndices(delivery, baseline, weights) {
  const reference = baseline?.[delivery?.stratum]
  if (!reference) return { time: null, tokens: null }
  const leadTime = finiteNumber(delivery?.leadTime)
  const measuredTokens = costUnits(delivery?.tokens, weights)
  const referenceTime = finiteNumber(reference.writerTimeMedianSec)
  const referenceTokens = finiteNumber(reference.writerCostUnitsMedian)
  const floor = measuredFloor(delivery)
  const ciKnown = sourceKnown(delivery, 'ci')
  const timeFloor = referenceTime === null ? null : floor.total + referenceTime
  return overheadResult(
    delivery,
    leadTime,
    measuredTokens,
    timeFloor,
    referenceTokens,
    floor,
    ciKnown,
  )
}

function overheadResult(
  delivery,
  leadTime,
  measuredTokens,
  timeFloor,
  referenceTokens,
  floor,
  ciKnown,
) {
  const result = {
    time:
      ciKnown && sessionSourceKnown(delivery) && floor.missing.length === 0
        ? ratio(leadTime, timeFloor)
        : null,
    tokens: ciKnown && sessionSourceKnown(delivery) ? ratio(measuredTokens, referenceTokens) : null,
  }
  if (!Array.isArray(delivery?.sourcesKnown)) return result
  return {
    ...result,
    floorComponents: {
      time: {
        leadTime,
        measured: floor.total,
        writerReference: finiteNumber(timeFloor) === null ? null : timeFloor - floor.total,
        missing: floor.missing,
      },
      tokens: { measured: measuredTokens, reference: referenceTokens },
    },
  }
}

/** Derive CI queue/run time from completed checks that finished before merge. */
export function ciTiming(pr) {
  const createdMs = Date.parse(pr?.createdAt ?? '')
  const mergedMs = Date.parse(pr?.mergedAt ?? '')
  const checks = (Array.isArray(pr?.statusCheckRollup) ? pr.statusCheckRollup : []).filter(
    (check) => {
      const startedMs = Date.parse(check?.startedAt ?? '')
      const completedMs = Date.parse(check?.completedAt ?? '')
      return (
        check?.status === 'COMPLETED' &&
        Number.isFinite(startedMs) &&
        Number.isFinite(completedMs) &&
        Number.isFinite(mergedMs) &&
        completedMs <= mergedMs
      )
    },
  )
  if (checks.length === 0) return { ciWaitSec: null, ciRunSec: null, redCiRuns: null }
  const starts = checks.map((check) => Date.parse(check.startedAt))
  const completes = checks.map((check) => Date.parse(check.completedAt))
  return {
    ciWaitSec: Number.isFinite(createdMs)
      ? Math.round(Math.max(0, Math.min(...starts) - createdMs) / 1000)
      : null,
    ciRunSec: Math.round(Math.max(0, Math.max(...completes) - Math.min(...starts)) / 1000),
    redCiRuns: null,
  }
}

export function redCiRunsFromHistory(commits) {
  if (!Array.isArray(commits)) return null
  return commits
    .flatMap((commit) => (Array.isArray(commit?.checkRuns) ? commit.checkRuns : []))
    .filter((check) => String(check?.conclusion ?? '').toUpperCase() === 'FAILURE').length
}

function sessionOverlaps(session, firstCommit, mergedAt) {
  const firstMs = Date.parse(firstCommit ?? '')
  const mergedMs = Date.parse(mergedAt ?? '')
  const sessionFirstMs = Date.parse(session?.firstTs ?? '')
  const sessionLastMs = Date.parse(session?.lastTs ?? '')
  const windowStartMs = firstMs - 2 * 60 * 60 * 1000
  return (
    validSessionWindow(firstMs, mergedMs, sessionFirstMs, sessionLastMs) &&
    sessionFirstMs <= mergedMs &&
    sessionLastMs >= windowStartMs
  )
}

function validSessionWindow(firstMs, mergedMs, sessionFirstMs, sessionLastMs) {
  return [firstMs, mergedMs, sessionFirstMs, sessionLastMs].every(Number.isFinite)
}

const BRANCH_ISSUE_RE = /#(\d{3,5})\b|(?:^|\/)task\/?(\d{3,5})(?=[_-])|(?:^|\/)(\d{3,5})(?=[_-])/gi
const PATH_ISSUE_RE = /(?:^|\/)(\d{3,5})[-_]/g
const AGENT_ISSUE_RE = /(?:^|[/_-])(\d{3,5})_/g
const PROMPT_ISSUE_RE = /#(\d{3,5})\b/g

function sortedUnique(numbers) {
  return [...new Set(numbers)].sort((a, b) => a - b)
}

function issueNumbers(value, kind = 'branch') {
  if (typeof value !== 'string') return []
  const pattern =
    kind === 'path' ? PATH_ISSUE_RE : kind === 'agent' ? AGENT_ISSUE_RE : BRANCH_ISSUE_RE
  return [...value.matchAll(pattern)].flatMap((match) => {
    const value = match[1] ?? match[2] ?? match[0].match(/\d{3,5}/)?.[0]
    return value ? [Number(value)] : []
  })
}

function promptIssueIds(prompt) {
  if (typeof prompt !== 'string') return []
  return sortedUnique([...prompt.matchAll(PROMPT_ISSUE_RE)].map((match) => Number(match[1])))
}

function containsIssueId(value, issueIds) {
  return issueNumbers(value).some((id) => issueIds.includes(id))
}

function containsIssueReference(value, issueIds) {
  if (typeof value !== 'string') return false
  return [...value.matchAll(/#(\d+)/g)].some((match) => issueIds.includes(Number(match[1])))
}

/** Find post-merge revert/fix commits that reference a delivered PR or issue. */
export function findEscapes(deliveries, mainCommits, windowDays = 14, issues = []) {
  const windowMs = finiteNumber(windowDays) === null ? 0 : windowDays * 86_400_000
  const list = Array.isArray(deliveries) ? deliveries : []
  if (mainCommits === null || issues === null) return list.some(validDeliveryForEscape) ? null : []
  return list.flatMap((delivery) => escapesForDelivery(delivery, mainCommits, issues, windowMs))
}

function validDeliveryForEscape(delivery) {
  return (
    Number.isFinite(Date.parse(delivery?.mergedAt ?? '')) &&
    Number.isSafeInteger(Number(delivery?.number))
  )
}

function escapesForDelivery(delivery, mainCommits, issues, windowMs) {
  const mergedMs = Date.parse(delivery?.mergedAt ?? '')
  const pr = Number(delivery?.number)
  if (!Number.isFinite(mergedMs) || !Number.isSafeInteger(pr)) return []
  const issueIds = [
    pr,
    ...(Array.isArray(delivery?.issueIds) ? delivery.issueIds.map(Number) : []),
  ].filter(Number.isSafeInteger)
  const ownCommitShas = new Set(
    (Array.isArray(delivery?.commitShas) ? delivery.commitShas : []).filter(
      (sha) => typeof sha === 'string',
    ),
  )
  return [
    ...commitEscapes(mainCommits, delivery, pr, issueIds, ownCommitShas, mergedMs, windowMs),
    ...issueEscapes(issues, pr, issueIds, mergedMs, windowMs),
  ]
}

function commitEscapes(commits, delivery, pr, issueIds, ownCommitShas, mergedMs, windowMs) {
  return (Array.isArray(commits) ? commits : []).flatMap((commit) =>
    escapeFromCommit(commit, delivery, pr, issueIds, ownCommitShas, mergedMs, windowMs),
  )
}

function issueEscapes(issues, pr, issueIds, mergedMs, windowMs) {
  return (Array.isArray(issues) ? issues : []).flatMap((issue) =>
    escapeFromIssue(issue, pr, issueIds, mergedMs, windowMs),
  )
}

function escapeFromCommit(commit, delivery, pr, issueIds, ownCommitShas, mergedMs, windowMs) {
  const { dateMs, sha, subject, isRevert, isFix } = commitEscapeFields(commit)
  if (!validEscapeDate(dateMs, mergedMs, windowMs)) return []
  if (!validEscapeSha(sha, delivery, ownCommitShas)) return []
  if (!validEscapeSubject(subject, pr, isRevert, isFix)) return []
  const text = `${subject}\n${typeof commit?.body === 'string' ? commit.body : ''}`
  return containsIssueReference(text, issueIds)
    ? [
        {
          pr,
          sha,
          kind: isRevert ? 'revert' : 'fix',
          subject,
          body: typeof commit?.body === 'string' ? commit.body : '',
        },
      ]
    : []
}

function commitEscapeFields(commit) {
  const subject = typeof commit?.subject === 'string' ? commit.subject : ''
  return {
    dateMs: Date.parse(commit?.date ?? ''),
    sha: commit?.sha,
    subject,
    isRevert: /^revert\b/i.test(subject),
    isFix: /^fix(?:\([^)]*\))?:/i.test(subject),
  }
}

function validEscapeSubject(subject, pr, isRevert, isFix) {
  return (
    !new RegExp(`\\(#${pr}\\)\\s*$`).test(subject) &&
    (isRevert || isFix) &&
    !isEvidenceOnlySubject(subject)
  )
}

function escapeFromIssue(issue, pr, issueIds, mergedMs, windowMs) {
  const fields = issueEscapeFields(issue)
  if (!validEscapeDate(fields.dateMs, mergedMs, windowMs)) return []
  const text = `${fields.title}\n${fields.body}`
  return containsIssueReference(text, issueIds)
    ? [
        {
          pr,
          issue: fields.number,
          kind: 'issue',
          subject: fields.title,
          body: fields.body,
        },
      ]
    : []
}

function issueString(value) {
  return typeof value === 'string' ? value : ''
}

function issueEscapeFields(issue) {
  return {
    dateMs: Date.parse(issueString(issue?.createdAt)),
    title: issueString(issue?.title),
    body: issueString(issue?.body),
    number: issue?.number,
  }
}

function validEscapeDate(dateMs, mergedMs, windowMs) {
  return Number.isFinite(dateMs) && dateMs > mergedMs && dateMs <= mergedMs + windowMs
}

function validEscapeSha(sha, delivery, ownCommitShas) {
  return typeof sha === 'string' && !ownCommitShas.has(sha) && sha !== delivery?.mergeCommitOid
}

export function rollbackControl(escapes, controls) {
  return (
    (Array.isArray(escapes) ? escapes : [])
      .map((escape) => `${escape?.subject ?? ''}\n${escape?.body ?? ''}`)
      .flatMap((text) =>
        Array.isArray(controls)
          ? controls.filter(
              (control) =>
                typeof control?.id === 'string' &&
                typeof control?.pattern === 'string' &&
                new RegExp(control.pattern, 'i').test(text),
            )
          : [],
      )
      .map((control) => control.id)[0] ?? null
  )
}

export function issueIdsOf(pr) {
  const branchIds = issueNumbers(pr?.headRefName, 'branch')
  const closingIds = (Array.isArray(pr?.closingIssuesReferences) ? pr.closingIssuesReferences : [])
    .map((reference) => reference?.number)
    .filter((number) =>
      typeof number === 'number'
        ? Number.isSafeInteger(number)
        : typeof number === 'string' && /^\d+$/.test(number),
    )
    .map(Number)
  return sortedUnique([...branchIds, ...closingIds])
}

/** Attribute overlapping sessions through the task branch/worktree, a /ship prompt or Codex ancestry. */
export function attributeSessions(sessions, { firstCommit, mergedAt, ...pr } = {}) {
  const issueIds = issueIdsOf(pr)
  const candidates = (Array.isArray(sessions) ? sessions : []).filter((session) =>
    sessionOverlaps(session, firstCommit, mergedAt),
  )
  const attributed = []
  const attributedThreads = new Set()
  const pending = [...candidates]
  let changed = true
  while (changed) {
    changed = false
    for (let i = pending.length - 1; i >= 0; i--) {
      const meta = pending[i]
      const via = sessionAttribution(meta, issueIds, attributedThreads, mergedAt)
      if (via === null) continue
      pending.splice(i, 1)
      attributed.push({ meta, via })
      if (meta.host === 'codex' && typeof meta.threadId === 'string') {
        attributedThreads.add(meta.threadId)
      }
      changed = true
    }
  }
  const order = new Map(candidates.map((meta, index) => [meta, index]))
  return attributed.sort((a, b) => order.get(a.meta) - order.get(b.meta))
}

function sessionAttribution(meta, issueIds, attributedThreads, mergedAt) {
  const contexts = contextsBefore(meta, mergedAt)
  if (!isCoordinator(meta)) {
    if (contexts.some((context) => containsIssueId(context.gitBranch, issueIds))) return 'branch'
    if (contexts.some((context) => containsIssueId(context.cwd, issueIds))) return 'cwd'
    if (issueNumbers(meta.agentPath, 'agent').some((id) => issueIds.includes(id)))
      return 'agent-path'
    if (hasParentAttribution(meta, attributedThreads)) return 'parent'
  }
  if (hasPromptAttribution(meta, issueIds)) return 'prompt'
  return null
}

function isCoordinator(meta) {
  return (
    meta.humanMessages > 3 ||
    visitsMultipleIssues([
      { gitBranch: meta.gitBranch, cwd: meta.cwd },
      ...(Array.isArray(meta.contexts) ? meta.contexts : []),
    ])
  )
}

// Coordinator detection is clock-free: the whole session's issue context history or a chatty
// transcript signals orchestration. Dated contexts below are only for temporal location matching.
function visitsMultipleIssues(contexts) {
  // cwd uses the dedicated path pattern (a digit run right after a `/`), not the loose branch
  // regex: BRANCH_ISSUE_RE's bare-number alternative matches any 3-5 digit path segment (a dated
  // directory, a fixture path), which would disqualify a genuine writer over a coincidence.
  const ids = new Set(
    contexts.flatMap((context) => [
      ...issueNumbers(context.gitBranch, 'branch'),
      ...issueNumbers(context.cwd, 'path'),
    ]),
  )
  return ids.size > 1
}

function contextsBefore(meta, mergedAt) {
  const mergedMs = Date.parse(mergedAt ?? '')
  const dated = (Array.isArray(meta.contexts) ? meta.contexts : []).filter(
    (context) => !(Date.parse(context.ts ?? '') > mergedMs),
  )
  return [{ gitBranch: meta.gitBranch, cwd: meta.cwd }, ...dated]
}

function hasParentAttribution(meta, attributedThreads) {
  return (
    meta.host === 'codex' &&
    typeof meta.parentThreadId === 'string' &&
    attributedThreads.has(meta.parentThreadId)
  )
}

// A prompt only delivers an issue when it is the /ship command for that one issue; any other
// prompt that cites it (coordinators, reviews) counts only through the task branch or worktree.
const SHIP_PROMPT_RE =
  /^\s*(?:\/ship\b|<command-message>ship<\/command-message>\s*<command-name>\/ship<\/command-name>)/

function hasPromptAttribution(meta, issueIds) {
  return (
    meta.host === 'claude' &&
    meta.issueIdsInPrompt?.length === 1 &&
    issueIds.includes(meta.issueIdsInPrompt[0]) &&
    SHIP_PROMPT_RE.test(meta.firstPrompt ?? '')
  )
}

function overlapSeconds(session, delivery) {
  const start = Math.max(Date.parse(session.firstTs ?? ''), Date.parse(delivery.firstCommit ?? ''))
  const end = Math.min(Date.parse(session.lastTs ?? ''), Date.parse(delivery.mergedAt ?? ''))
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
}

/** Attribute each session once, preferring explicit branch/cwd/agent/parent/prompt evidence, in file order. */
export function attributeSessionsToDeliveries(sessions, deliveries) {
  const result = new Map((deliveries ?? []).map((delivery) => [delivery.number, []]))
  const state = { assigned: new Set(), threads: new Map() }
  assignDirectSessions(sessions, deliveries, result, state)
  assignParentSessions(sessions, deliveries, result, state)
  return new Map(
    [...result]
      .filter(([, entries]) => entries.length > 0)
      .map(([number, entries]) => [number, entries.sort(byFile)]),
  )
}

function byFile(a, b) {
  return a.meta.file < b.meta.file ? -1 : a.meta.file > b.meta.file ? 1 : 0
}

function assignDirectSessions(sessions, deliveries, result, state) {
  for (const { meta, matches } of (sessions ?? []).map((item) => ({
    meta: item,
    matches: deliveryMatches(item, deliveries),
  }))) {
    if (matches.length === 0) continue
    matches.sort((a, b) => compareDeliveryMatches(meta, a, b))
    const chosen = matches[0]
    result.get(chosen.delivery.number)?.push(chosen.match)
    state.assigned.add(meta)
    if (meta.host === 'codex' && typeof meta.threadId === 'string')
      state.threads.set(meta.threadId, chosen.delivery.number)
  }
}

function assignParentSessions(sessions, deliveries, result, state) {
  for (const meta of sessions ?? []) {
    if (!parentCandidate(meta, state)) continue
    const number = state.threads.get(meta.parentThreadId)
    const delivery = (deliveries ?? []).find((candidate) => candidate.number === number)
    if (!delivery || !sessionOverlaps(meta, delivery.firstCommit, delivery.mergedAt)) continue
    result.get(number)?.push({ meta, via: 'parent' })
    state.assigned.add(meta)
    if (typeof meta.threadId === 'string') state.threads.set(meta.threadId, number)
  }
}

function parentCandidate(meta, state) {
  return (
    !state.assigned.has(meta) && meta.host === 'codex' && typeof meta.parentThreadId === 'string'
  )
}

function deliveryMatches(meta, deliveries) {
  return (deliveries ?? []).flatMap((delivery) => {
    const found = attributeSessions([meta], delivery)
    return found.length > 0 ? [{ delivery, match: found[0] }] : []
  })
}

function compareDeliveryMatches(meta, a, b) {
  const rank = { branch: 0, cwd: 1, 'agent-path': 2, parent: 3, prompt: 4 }
  return (
    rank[a.match.via] - rank[b.match.via] ||
    overlapSeconds(meta, b.delivery) - overlapSeconds(meta, a.delivery) ||
    Number(a.delivery.number) - Number(b.delivery.number)
  )
}

function messageContent(event) {
  return event?.message?.content ?? event?.content
}

function shouldCountClaudeUsage(seen, event) {
  const identity =
    typeof event?.message?.id === 'string'
      ? `message:${event.message.id}`
      : typeof event?.requestId === 'string'
        ? `request:${event.requestId}`
        : null
  if (identity === null) return true
  if (seen.has(identity)) return false
  seen.add(identity)
  return true
}

function isGenuineClaudeUser(event, role) {
  if (
    !['human', 'user'].includes(role) ||
    event.isSidechain === true ||
    event.isMeta === true ||
    isToolResultMessage(event)
  )
    return false
  const content = messageContent(event)
  if (typeof content === 'string') return !isSyntheticText(content)
  const texts = textBlocks(content)
  return texts.length === 0 || texts.some((text) => !isSyntheticText(text))
}

function isToolResultMessage(event) {
  const content = messageContent(event)
  return Array.isArray(content) && content.some((block) => block?.type === 'tool_result')
}

function eventTimestamp(event) {
  return event?.timestamp ?? event?.message?.timestamp ?? event?.payload?.timestamp ?? null
}

function updateSessionTimes(times, timestamp) {
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return
  if (times.firstTs === null) times.firstTs = timestamp
  times.lastTs = timestamp
}

function commandFromCall(event, host) {
  return host === 'codex' ? codexCommand(event) : claudeCommand(event)
}

function codexCommand(event) {
  if (event?.payload?.type !== 'function_call' || event.payload.name !== 'exec_command') return null
  try {
    return JSON.parse(event.payload.arguments ?? '{}').cmd ?? null
    // FAIL-OPEN-INTENT: malformed Codex tool arguments cannot identify a KPI phase; the phase remains unknown and is never counted as zero.
  } catch {
    return null
  }
}

function claudeCommand(event) {
  const blocks = Array.isArray(event?.message?.content) ? event.message.content : []
  const block = blocks.find((candidate) => candidate?.type === 'tool_use')
  return block && ['Bash', 'Agent', 'Task'].includes(block.name)
    ? (block.input?.command ?? block.input?.cmd ?? null)
    : null
}

function callIdentity(event, host) {
  if (host === 'codex') return event?.payload?.call_id ?? null
  const blocks = Array.isArray(event?.message?.content) ? event.message.content : []
  return blocks.find((candidate) => candidate?.type === 'tool_use')?.id ?? null
}

function resultIdentity(event, host) {
  if (host === 'codex') return event?.payload?.call_id ?? null
  const blocks = Array.isArray(event?.message?.content) ? event.message.content : []
  return blocks.find((candidate) => candidate?.type === 'tool_result')?.tool_use_id ?? null
}

function executionFacts(events, host) {
  const open = new Map()
  const facts = { preflightSec: null, fullGateSec: null, fullGateRuns: 0 }
  for (const event of events) {
    if (recordExecutionStart(open, event, host)) continue
    finishExecution(facts, open, event, host)
  }
  return facts
}

function recordExecutionStart(open, event, host) {
  const command = commandFromCall(event, host)
  const id = callIdentity(event, host)
  if (!command || !id) return false
  const kind = FULL_GATE_RE.test(command)
    ? 'fullGate'
    : PREFLIGHT_RE.test(command)
      ? 'preflight'
      : null
  if (kind) open.set(id, { kind, timestamp: Date.parse(eventTimestamp(event) ?? '') })
  return true
}

function finishExecution(facts, open, event, host) {
  const started = open.get(resultIdentity(event, host))
  const end = Date.parse(eventTimestamp(event) ?? '')
  if (!started || !Number.isFinite(end) || !Number.isFinite(started.timestamp)) return
  const seconds = Math.max(0, Math.round((end - started.timestamp) / 1000))
  facts[`${started.kind}Sec`] = (facts[`${started.kind}Sec`] ?? 0) + seconds
  if (started.kind === 'fullGate') facts.fullGateRuns++
  open.delete(resultIdentity(event, host))
}

function optionalExecutionFacts(execution, reviewer) {
  if (reviewer || execution.preflightSec !== null || execution.fullGateSec !== null) {
    return { ...execution, reviewer }
  }
  return {}
}

/** Summarize Claude JSONL without counting sidechains or tool-result messages. */
export function claudeSessionMeta(lines) {
  const state = {
    gitBranch: null,
    cwd: null,
    contexts: [],
    effort: null,
    humanMessages: 0,
    hasHumanMessage: false,
    input: null,
    output: null,
    cache: null,
    seenUsage: new Set(),
    firstPrompt: null,
    issueIdsInPrompt: [],
  }
  const times = { firstTs: null, lastTs: null }
  for (const line of Array.isArray(lines) ? lines : []) {
    const event = parseSessionLine(line)
    if (event === null) continue
    updateSessionTimes(times, eventTimestamp(event))
    consumeClaudeMeta(state, event)
  }
  const events = (Array.isArray(lines) ? lines : [])
    .map(parseSessionLine)
    .filter((event) => event !== null)
  const execution = executionFacts(events, 'claude')
  return {
    gitBranch: state.gitBranch,
    cwd: state.cwd,
    contexts: state.contexts,
    firstTs: times.firstTs,
    lastTs: times.lastTs,
    usage: { input: state.input, output: state.output, cache: state.cache },
    humanMessages: state.hasHumanMessage ? state.humanMessages : null,
    effort: state.effort,
    firstPrompt: state.firstPrompt,
    issueIdsInPrompt: state.issueIdsInPrompt,
    ...optionalExecutionFacts(
      execution,
      REVIEWER_RE.test(`${state.firstPrompt ?? ''} ${state.gitBranch ?? ''}`),
    ),
  }
}

function consumeClaudeMeta(state, event) {
  updateClaudeContext(state, event)
  const role = event.message?.role ?? event.type
  consumeClaudeUser(state, event, role)
  if (role !== 'assistant') return
  const usage = event.message?.usage ?? event.usage
  if (!usage || !shouldCountClaudeUsage(state.seenUsage, event)) return
  updateClaudeUsage(state, usage)
}

function updateClaudeContext(state, event) {
  if (state.gitBranch === null && typeof event.gitBranch === 'string')
    state.gitBranch = event.gitBranch
  if (state.cwd === null && typeof event.cwd === 'string') state.cwd = event.cwd
  addContext(state.contexts, event)
  if (typeof event.effort === 'string') state.effort = event.effort
}

// A session can resume elsewhere (main, then the task branch/worktree): keep every place it worked,
// dated by when it first worked there, so a later visit cannot claim an earlier delivery.
function addContext(contexts, event) {
  const gitBranch = typeof event.gitBranch === 'string' ? event.gitBranch : null
  const cwd = typeof event.cwd === 'string' ? event.cwd : null
  if (gitBranch === null && cwd === null) return
  if (contexts.some((known) => known.gitBranch === gitBranch && known.cwd === cwd)) return
  contexts.push({ gitBranch, cwd, ts: eventTimestamp(event) })
}

const isSyntheticText = (text) =>
  NON_HUMAN_PROMPT_PREFIXES.some((prefix) => text.startsWith(prefix))

function textBlocks(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
}

/** Text a human typed: a plain string, or the non-synthetic text blocks of a content array. */
function promptText(content) {
  if (typeof content === 'string') return content
  return textBlocks(content)
    .filter((text) => !isSyntheticText(text))
    .join('\n')
}

// The FIRST genuine prompt is the delivery evidence: ids come from all of it, only the stored text is cut.
function recordHumanPrompt(state, event) {
  state.humanMessages++
  state.hasHumanMessage = true
  if (state.humanMessages !== 1) return
  const text = promptText(messageContent(event))
  state.firstPrompt = text.slice(0, 400)
  state.issueIdsInPrompt = promptIssueIds(text)
}

function updateClaudeUsage(state, usage) {
  state.input = addMetric(state.input, usageValue(usage, 'input_tokens', 'inputTokens'))
  state.output = addMetric(state.output, usageValue(usage, 'output_tokens', 'outputTokens'))
  state.cache = addMetric(
    state.cache,
    usageValue(usage, 'cache_read_input_tokens', 'cacheReadInputTokens'),
  )
  state.cache = addMetric(
    state.cache,
    usageValue(usage, 'cache_creation_input_tokens', 'cacheCreationInputTokens'),
  )
}

function consumeClaudeUser(state, event, role) {
  if (isGenuineClaudeUser(event, role)) recordHumanPrompt(state, event)
}

/** Summarize Codex rollout JSONL using its latest context and token snapshot. */
export function codexSessionMeta(lines) {
  const state = {
    cwd: null,
    agentPath: null,
    threadId: null,
    parentThreadId: null,
    model: null,
    effort: null,
    usage: { input: null, output: null, cache: null },
  }
  const times = { firstTs: null, lastTs: null }
  for (const line of Array.isArray(lines) ? lines : []) {
    const event = parseSessionLine(line)
    if (event === null) continue
    updateSessionTimes(times, eventTimestamp(event))
    consumeCodexMeta(state, event)
  }
  const events = (Array.isArray(lines) ? lines : [])
    .map(parseSessionLine)
    .filter((event) => event !== null)
  const execution = executionFacts(events, 'codex')
  return {
    cwd: state.cwd,
    firstTs: times.firstTs,
    lastTs: times.lastTs,
    model: state.model,
    effort: state.effort,
    agentPath: state.agentPath,
    threadId: state.threadId,
    parentThreadId: state.parentThreadId,
    usage: state.usage,
    ...optionalExecutionFacts(execution, REVIEWER_RE.test(`${state.agentPath ?? ''}`)),
  }
}

function consumeCodexMeta(state, event) {
  const payload = event.payload ?? {}
  const spawn = payload.source?.subagent?.thread_spawn
  assignCodexIdentity(state, payload, spawn, event)
  updateCodexContext(state, payload, event)
  updateCodexUsage(state, payload.info?.total_token_usage)
}

function assignCodexIdentity(state, payload, spawn, event) {
  setMissing(state, 'cwd', payload.cwd ?? event.cwd)
  setMissing(state, 'agentPath', spawn?.agent_path ?? payload.agent_path ?? event.agent_path)
  setMissing(state, 'threadId', payload.id ?? payload.thread_id ?? event.thread_id)
  setMissing(
    state,
    'parentThreadId',
    payload.parent_thread_id ?? spawn?.parent_thread_id ?? event.parent_thread_id,
  )
}

function setMissing(state, key, value) {
  if (state[key] === null && typeof value === 'string') state[key] = value
}

function updateCodexContext(state, payload, event) {
  if (event.type !== 'turn_context') return
  if (typeof payload.model === 'string') state.model = payload.model
  const nextEffort = payload.reasoning_effort ?? payload.effort
  if (typeof nextEffort === 'string') state.effort = nextEffort
}

function updateCodexUsage(state, total) {
  if (!total || typeof total !== 'object') return
  state.usage = {
    input: freshInput(total),
    output: usageValue(total, 'output_tokens', 'outputTokens'),
    cache: usageValue(
      total,
      'cached_input_tokens',
      'cache_read_input_tokens',
      'cacheReadInputTokens',
    ),
  }
}

function sumNullable(values) {
  const present = values.map(finiteNumber).filter((value) => value !== null)
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null
}

function sessionSeconds(session) {
  const first = Date.parse(session?.firstTs ?? '')
  const last = Date.parse(session?.lastTs ?? '')
  return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, (last - first) / 1000) : null
}

function sourceMetric(row, sessions, key) {
  const measured = sumNullable(sessions.map((session) => session?.[key]))
  return measured ?? row?.[key] ?? null
}

/** Merge CI and attributed session measurements, preserving zeroes and unknown nulls. */
export function mergeDeliverySources(row, { ci, sessions, redCiRuns, reworkSec, weights } = {}) {
  const attributed = Array.isArray(sessions) ? sessions : []
  const { writerSessions, reviewerSessions } = splitSessionRoles(attributed)
  const phases = deliveryPhases(row, ci, attributed, reviewerSessions, reworkSec)
  return {
    ...row,
    tokens: sessionTokens(row, attributed),
    humanMessages: sourceMetric(row, attributed, 'humanMessages'),
    rounds: sourceMetric(row, attributed, 'rounds'),
    fullGateRuns: sourceMetric(row, attributed, 'fullGateRuns'),
    subagentCostUnits: sourceMetric(row, attributed, 'subagentCostUnits'),
    redCiRuns: redCiValue(row, ci, redCiRuns),
    leadTimeSplit: phases.leadTimeSplit,
    ceremony: row?.ceremony ?? {
      evidenceOnlyCommits: row?.evidenceOnlyCommits ?? null,
      hookBlocks: row?.hookBlocks ?? null,
    },
    writerCostUnits: sessionCost(writerSessions, weights),
    reviewerCostUnits: sessionCost(reviewerSessions, weights),
    writerTimeSec: phases.writerTimeSec,
    models: sessionModels(row, attributed),
    sourcesKnown: knownSources(attributed, ci, redCiRuns),
  }
}

function sessionTokens(row, sessions) {
  const tokenMaps = sessions.map((session) => session?.usage).filter(Boolean)
  if (tokenMaps.length === 0) return row?.tokens ?? null
  return {
    input: sumNullable(tokenMaps.map((usage) => usage.input)),
    output: sumNullable(tokenMaps.map((usage) => usage.output)),
    cache: sumNullable(tokenMaps.map((usage) => usage.cache)),
  }
}

function splitSessionRoles(sessions) {
  return {
    writerSessions: sessions.filter((session) => session?.reviewer !== true),
    reviewerSessions: sessions.filter((session) => session?.reviewer === true),
  }
}

function sessionCost(sessions, weights) {
  return weights ? sumNullable(sessions.map((session) => costUnits(session?.usage, weights))) : null
}

function deliveryPhases(row, ci, attributed, reviewerSessions, reworkSec) {
  const preflight = sumNullable(attributed.map((session) => session?.preflightSec))
  const fullGate = sumNullable(attributed.map((session) => session?.fullGateSec))
  const writerSessions = attributed.filter((session) => session?.reviewer !== true)
  let writerTimeSec = sumNullable(writerSessions.map(sessionNetSeconds))
  let review = sumNullable(reviewerSessions.map(sessionNetSeconds))
  const rework = reworkSec ?? row?.reworkSec
  const sessionPhasesFit = phasesFitLeadTime(row, ci, {
    preflight,
    fullGate,
    writerTimeSec,
    review,
    rework,
  })
  if (!sessionPhasesFit) {
    writerTimeSec = null
    review = null
  }
  const leadTimeSplit = { ...(row?.leadTimeSplit ?? {}) }
  addCiPhases(leadTimeSplit, ci)
  addKnownPhases(leadTimeSplit, { preflight, fullGate, review, work: writerTimeSec })
  if (!sessionPhasesFit) Object.assign(leadTimeSplit, { work: null, review: null })
  if (finiteNumber(rework) !== null) leadTimeSplit.rework = rework
  return { leadTimeSplit, writerTimeSec }
}

function phasesFitLeadTime(row, ci, phases) {
  const leadTime = finiteNumber(row?.leadTimeHours)
  if (leadTime === null) return false
  const total = [
    phases.preflight,
    phases.fullGate,
    phases.writerTimeSec,
    phases.review,
    phases.rework,
    ci?.ciWaitSec,
    ci?.ciRunSec,
  ]
    .map(finiteNumber)
    .reduce((sum, value) => sum + (value ?? 0), 0)
  return total <= leadTime * 3600
}

function sessionNetSeconds(session) {
  const duration = sessionSeconds(session)
  if (duration === null) return null
  const gates = [session?.preflightSec, session?.fullGateSec]
    .map(finiteNumber)
    .reduce((sum, value) => sum + (value ?? 0), 0)
  return Math.max(0, duration - gates)
}

function addCiPhases(split, ci) {
  if (finiteNumber(ci?.ciWaitSec) !== null) split.ciWait = ci.ciWaitSec
  if (finiteNumber(ci?.ciRunSec) !== null)
    Object.assign(split, { ciRun: ci.ciRunSec, verify: ci.ciRunSec })
}

function addKnownPhases(split, phases) {
  for (const [kind, value] of Object.entries(phases)) if (value !== null) split[kind] = value
}

function redCiValue(row, ci, redCiRuns) {
  if (finiteNumber(redCiRuns) !== null) return redCiRuns
  if (finiteNumber(ci?.redCiRuns) !== null) return ci.redCiRuns
  return row?.redCiRuns ?? null
}

function sessionModels(row, sessions) {
  const models = [
    ...(Array.isArray(row?.models) ? row.models : []),
    ...sessions
      .filter((session) => typeof session?.model === 'string')
      .map((session) => `${session.model}${session.effort ? `@${session.effort}` : ''}`),
  ]
  return [...new Set(models)]
}

function knownSources(sessions, ci, redCiRuns) {
  const sources = []
  if (
    [ci?.ciWaitSec, ci?.ciRunSec, ci?.redCiRuns, redCiRuns].some(
      (value) => finiteNumber(value) !== null,
    )
  )
    sources.push('ci')
  if (sessions.some((session) => session?.host === 'claude')) sources.push('claude')
  if (sessions.some((session) => session?.host === 'codex')) sources.push('codex')
  return sources
}

export function unattributedUsage(metas, attributedFiles) {
  const result = { claude: null, codex: null, sessions: null }
  const isAttributed = (file) =>
    attributedFiles instanceof Set
      ? attributedFiles.has(file)
      : attributedFiles?.includes?.(file) === true
  for (const meta of Array.isArray(metas) ? metas : []) addUnattributed(result, meta, isAttributed)
  return result
}

function addUnattributed(result, meta, isAttributed) {
  if (isAttributed(meta?.file) || !['claude', 'codex'].includes(meta?.host)) return
  const tokens = tokenTotal(meta?.usage)
  if (tokens !== null) result[meta.host] = (result[meta.host] ?? 0) + tokens
  result.sessions = (result.sessions ?? 0) + 1
}

const CALIBRATION_WINDOW = 30

function calibrationMinimum(value) {
  const configured = value && typeof value === 'object' ? value.minCalibration : value
  return finiteNumber(configured) ?? DEFAULT_MIN_CALIBRATION
}

function calibrationMetric(deliveries, valueOf, minCalibration) {
  const known = deliveries
    .filter((delivery) => finiteNumber(valueOf(delivery)) !== null)
    .slice(0, CALIBRATION_WINDOW)
  const values = known.map(valueOf)
  const medianValue = quantiles(values).median
  return {
    value: known.length >= minCalibration && medianValue !== null ? rounded(medianValue, 2) : null,
    calibration: {
      n: known.length,
      range: {
        from: known[0]?.mergedAt ?? null,
        to: known.at(-1)?.mergedAt ?? null,
      },
    },
  }
}

/** Build per-stratum writer references from the oldest known deliveries per quantity. */
export function calibrate(deliveries, _weights, minCalibration) {
  const minimum = calibrationMinimum(minCalibration)
  const groups = {}
  for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
    if (
      typeof delivery?.stratum !== 'string' ||
      delivery.stratum === '' ||
      mergedAtMs(delivery) === null
    )
      continue
    ;(groups[delivery.stratum] ??= []).push(delivery)
  }
  return Object.fromEntries(
    Object.entries(groups).map(([stratum, all]) => {
      const group = [...all].sort(
        (a, b) => mergedAtMs(a) - mergedAtMs(b) || Number(a.number ?? 0) - Number(b.number ?? 0),
      )
      const writerTime = calibrationMetric(group, writerTimeReference, minimum)
      const writerCost = calibrationMetric(group, (delivery) => delivery.writerCostUnits, minimum)
      const reviewTime = calibrationMetric(group, (delivery) => delivery.review, minimum)
      const reviewCost = calibrationMetric(group, (delivery) => delivery.reviewerCostUnits, minimum)
      return [
        stratum,
        {
          writerTimeMedianSec: writerTime.value,
          writerCostUnitsMedian: writerCost.value,
          buckets: {
            writer: {
              timeMedianSec: writerTime.value,
              costUnitsMedian: writerCost.value,
            },
            review: {
              timeMedianSec: reviewTime.value,
              costUnitsMedian: reviewCost.value,
            },
          },
          calibration: {
            writerTimeMedianSec: writerTime.calibration,
            writerCostUnitsMedian: writerCost.calibration,
            buckets: {
              writer: {
                timeMedianSec: writerTime.calibration,
                costUnitsMedian: writerCost.calibration,
              },
              review: {
                timeMedianSec: reviewTime.calibration,
                costUnitsMedian: reviewCost.calibration,
              },
            },
          },
          n: Math.min(group.length, CALIBRATION_WINDOW),
        },
      ]
    }),
  )
}

function writerTimeReference(delivery) {
  return finiteNumber(delivery?.writerTimeSec)
}

function indexValues(checkpoint) {
  return ['time', 'tokens'].flatMap((kind) => {
    const index = checkpoint?.indices?.[kind]
    return [index?.median, index?.p90]
  })
}

function checkpointWithin(checkpoint, limit, minimumN = 0, minimumMeasured = 0) {
  if (!checkpointHasCoverage(checkpoint, minimumN, minimumMeasured)) return false
  const values = indexValues(checkpoint).map(finiteNumber)
  return values.length === 4 && values.every((value) => value !== null && value <= limit)
}

function meetsMinimum(value, minimum) {
  if (minimum === 0) return true
  return (finiteNumber(value) ?? 0) >= minimum
}

function checkpointHasCoverage(checkpoint, minimumN, minimumMeasured) {
  return (
    meetsMinimum(checkpoint?.n, minimumN) &&
    meetsMinimum(checkpoint?.measured?.time, minimumMeasured) &&
    meetsMinimum(checkpoint?.measured?.tokens, minimumMeasured)
  )
}

function tuningBucket(current, baseline, threshold) {
  return (
    Object.keys(current?.buckets ?? {}).find((name) =>
      bucketExceedsForName(current, baseline, name, threshold),
    ) ?? null
  )
}

function bucketExceedsForName(current, baseline, name, threshold) {
  const currentBucket = current.buckets[name]
  const baseBucket = baseline?.buckets?.[name]
  return bucketExceeds(
    finiteNumber(currentBucket?.time),
    finiteNumber(currentBucket?.tokens),
    finiteNumber(baseBucket?.timeMedianSec),
    finiteNumber(baseBucket?.costUnitsMedian),
    threshold,
  )
}

function bucketExceeds(time, tokens, baseTime, baseTokens, threshold) {
  return [ratio(time, baseTime), ratio(tokens, baseTokens)].some(
    (value) => value !== null && value > threshold,
  )
}

function ineffectiveTuneCount(history) {
  const entries = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.stratum === history?.currentStratum)
    .slice(-2)
  if (entries.length < 2) return false
  const [first, last] = entries
  return sameTune(first, last)
}

function sameTune(first, last) {
  return (
    typeof first?.verdict === 'string' &&
    typeof last?.verdict === 'string' &&
    first.verdict === last.verdict &&
    first.verdict.startsWith('TUNE ') &&
    finiteNumber(last.bucketExcess) !== null &&
    last.bucketExcess >= 2
  )
}

function exceedsRethink(current, thresholds) {
  const medianLimit = thresholds.rethinkMedian
  const p90Limit = thresholds.rethinkP90
  return ['time', 'tokens'].some((kind) => {
    const index = current?.indices?.[kind]
    return (
      (finiteNumber(index?.median) ?? -Infinity) > medianLimit ||
      (finiteNumber(index?.p90) ?? -Infinity) > p90Limit
    )
  })
}

/** Classify a checkpoint, keeping hard escape signals ahead of tuning advice. */
export function checkpointVerdict({ current, previous, baseline, thresholds, history }) {
  const limits = thresholds ?? {}
  const hard = hardCheckpointVerdict(current, limits)
  if (hard !== null) return hard
  const sameStratumHistory = historyForStratum(history, current)
  return softCheckpointVerdict(current, previous, baseline, limits, sameStratumHistory)
}

function historyForStratum(history, current) {
  return (Array.isArray(history) ? history : []).filter(
    (entry) => entry?.stratum === current?.stratum,
  )
}

function softCheckpointVerdict(current, previous, baseline, limits, history) {
  if (rethinkNeeded(current, limits, history)) return 'RETHINK'
  const bucket = tuningBucket(current, baseline, limits.tune)
  if (bucket !== null) return `TUNE ${current?.topBucket ?? bucket}`
  const loggedPrevious = history.at(-1) ?? previous
  return plateauReached(current, loggedPrevious, limits) ? 'PLATEAU' : 'HOLD'
}

function rethinkNeeded(current, limits, history) {
  return (
    exceedsRethink(current, limits) &&
    ineffectiveTuneCount(Object.assign(history, { currentStratum: current?.stratum }))
  )
}
function plateauReached(current, previous, limits) {
  return (
    checkpointWithin(current, limits.plateau) &&
    checkpointWithin(
      previous,
      limits.plateau,
      finiteNumber(limits.n) ?? 0,
      finiteNumber(limits.minMeasured) ?? 0,
    )
  )
}

function hardCheckpointVerdict(current, limits) {
  return (
    rollbackVerdict(current) ??
    escapeVerdict(current) ??
    andonVerdict(current) ??
    (missingCheckpointData(current, limits) ? 'NO DATA' : null)
  )
}

function rollbackVerdict(current) {
  return typeof current?.rollback === 'string' && current.rollback.length > 0 ? 'ROLLBACK' : null
}
function escapeVerdict(current) {
  return current?.escapes === null ? 'HOLD' : null
}
function andonVerdict(current) {
  return current?.escapes?.length > 0 || current?.andon === true ? 'ANDON' : null
}

function missingCheckpointData(current, limits) {
  return belowCheckpointMinimum(current, limits) || missingCheckpointMedian(current)
}

function belowCheckpointMinimum(current, limits) {
  const minimum = finiteNumber(limits.n) ?? Infinity
  const measured = finiteNumber(limits.minMeasured) ?? Infinity
  return belowN(current, minimum) || belowMeasured(current, measured)
}

function belowN(current, minimum) {
  return (finiteNumber(current?.n) ?? 0) < minimum
}
function belowMeasured(current, measured) {
  return (
    (finiteNumber(current?.measured?.time) ?? 0) < measured ||
    (finiteNumber(current?.measured?.tokens) ?? 0) < measured
  )
}

function missingCheckpointMedian(current) {
  return ['time', 'tokens'].some((kind) => finiteNumber(current?.indices?.[kind]?.median) === null)
}

/** Render one deterministic markdown checkpoint entry for the tuning log. */
function roundDeep(value) {
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : value
  if (Array.isArray(value)) return value.map(roundDeep)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)]))
  return value
}

export function formatLogEntry(result) {
  const time = result?.indices?.time ?? { median: null, p90: null }
  const tokens = result?.indices?.tokens ?? { median: null, p90: null }
  const lines = logHeader(result, time, tokens)
  lines.push(`- escape window open: ${result?.escapeWindowOpen ?? 0}`)
  appendOffenders(lines, result)
  lines.push(`- escapes: ${formatEscapes(result)}`)
  lines.push('', `<!-- shipKpiCheckpoint ${JSON.stringify(roundDeep(result))} -->`, '')
  return lines.join('\n')
}

function logHeader(result, time, tokens) {
  return [...logIdentity(result), ...logMeasures(result, time, tokens)]
}

function logIdentity(result) {
  return [
    '',
    `### Ship checkpoint — ${display(result?.date)}`,
    '',
    `- stratum: ${display(result?.stratum)}`,
    `- Window: ${display(result?.window?.since)} → ${display(result?.window?.until)}`,
    `- n: ${display(result?.n)}`,
  ]
}

function logMeasures(result, time, tokens) {
  return [
    `- measured: time=${display(result?.measured?.time)}/${display(result?.n)}, tokens=${display(result?.measured?.tokens)}/${display(result?.n)}`,
    `- time: median=${formatMetric(time.median)}, p90=${formatMetric(time.p90)}`,
    `- tokens: median=${formatMetric(tokens.median)}, p90=${formatMetric(tokens.p90)}`,
    `- top bucket: ${display(result?.topBucket)}`,
    `- top bucket excess: ${formatMetric(result?.bucketExcess)}`,
    `- verdict: ${display(result?.verdict)}`,
  ]
}

function appendOffenders(lines, result) {
  if (!['ANDON', 'ROLLBACK'].includes(result?.verdict)) return
  const offenders = (Array.isArray(result?.offenders) ? result.offenders : [])
    .filter((offender) => offender?.number !== null && offender?.number !== undefined)
    .sort(
      (a, b) =>
        Math.max(b.time ?? -Infinity, b.tokens ?? -Infinity) -
        Math.max(a.time ?? -Infinity, a.tokens ?? -Infinity),
    )
    .slice(0, 5)
    .map(
      (offender) =>
        `#${offender.number} overhead_time=${formatMetric(offender.time)} overhead_tokens=${formatMetric(offender.tokens)}`,
    )
  lines.push(`- offenders: ${offenders.length > 0 ? offenders.join('; ') : 'none'}`)
}

function formatEscapes(result) {
  if (result?.escapes === null) return 'NO DATA'
  const escapes = Array.isArray(result?.escapes) ? result.escapes : []
  return escapes.length === 0 ? 'none' : escapes.map(formatEscape).join('; ')
}

function formatEscape(escape) {
  const subject = String(escape.subject).slice(0, 80)
  return escape.kind === 'issue'
    ? `#${escape.pr} ← issue #${escape.issue}: ${subject}`
    : `#${escape.pr} ← ${String(escape.sha).slice(0, 7)} ${escape.kind}: ${subject}`
}

/** Open PR older than `staleHours` whose rollup is not `classify()`-green. */
export function isStaleOpenPr(pr, nowMs, staleHours = 2) {
  const ageHours = (nowMs - new Date(pr.createdAt).getTime()) / 3_600_000
  if (ageHours <= staleHours) return false
  return classify(pr.statusCheckRollup ?? []) !== 'green'
}

/** @param {{subject:string, touchedOnlyEvidencePaths?: boolean}[]} commits */
export function classifyPrCommits(commits) {
  const list = Array.isArray(commits) ? commits : []
  const subjects = list.map((c) => c.subject)
  const evidenceOnlyCount = list.filter((c) =>
    isEvidenceOnlyCommit(c.subject, c.touchedOnlyEvidencePaths),
  ).length
  return { evidenceOnlyCount, reviewLoopCount: countReviewLoopCommits(subjects) }
}

/** @param {{number:number, mergedAt:string, additions?:number, deletions?:number, statusCheckRollup?: unknown[]}} pr */
export function buildPrRow(pr, commits) {
  const list = Array.isArray(commits) ? commits : null
  const { evidenceOnlyCount, reviewLoopCount } = classifyPrCommits(list)
  const firstCommit = list?.[0]?.authoredDate
  return buildPrRowValues(pr, list, evidenceOnlyCount, reviewLoopCount, firstCommit)
}

function buildPrRowValues(pr, list, evidenceOnlyCount, reviewLoopCount, firstCommit) {
  return {
    number: pr.number,
    mergedAt: pr.mergedAt ?? null,
    commits: list === null ? null : list.length,
    evidenceOnlyCommits: list === null ? null : evidenceOnlyCount,
    reviewLoopCommits: list === null ? null : reviewLoopCount,
    leadTimeHours: firstCommit && pr.mergedAt ? leadTimeHours(firstCommit, pr.mergedAt) : null,
    ciRedAtOpen: Array.isArray(pr.statusCheckRollup)
      ? hasFailureConclusion(pr.statusCheckRollup)
      : null,
    additions: finiteNumber(pr.additions),
    deletions: finiteNumber(pr.deletions),
    issueIds: issueIdsOf(pr),
    commitShas: list?.map((commit) => commit.oid ?? commit.sha).filter(Boolean) ?? null,
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
  const measured = (key) =>
    rows.map((row) => finiteNumber(row[key])).filter((value) => value !== null)
  const commits = measured('commits')
  const evidenceOnly = measured('evidenceOnlyCommits')
  const reviewLoop = measured('reviewLoopCommits')
  const totalCommits = commits.reduce((sum, value) => sum + value, 0)
  const totalEvidenceOnly = evidenceOnly.reduce((sum, value) => sum + value, 0)
  const totalReviewLoop = reviewLoop.reduce((sum, value) => sum + value, 0)
  const staleOpenPrs = openPrs.filter((pr) => isStaleOpenPr(pr, nowMs))
  const mainEvidenceOnly = mainSubjects.filter(isEvidenceOnlySubject).length
  return {
    prsMerged: rows.length,
    issuesClosed: issuesClosedCount,
    issuesPer24h:
      windowHours > 0 ? Math.round((issuesClosedCount / windowHours) * 24 * 10) / 10 : 0,
    medianCommitsPerPr: median(commits),
    medianLeadTimeHours: median(measured('leadTimeHours')),
    pctEvidenceOnlyCommits: pct(totalEvidenceOnly, totalCommits),
    pctReviewLoopCommits: pct(totalReviewLoop, totalCommits),
    openPrsStale: staleOpenPrs.map((pr) => pr.number),
    pctMainEvidenceOnlyCommits: pct(mainEvidenceOnly, mainSubjects.length),
  }
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

export const PR_DETAIL_FIELDS = [
  'commits',
  'createdAt',
  'mergedAt',
  'mergeCommit',
  'headRefName',
  'closingIssuesReferences',
  'additions',
  'deletions',
  'statusCheckRollup',
  'labels',
]

/** gh exposes the merge commit as an object; the rest of the tool reads a flat oid. */
export function normalizePrDetail(detail) {
  if (detail === null || typeof detail !== 'object') return null
  return { ...detail, mergeCommitOid: detail.mergeCommit?.oid ?? null }
}

function fetchPrDetail(repo, number) {
  return normalizePrDetail(
    ghJsonOrThrow(
      ['pr', 'view', String(number), '--json', PR_DETAIL_FIELDS.join(','), ...repoArgs(repo)],
      `gh pr view #${number}`,
    ),
  )
}

function fetchCheckRunHistory(repo, commits) {
  if (typeof repo !== 'string' || !Array.isArray(commits)) return null
  const results = []
  try {
    for (const commit of commits) results.push(fetchCommitChecks(repo, commit))
    return results
  } catch (error) {
    // FAIL-OPEN-INTENT: check-run history is optional external evidence; surface its failure and return null so redCiRuns stays NO DATA.
    process.stderr.write(`ship-kpi: check-run history unavailable: ${error?.message ?? error}\n`)
    return null
  }
}

function fetchCommitChecks(repo, commit) {
  const sha = commit.oid ?? commit.sha
  const data = ghJsonOrThrow(
    ['api', `repos/${repo}/commits/${sha}/check-runs`, '--paginate'],
    `gh api check-runs ${sha}`,
  )
  return { sha, checkRuns: data?.check_runs ?? data }
}

export function fetchEscapeIssues(repo, deliveries) {
  if (typeof repo !== 'string') return null
  const issues = []
  try {
    for (const delivery of deliveries) {
      const data = ghJsonOrThrow(
        [
          'issue',
          'list',
          '--search',
          `"#${delivery.number} in:body,title created:>${delivery.mergedAt}"`,
          '--state',
          'all',
          '--json',
          'number,title,body,createdAt',
          '--limit',
          '100',
          ...repoArgs(repo),
        ],
        `gh issue list escapes #${delivery.number}`,
      )
      issues.push(...data)
    }
    return issues
  } catch (error) {
    // FAIL-OPEN-INTENT: issue search is escape evidence; surface failure and return null so no checkpoint claims a clean escape window.
    process.stderr.write(`ship-kpi: issue escape search unavailable: ${error?.message ?? error}\n`)
    return null
  }
}

export function reviewReworkSeconds(commits) {
  const dates = (Array.isArray(commits) ? commits : [])
    .filter((commit) => isReviewLoopSubject(commit.subject))
    .map((commit) => Date.parse(commit.authoredDate ?? ''))
    .filter(Number.isFinite)
  if (dates.length < 2) return null
  return Math.round((Math.max(...dates) - Math.min(...dates)) / 1000)
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

function collectFiles(dir, predicate, maxDepth, depth = 0) {
  if (!existsSync(dir) || depth > maxDepth) return []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
    // FAIL-OPEN-INTENT: an unreadable session directory contributes no delivery metrics; unavailable source is represented as null by the caller.
  } catch {
    return []
  }
  return entries.flatMap((entry) => collectEntry(dir, entry, predicate, maxDepth, depth))
}

function collectEntry(dir, entry, predicate, maxDepth, depth) {
  const full = join(dir, entry.name)
  if (entry.isFile() && predicate(entry.name)) return [full]
  if (entry.isDirectory() && !entry.name.includes('observer-sessions') && depth < maxDepth)
    return collectFiles(full, predicate, maxDepth, depth + 1)
  return []
}

function sessionFiles(dir, host, sinceMs) {
  const maxDepth = host === 'claude' ? 1 : Number.POSITIVE_INFINITY
  const predicate =
    host === 'claude'
      ? (name) => name.endsWith('.jsonl')
      : (name) => /^rollout-.*\.jsonl$/.test(name)
  return collectFiles(dir, predicate, maxDepth)
    .sort()
    .filter((file) => {
      try {
        const mtimeMs = statSync(file).mtimeMs
        return mtimeMs >= sinceMs
        // FAIL-OPEN-INTENT: an unstatable session log contributes no delivery metrics; unavailable source is represented as null by the caller.
      } catch {
        return false
      }
    })
}

function newSessionAccumulator(host, file) {
  return {
    host,
    file,
    gitBranch: null,
    cwd: null,
    contexts: [],
    agentPath: null,
    threadId: null,
    parentThreadId: null,
    model: null,
    effort: null,
    firstPrompt: null,
    issueIdsInPrompt: [],
    humanMessages: 0,
    hasHumanMessage: false,
    usage: { input: null, output: null, cache: null },
    subagentCostUnits: null,
    seenUsage: new Set(),
    times: { firstTs: null, lastTs: null },
    execution: { preflightSec: null, fullGateSec: null, fullGateRuns: 0 },
    openCalls: new Map(),
    hookBlocks: {},
  }
}

function consumeExecution(accumulator, event) {
  if (recordAccumulatorStart(accumulator, event)) return
  finishAccumulatorExecution(accumulator, event)
}

function recordAccumulatorStart(accumulator, event) {
  const command = commandFromCall(event, accumulator.host)
  const id = callIdentity(event, accumulator.host)
  if (!command || !id) return false
  const kind = FULL_GATE_RE.test(command)
    ? 'fullGate'
    : PREFLIGHT_RE.test(command)
      ? 'preflight'
      : null
  if (kind)
    accumulator.openCalls.set(id, { kind, timestamp: Date.parse(eventTimestamp(event) ?? '') })
  return true
}

function finishAccumulatorExecution(accumulator, event) {
  const resultId = resultIdentity(event, accumulator.host)
  const started = accumulator.openCalls.get(resultId)
  const end = Date.parse(eventTimestamp(event) ?? '')
  if (!started || !Number.isFinite(end) || !Number.isFinite(started.timestamp)) return
  const seconds = Math.max(0, Math.round((end - started.timestamp) / 1000))
  accumulator.execution[`${started.kind}Sec`] =
    (accumulator.execution[`${started.kind}Sec`] ?? 0) + seconds
  if (started.kind === 'fullGate') accumulator.execution.fullGateRuns++
  accumulator.openCalls.delete(resultId)
}

function consumeSessionLine(accumulator, line) {
  const event = parseSessionLine(line)
  if (event === null) return
  updateSessionTimes(accumulator.times, eventTimestamp(event))
  consumeExecution(accumulator, event)
  updateAccumulatorUsage(accumulator, event)
  if (accumulator.host === 'claude') consumeClaudeAccumulator(accumulator, event)
  else consumeCodexAccumulator(accumulator, event)
  updateHookBlocks(accumulator, line)
}

function updateAccumulatorUsage(accumulator, event) {
  const usage = event.message?.usage ?? event.usage
  if (
    !usage ||
    (accumulator.host === 'claude' && !shouldCountClaudeUsage(accumulator.seenUsage, event))
  )
    return
  accumulator.usage.input = addMetric(
    accumulator.usage.input,
    usageValue(usage, 'input_tokens', 'inputTokens'),
  )
  accumulator.usage.output = addMetric(
    accumulator.usage.output,
    usageValue(usage, 'output_tokens', 'outputTokens'),
  )
  accumulator.usage.cache = addMetric(
    accumulator.usage.cache,
    usageValue(usage, 'cache_read_input_tokens', 'cacheReadInputTokens') ??
      usageValue(usage, 'cached_input_tokens'),
  )
  accumulator.usage.cache = addMetric(
    accumulator.usage.cache,
    usageValue(usage, 'cache_creation_input_tokens', 'cacheCreationInputTokens'),
  )
}

function addUsage(target, source) {
  for (const key of ['input', 'output', 'cache']) target[key] = addMetric(target[key], source[key])
}

function consumeClaudeAccumulator(accumulator, event) {
  updateClaudeContext(accumulator, event)
  const role = event.message?.role ?? event.type
  if (isGenuineClaudeUser(event, role)) recordHumanPrompt(accumulator, event)
}

function consumeCodexAccumulator(accumulator, event) {
  const payload = event.payload ?? {}
  const spawn = payload.source?.subagent?.thread_spawn
  assignCodexIdentity(accumulator, payload, spawn, event)
  updateCodexContext(accumulator, payload, event)
  updateCodexUsage(accumulator, payload.info?.total_token_usage)
}

function updateHookBlocks(accumulator, line) {
  for (const match of line.matchAll(HOOK_BLOCK_RE))
    accumulator.hookBlocks[match[1]] = (accumulator.hookBlocks[match[1]] ?? 0) + 1
}

function freshInput(total) {
  const input = usageValue(total, 'input_tokens', 'inputTokens')
  const cached = usageValue(total, 'cached_input_tokens')
  if (input === null) return null
  return cached === null ? input : Math.max(0, input - cached)
}

function finishSessionAccumulator(accumulator) {
  const reviewer = REVIEWER_RE.test(
    `${accumulator.firstPrompt ?? ''} ${accumulator.agentPath ?? ''}`,
  )
  return {
    host: accumulator.host,
    file: accumulator.file,
    gitBranch: accumulator.gitBranch,
    cwd: accumulator.cwd,
    contexts: accumulator.contexts,
    firstTs: accumulator.times.firstTs,
    lastTs: accumulator.times.lastTs,
    usage: accumulator.usage,
    subagentCostUnits: accumulator.subagentCostUnits,
    humanMessages: accumulator.hasHumanMessage ? accumulator.humanMessages : null,
    rounds: accumulator.hasHumanMessage ? accumulator.humanMessages : null,
    model: accumulator.model,
    effort: accumulator.effort,
    agentPath: accumulator.agentPath,
    threadId: accumulator.threadId,
    parentThreadId: accumulator.parentThreadId,
    firstPrompt: accumulator.firstPrompt,
    issueIdsInPrompt: accumulator.issueIdsInPrompt,
    ...optionalExecutionFacts(accumulator.execution, reviewer),
    hookBlocks: accumulator.hookBlocks,
  }
}

async function streamLines(file, consume) {
  const input = createReadStream(file, { encoding: 'utf-8' })
  const reader = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of reader) consume(line)
  } finally {
    input.destroy()
  }
}

function subagentFiles(parentFile) {
  const dir = join(dirname(parentFile), basename(parentFile, '.jsonl'), 'subagents')
  if (!existsSync(dir)) return null
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^agent-.*\.jsonl$/.test(entry.name))
    .map((entry) => join(dir, entry.name))
}

// ponytail: "still being written" = any transcript file (or subagent transcript) touched in the last 10 minutes; a tool call longer than that reads as finished.
const LIVE_WINDOW_MS = 10 * 60 * 1000

function sessionLive(file) {
  return [file, ...(subagentFiles(file) ?? [])].some((path) => {
    try {
      return Date.now() - statSync(path).mtimeMs < LIVE_WINDOW_MS
      // FAIL-OPEN-INTENT: an unstatable transcript cannot be shown to be live; the session is reported as finished and its cost stays attributed as read.
    } catch {
      return false
    }
  })
}

async function addSubagentUsage(parent, weights) {
  const files = subagentFiles(parent.file)
  if (files === null) return
  parent.subagentCostUnits = 0
  for (const file of files) {
    const child = newSessionAccumulator('claude', file)
    await streamLines(file, (line) => {
      const event = parseSessionLine(line)
      if (event !== null) updateAccumulatorUsage(child, event)
    })
    addUsage(parent.usage, child.usage)
    const cost = costUnits(child.usage, weights)
    parent.subagentCostUnits =
      cost === null || parent.subagentCostUnits === null ? null : parent.subagentCostUnits + cost
  }
}

export async function discoverSessions(dir, host, sinceMs, untilMs, weights) {
  const sessions = []
  for (const file of sessionFiles(dir, host, sinceMs)) {
    try {
      const accumulator = newSessionAccumulator(host, file)
      await streamLines(file, (line) => consumeSessionLine(accumulator, line))
      if (host === 'claude') await addSubagentUsage(accumulator, weights)
      const session = { ...finishSessionAccumulator(accumulator), live: sessionLive(file) }
      // A transcript resumed after the window still holds its earlier events; only one that began after it is out.
      if (!(Date.parse(session.firstTs ?? '') > untilMs)) sessions.push(session)
    } catch (error) {
      // FAIL-OPEN-INTENT: an unreadable transcript cannot support attribution or KPI phases; omit it and preserve NO DATA in the affected delivery while surfacing the source error.
      process.stderr.write(`ship-kpi: unreadable session ${file}: ${error?.message ?? error}\n`)
    }
  }
  return sessions
}

function sessionEvents(lines) {
  return (lines ?? [])
    .map(parseSessionLine)
    .filter((event) => event !== null)
    .map((event) => event.event ?? event.phase ?? event)
    .filter((event) => LEAD_TIME_KINDS.includes(event?.kind) && typeof event?.t === 'string')
}

function deliveryEvents(pr, commits, lines) {
  const loggedEvents = sessionEvents(lines)
  if (loggedEvents.length > 0) return loggedEvents
  const firstCommit = commits[0]?.authoredDate ?? pr.createdAt
  if (typeof firstCommit !== 'string' || typeof pr.mergedAt !== 'string') return []
  return [
    { t: firstCommit, kind: 'work' },
    { t: pr.mergedAt, kind: 'done' },
  ]
}

function toolUses(events) {
  return events.flatMap((event) => {
    const content = Array.isArray(event?.message?.content) ? event.message.content : []
    return content.filter(
      (block) => block?.type === 'tool_use' && ['Task', 'Agent'].includes(block.name),
    )
  })
}

function delegatedMetadata(events) {
  const models = new Set()
  const efforts = new Set()
  for (const event of events) collectDelegatedMetadata(event, models, efforts)
  return {
    model: models.size > 0 ? [...models].sort().join(', ') : null,
    reasoningEffort: efforts.size > 0 ? [...efforts].sort().join(', ') : null,
  }
}

function collectDelegatedMetadata(event, models, efforts) {
  if (event?.isSidechain === true) addStringValues(models, event.model, efforts, event.effort)
  for (const block of toolUses([event]))
    addStringValues(
      models,
      block.input?.model,
      efforts,
      block.input?.reasoning_effort ?? block.input?.effort,
    )
}

function addStringValues(models, model, efforts, effort) {
  if (typeof model === 'string') models.add(model)
  if (typeof effort === 'string') efforts.add(effort)
}

function sessionFacts(lines) {
  if (lines === null) {
    return {
      tokens: { input: null, output: null, cache: null },
      humanMessages: null,
      rounds: null,
      fullGateRuns: null,
      redCiRuns: null,
      model: null,
      reasoningEffort: null,
    }
  }
  const usage = sessionUsage(lines)
  const events = lines.map(parseSessionLine).filter((event) => event !== null)
  const dispatches = toolUses(events).length
  return {
    tokens: { input: usage.input, output: usage.output, cache: usage.cache },
    humanMessages: usage.humanMessages,
    rounds: dispatches > 0 ? dispatches : usage.humanMessages > 0 ? usage.humanMessages : null,
    fullGateRuns: lines.filter((line) => /check-all\.mjs\s+L[2-4]|full gate/i.test(line)).length,
    redCiRuns: lines.filter((line) =>
      /\b(?:CI|ci)\b.{0,40}\b(?:red|fail(?:ed|ure)?)\b|\b(?:red|fail(?:ed|ure)?)\b.{0,40}\b(?:CI|ci)\b/.test(
        line,
      ),
    ).length,
    ...delegatedMetadata(events),
  }
}

function treatmentFromPr(pr) {
  if (typeof pr.treatment === 'string') return pr.treatment
  const labels = Array.isArray(pr.labels) ? pr.labels.map((label) => label?.name) : []
  return labels.find((label) => ['XS-S', 'Standard', 'Sensitive-train'].includes(label))
}

function enrichPrRow(row, pr, commits, lines) {
  const additions = finiteNumber(pr.additions)
  const deletions = finiteNumber(pr.deletions)
  const facts = sessionFacts(lines)
  const stratum = stratumOf({
    treatment: treatmentFromPr(pr),
    changedLoc: additions !== null && deletions !== null ? additions + deletions : null,
    sensitive: pr.sensitive === true,
    train: pr.train === true,
  })
  return {
    ...row,
    leadTimeSplit: splitLeadTime(deliveryEvents(pr, commits, lines)),
    tokens: facts.tokens,
    humanMessages: facts.humanMessages,
    rounds: facts.rounds,
    fullGateRuns: facts.fullGateRuns,
    redCiRuns: facts.redCiRuns,
    stratum,
    model: facts.model,
    reasoningEffort: facts.reasoningEffort,
  }
}

function fetchPrRow(repo, number, sessions, attributedFiles, options = {}) {
  const pr = options.pr ?? fetchPrDetail(repo, number)
  const commits = options.commits ?? commitsFromPr(pr)
  // `gh pr view --json` (per #2398 spec's field list) does not include `number` —
  // it's already known from the `pr list` call that produced this PR, so inject it.
  const row = buildPrRow({ ...pr, number }, commits)
  const firstCommit = commits[0]?.authoredDate ?? pr.createdAt
  const attributed = options.assigned ?? sessionsForPr(sessions, pr, firstCommit)
  const attributedMetas = attributed.map((entry) => entry.meta)
  markAttributedFiles(attributedMetas, attributedFiles)
  const enriched = enrichPrRow(row, pr, commits, null)
  const history = options.redCiRuns ?? redCiRunsFromHistory(fetchCheckRunHistory(repo, commits))
  return {
    ...mergeDeliverySources(enriched, {
      ci: ciTiming(pr),
      sessions: attributedMetas,
      redCiRuns: history,
      reworkSec: reviewReworkSeconds(commits),
      weights: options.weights,
    }),
    sessions: attributionAudit(attributed, options.weights),
  }
}

/** Auditable per-PR list: which session files were attributed, by which rule, at what cost. */
export function attributionAudit(attributed, weights) {
  return (Array.isArray(attributed) ? attributed : []).map(({ meta, via }) => ({
    file: meta.file ?? null,
    rule: via,
    costUnits: costUnits(meta.usage, weights),
    humanMessages: meta.humanMessages ?? null,
  }))
}

function markAttributedFiles(sessions, files) {
  for (const session of sessions) if (session.file) files?.add(session.file)
}

function commitsFromPr(pr) {
  return (pr.commits ?? []).map((c) => ({
    oid: c.oid,
    subject: c.messageHeadline,
    authoredDate: c.authoredDate,
    touchedOnlyEvidencePaths: touchedOnlyEvidencePaths(c.oid),
  }))
}
function sessionsForPr(sessions, pr, firstCommit) {
  return attributeSessions(sessions, {
    ...pr,
    headRefName: pr.headRefName,
    firstCommit,
    mergedAt: pr.mergedAt,
  })
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

function parseMainCommits(output) {
  return (output ?? '')
    .split('\x1e')
    .filter(Boolean)
    .map((record) => {
      const [sha, date, subject, ...body] = record.split('\x1f')
      return { sha, date, subject, body: body.join('\x1f') }
    })
    .filter((commit) => commit.sha && commit.date && commit.subject)
}

function fetchMainCommits(windowStart) {
  try {
    return parseMainCommits(
      git([
        'log',
        'origin/main',
        `--since=${windowStart.toISOString()}`,
        '--format=%H%x1f%cI%x1f%s%x1f%b%x1e',
      ]),
    )
  } catch (error) {
    // FAIL-OPEN-INTENT: git history is an evidence source; failure is surfaced and returned as null so checkpoint verdicts HOLD instead of claiming no escapes.
    process.stderr.write(`ship-kpi: git escape history unavailable: ${error?.message ?? error}\n`)
    return null
  }
}

// ---- CLI --------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    since: null,
    until: null,
    repo: null,
    json: null,
    sessions: DEFAULT_SESSIONS_DIR,
    codexSessions: DEFAULT_CODEX_SESSIONS_DIR,
    selfTest: false,
    calibrate: false,
    recalibrate: false,
    checkpoint: false,
  }
  const flags = {
    '--self-test': ['selfTest', false],
    '--calibrate': ['calibrate', false],
    '--recalibrate': ['recalibrate', false],
    '--checkpoint': ['checkpoint', false],
    '--since': ['since', true],
    '--until': ['until', true],
    '--repo': ['repo', true],
    '--json': ['json', true],
    '--sessions': ['sessions', true],
    '--codex-sessions': ['codexSessions', true],
  }
  for (let i = 0; i < argv.length; i++) i += applyArg(opts, flags, argv, i)
  return opts
}

function applyArg(opts, flags, argv, index) {
  const flag = flags[argv[index]]
  if (!flag) return 0
  opts[flag[0]] = flag[1] ? argv[index + 1] : true
  return flag[1] ? 1 : 0
}

function historicalRows() {
  if (!existsSync(KPI_HISTORY_DIR)) return []
  const numbered = new Map()
  const unnumbered = []
  for (const name of readdirSync(KPI_HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort())
    addHistoricalFile(name, numbered, unnumbered)
  return [...unnumbered, ...numbered.values()]
}

function addHistoricalFile(name, numbered, unnumbered) {
  let payload
  try {
    payload = JSON.parse(readFileSync(join(KPI_HISTORY_DIR, name), 'utf-8'))
    // FAIL-OPEN-INTENT: one malformed historical report is excluded; valid reports still provide auditable calibration input and missing measures remain null.
  } catch {
    return
  }
  const rows = Array.isArray(payload) ? payload : payload?.rows
  if (Array.isArray(rows)) for (const row of rows) addHistoricalRow(row, numbered, unnumbered)
}

function addHistoricalRow(row, numbered, unnumbered) {
  if (row?.number === null || row?.number === undefined) unnumbered.push(row)
  else numbered.set(String(row.number), row)
}

function tokenTotal(tokens) {
  if (finiteNumber(tokens) !== null) return tokens
  if (!tokens || typeof tokens !== 'object') return null
  const values = ['input', 'output', 'cache'].map((key) => finiteNumber(tokens[key]))
  const present = values.filter((value) => value !== null)
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null
}

function costDelivery(row, weights) {
  const split = row?.leadTimeSplit ?? {}
  return withDeliveryCosts({
    ...row,
    ...Object.fromEntries(Object.keys(split).map((kind) => [kind, finiteNumber(split[kind])])),
    stratum: row?.stratum ?? null,
    leadTime: deliveryLeadTime(row),
    tokens: deliveryTokens(row, weights),
    writerCostUnits: finiteNumber(row?.writerCostUnits),
    reviewerCostUnits: finiteNumber(row?.reviewerCostUnits),
  })
}

export function reportRowsWithCostRatio(rows, baseline, weights) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    stratum: row?.stratum ?? null,
    costBaselineRatio: overheadIndices(costDelivery(row, weights), baseline, weights).tokens,
  }))
}

function deliveryLeadTime(row) {
  const fallbackHours = finiteNumber(row?.leadTimeHours)
  return fallbackHours === null ? finiteNumber(row?.leadTime) : fallbackHours * 3600
}

function deliveryTokens(row, weights) {
  return row?.tokens === null || row?.tokens === undefined ? null : costUnits(row.tokens, weights)
}

function withDeliveryCosts(row) {
  return row
}

const DEFAULT_MIN_CALIBRATION = 8

export function loadThresholds(path = THRESHOLDS_PATH) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (error) {
    throw new Error(`thresholds unreadable: ${error?.message ?? error}`)
  }
  const numeric = [
    'plateau',
    'tune',
    'rethinkMedian',
    'rethinkP90',
    'andon',
    'n',
    'minMeasured',
    'escapeWindowDays',
  ]
  if (
    !value ||
    value.provisional !== true ||
    numeric.some((key) => finiteNumber(value[key]) === null) ||
    !value.costWeights ||
    ['input', 'cache', 'output'].some((key) => finiteNumber(value.costWeights[key]) === null)
  ) {
    throw new Error('thresholds malformed: required provisional, numeric limits, and costWeights')
  }
  return value
}

function configuredCostWeights() {
  configuredWeights ??= loadThresholds().costWeights
  return configuredWeights
}

function writeBaseline(baseline, recalibrate) {
  if (existsSync(BASELINE_PATH) && !recalibrate) {
    throw new Error(`refusing to overwrite ${BASELINE_PATH}; use --recalibrate`)
  }
  mkdirSync(join(BASELINE_PATH, '..'), { recursive: true })
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
}

function runCalibration(opts) {
  const thresholds = loadThresholds()
  const weights = thresholds.costWeights
  const deliveries = historicalRows()
    .map((row) => costDelivery(row, weights))
    .filter((delivery) => delivery.stratum !== null)
  const baseline = calibrate(deliveries, weights, thresholds)
  if (Object.keys(baseline).length === 0) {
    throw new Error('no historical deliveries with a stratum; refusing to write an empty baseline')
  }
  writeBaseline(baseline, opts.recalibrate)
  process.stderr.write(`ship-kpi: wrote ${BASELINE_PATH}\n`)
}

function mergedAtMs(row) {
  const value = Date.parse(row?.mergedAt ?? '')
  return Number.isFinite(value) ? value : null
}

function orderedRows(rows, stratum) {
  return rows
    .filter((row) => row.stratum === stratum && mergedAtMs(row) !== null)
    .sort((a, b) => mergedAtMs(a) - mergedAtMs(b))
}

export function checkpointForRows(
  rows,
  stratum,
  baseline,
  weights,
  mainCommits = [],
  windowDays,
  nowMs = Date.now(),
  issues = [],
) {
  const selected = orderedRows(rows, stratum).slice(-10)
  const costs = selected.map((row) => costDelivery(row, weights))
  const indices = costs.map((delivery) => overheadIndices(delivery, baseline, weights))
  const time = quantiles(indices.map((index) => index.time))
  const tokens = quantiles(indices.map((index) => index.tokens))
  const escapes = findEscapes(selected, mainCommits, windowDays, issues)
  const escapeWindowOpen = countOpenEscapes(selected, nowMs, windowDays)
  const buckets = checkpointBuckets(costs, baseline, stratum)
  const topBucket = topCheckpointBucket(buckets)
  const measured = measuredIndices(indices)
  const andon = checkpointAndon(costs)
  const controls = existsSync(REMOVED_CONTROLS_PATH)
    ? JSON.parse(readFileSync(REMOVED_CONTROLS_PATH, 'utf-8'))
    : []
  const rollback = rollbackControl(escapes ?? [], controls)
  const ranked = rankCheckpointIndices(indices, selected)
  const offenders = ranked.filter(
    (offender) => Math.max(offender.time ?? -Infinity, offender.tokens ?? -Infinity) > 1,
  )
  return {
    stratum,
    n: selected.length,
    measured,
    indices: { time, tokens },
    buckets,
    topBucket,
    bucketExcess: topBucket === null ? null : buckets[topBucket].excess,
    andon,
    rollback,
    escapes,
    escapeWindowOpen,
    offenders,
    worst: ranked[0] ?? null,
    window: {
      since:
        selected
          .map(mergedAtMs)
          .filter((value) => value !== null)
          .map((value) => new Date(value).toISOString().slice(0, 10))[0] ?? 'NO DATA',
      until:
        [...selected]
          .reverse()
          .map(mergedAtMs)
          .filter((value) => value !== null)
          .map((value) => new Date(value).toISOString().slice(0, 10))[0] ?? 'NO DATA',
    },
    _selected: selected,
  }
}

function countOpenEscapes(rows, nowMs, windowDays) {
  return rows.filter((row) => {
    const mergedMs = mergedAtMs(row)
    return mergedMs !== null && mergedMs <= nowMs && nowMs - mergedMs < windowDays * 86_400_000
  }).length
}
function checkpointBuckets(costs, baseline, stratum) {
  return Object.fromEntries(
    ['writer', 'review'].map((kind) => checkpointBucket(costs, baseline, stratum, kind)),
  )
}
function checkpointBucket(costs, baseline, stratum, kind) {
  const values = costs.map((delivery) =>
    kind === 'writer'
      ? { time: writerTimeReference(delivery), tokens: delivery.writerCostUnits }
      : { time: delivery.review, tokens: delivery.reviewerCostUnits },
  )
  const time = quantiles(values.map((value) => value.time)).median
  const tokens = quantiles(values.map((value) => value.tokens)).median
  const base = baseline?.[stratum]?.buckets?.[kind]
  return [
    kind,
    {
      time,
      tokens,
      excess: Math.max(
        ratio(time, finiteNumber(base?.timeMedianSec)) ?? -Infinity,
        ratio(tokens, finiteNumber(base?.costUnitsMedian)) ?? -Infinity,
      ),
    },
  ]
}
function topCheckpointBucket(buckets) {
  return (
    Object.entries(buckets)
      .filter(([, bucket]) => finiteNumber(bucket.excess) !== null)
      .sort(([, a], [, b]) => b.excess - a.excess)[0]?.[0] ?? null
  )
}
function measuredIndices(indices) {
  return {
    time: indices.filter((index) => index.time !== null).length,
    tokens: indices.filter((index) => index.tokens !== null).length,
  }
}
function checkpointAndon(costs) {
  const leadMedian = median(
    costs.map((delivery) => delivery.leadTime).filter((value) => value !== null),
  )
  const tokenMedian = median(
    costs.map((delivery) => delivery.tokens).filter((value) => value !== null),
  )
  return costs.some(
    (delivery) =>
      (delivery.leadTime !== null && delivery.leadTime > leadMedian * 3) ||
      (delivery.tokens !== null && delivery.tokens > tokenMedian * 3),
  )
}
function rankCheckpointIndices(indices, selected) {
  return indices
    .map((index, position) => ({
      number: selected[position]?.number ?? null,
      time: index.time,
      tokens: index.tokens,
    }))
    .sort(
      (a, b) =>
        Math.max(b.time ?? -Infinity, b.tokens ?? -Infinity) -
        Math.max(a.time ?? -Infinity, a.tokens ?? -Infinity),
    )
}

export function checkpointHistory(path = TUNING_LOG_PATH) {
  if (!existsSync(path)) return []
  const payloads = readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.match(/^<!-- shipKpiCheckpoint (\{.*\}) -->$/)?.[1])
    .filter(Boolean)
  try {
    return payloads.map((payload) => JSON.parse(payload))
    // FAIL-OPEN-INTENT: parsing failure is surfaced as empty history so an older entry cannot masquerade as the consecutive prior checkpoint.
  } catch {
    return []
  }
}

function ensureTuningLog() {
  if (existsSync(TUNING_LOG_PATH)) return
  mkdirSync(join(TUNING_LOG_PATH, '..'), { recursive: true })
  writeFileSync(
    TUNING_LOG_PATH,
    "---\ntitle: 'Ship tuning log'\ndoc_version: '1.0.0'\nstatus: active\nlast_review: '2026-09-19'\nowner: ''\ncanonical_id: ''\ntags: ['audience/dev', 'kind/measurement']\nrelated: []\n---\n\n# Ship tuning log\n\n<!-- Generated by ship-kpi --checkpoint. -->\n",
  )
}

function runCheckpoint(opts) {
  const thresholds = loadThresholds()
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
  const rows = historicalRows()
  const strata = [...new Set(rows.map((row) => row.stratum).filter((stratum) => stratum))].sort()
  const history = checkpointHistory()
  // SHIP_KPI_NOW pins the clock so the escape-window count is reproducible in tests and replays.
  const pinned = Date.parse(process.env['SHIP_KPI_NOW'] ?? '')
  const nowMs = Number.isNaN(pinned) ? Date.now() : pinned
  const windowStartMs =
    Math.min(...rows.map(mergedAtMs).filter((value) => value !== null), nowMs) -
    thresholds.escapeWindowDays * 86_400_000
  const mainCommits = fetchMainCommits(new Date(windowStartMs))
  const escapeIssues = fetchEscapeIssues(opts?.repo, rows)
  const results = strata.map((stratum) => {
    const current = checkpointForRows(
      rows,
      stratum,
      baseline,
      thresholds.costWeights,
      mainCommits,
      thresholds.escapeWindowDays,
      nowMs,
      escapeIssues,
    )
    const verdict = checkpointVerdict({ current, baseline: baseline[stratum], thresholds, history })
    return {
      date: today(),
      window: current.window,
      n: current.n,
      indices: current.indices,
      topBucket: current.topBucket,
      bucketExcess: current.bucketExcess,
      measured: current.measured,
      rollback: current.rollback,
      verdict,
      stratum,
      offenders: current.offenders,
      worst: current.worst,
      escapes: current.escapes,
      escapeWindowOpen: current.escapeWindowOpen,
    }
  })
  ensureTuningLog()
  for (const result of results) {
    const worst = result.worst
    const worstLabel =
      worst?.number === null || worst?.number === undefined ? '' : `, worst PR #${worst.number}`
    process.stdout.write(
      `${result.stratum}: ${result.verdict} (n: ${result.n}, time=${formatMetric(result.indices.time.median)}, tokens=${formatMetric(result.indices.tokens.median)}${worstLabel})\n`,
    )
    appendFileSync(TUNING_LOG_PATH, formatLogEntry(result))
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatCompact(value) {
  if (finiteNumber(value) === null) return 'NO DATA'
  const absolute = Math.abs(value)
  for (const [unit, suffix] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ]) {
    if (absolute >= unit) return `${rounded(value / unit)}${suffix}`
  }
  return String(rounded(value))
}

function formatMetric(value) {
  if (finiteNumber(value) === null) return 'NO DATA'
  return String(rounded(value, 2))
}

function formatRatio(value) {
  const number = finiteNumber(value)
  return number === null ? 'NO DATA' : number.toFixed(2)
}

function roundHours(value) {
  return value === null || value === undefined ? 'NO DATA' : Math.round(value * 10) / 10
}

function renderStratumSummary(rows, weights) {
  const groups = new Map()
  for (const row of rows) {
    const stratum = row.stratum ?? 'Unknown'
    const group = groups.get(stratum) ?? []
    group.push(row)
    groups.set(stratum, group)
  }
  const lines = [
    '## Per-stratum',
    '',
    '| Stratum | n | Lead time median/p90 (h) | Median in / cache / out | costUnits median/p90 | humanMessages median/p90 | sourcesKnown |',
    '|---------|---|--------------------------|-------------------------|---------------------|--------------------------|--------------|',
  ]
  for (const [stratum, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lead = quantiles(group.map((row) => row.leadTimeHours))
    const input = quantiles(group.map((row) => row.tokens?.input))
    const cache = quantiles(group.map((row) => row.tokens?.cache))
    const output = quantiles(group.map((row) => row.tokens?.output))
    const costs = quantiles(group.map((row) => costUnits(row.tokens, weights)))
    const human = quantiles(group.map((row) => row.humanMessages))
    const coverage = ['ci', 'claude', 'codex']
      .map(
        (source) =>
          `${source} ${group.filter((row) => row.sourcesKnown?.includes(source)).length}/${group.length}`,
      )
      .join(', ')
    lines.push(
      `| ${stratum} | ${group.length} | ${roundHours(lead.median)}/${roundHours(lead.p90)} | ${formatCompact(input.median)} / ${formatCompact(cache.median)} / ${formatCompact(output.median)} | ${formatCompact(costs.median)}/${formatCompact(costs.p90)} | ${formatMetric(human.median)}/${formatMetric(human.p90)} | ${coverage} |`,
    )
  }
  return lines
}

export function renderMarkdown({
  since,
  until,
  rows,
  aggregate,
  hookBlocks,
  unattributed,
  weights,
}) {
  const lines = []
  lines.push(
    `# Ship KPI — ${since} → ${until}`,
    '',
    '## Per-PR',
    '',
    '| PR | Stratum | Commits | Evidence-only | Review-loop | Lead time (h) | Split w/p/f/r/q/c | costUnits | Cost/baseline | Human | Rounds | Gates | CI red at open | +/- |',
    '|----|---------|---------|---------------|-------------|----------------|-------------------|-----------|---------------|-------|--------|-------|----------------|-----|',
    ...renderRows(rows, weights),
  )
  lines.push('', ...renderStratumSummary(rows, weights))
  lines.push(
    `unattributed: claude ${formatMetric(unattributed?.claude)} / codex ${formatMetric(unattributed?.codex)} across ${formatMetric(unattributed?.sessions)} sessions`,
  )
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
  lines.push(...renderHookBlocks(hookBlocks))
  return lines.join('\n') + '\n'
}

function renderRows(rows, weights) {
  return rows.map(
    (r) =>
      `| #${r.number} | ${display(r.stratum)} | ${formatMetric(r.commits)} | ${formatMetric(r.evidenceOnlyCommits)} | ${formatMetric(r.reviewLoopCommits)} | ${formatMetric(r.leadTimeHours)} | ${['work', 'preflight', 'fullGate', 'review', 'ciWait', 'ciRun'].map((kind) => formatMetric(r.leadTimeSplit?.[kind])).join('/')} | ${formatCompact(r.costUnits ?? costUnits(r.tokens, weights))} | ${formatRatio(r.costBaselineRatio)} | ${formatMetric(r.humanMessages)} | ${formatMetric(r.rounds)} | ${formatMetric(r.fullGateRuns)} | ${r.ciRedAtOpen === null ? 'NO DATA' : r.ciRedAtOpen ? 'yes' : 'no'} | +${formatMetric(r.additions)}/-${formatMetric(r.deletions)} |`,
  )
}
function renderHookBlocks(hookBlocks) {
  if (Object.keys(hookBlocks).length === 0) return []
  return [
    '',
    '## Hook blocks (session logs)',
    '',
    '| Hook | Blocks |',
    '|------|--------|',
    ...Object.entries(hookBlocks)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `| ${name} | ${count} |`),
  ]
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.selfTest) process.exit(runSelfTest())
  if (opts.calibrate) return runCalibration(opts)
  if (opts.checkpoint) return runCheckpoint(opts)
  if (!opts.since) return usageError()
  return runReport(opts)
}

function usageError() {
  process.stderr.write(
    'usage: ship-kpi --since <date> [--until <date>] [--repo owner/name] [--json <path>] [--sessions <dir>] [--codex-sessions <dir>]\n       ship-kpi --calibrate [--recalibrate]\n       ship-kpi --checkpoint\n       checkpoint verdicts: NO DATA | ANDON | ROLLBACK | RETHINK | TUNE <bucket> | PLATEAU | HOLD\n       ROLLBACK requires a matching entry in scripts/data/ship-kpi-removed-controls.json (empty today).\n       ship-kpi --self-test\n',
  )
  process.exit(2)
}

/** Staleness is measured at the window end when the report is bounded, so a past window repeats. */
export function reportNowMs(opts, untilMs) {
  return opts.until ? untilMs : Date.now()
}

/** The JSON evidence: a pure function of the measured data, no clock, so finished sessions repeat byte for byte. */
export function reportPayload({ opts, untilLabel, rows, aggregate, hookBlocks, unattributed }) {
  return {
    since: opts.since,
    until: untilLabel,
    repo: opts.repo,
    ciRedAtOpenApproximation:
      'ciRedAtOpen reflects the CURRENT statusCheckRollup, not the first run at PR-open time — GitHub does not retain that snapshot via gh.',
    rows,
    aggregate,
    hookBlocks,
    unattributed,
  }
}

async function runReport(opts) {
  const until = opts.until
  const prNumbers = fetchMergedPrNumbers(opts.repo, opts.since, until)
  const sinceMs = new Date(`${opts.since}T00:00:00Z`).getTime()
  const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : Date.now()
  const thresholds = loadThresholds()
  const sessions = [
    ...(await discoverSessions(opts.sessions, 'claude', sinceMs, untilMs, thresholds.costWeights)),
    ...(await discoverSessions(opts.codexSessions, 'codex', sinceMs, untilMs)),
  ]
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
  const prContexts = prNumbers.map((number) => {
    const pr = fetchPrDetail(opts.repo, number)
    const commits = (pr.commits ?? []).map((commit) => ({
      oid: commit.oid,
      subject: commit.messageHeadline,
      authoredDate: commit.authoredDate,
      touchedOnlyEvidencePaths: touchedOnlyEvidencePaths(commit.oid),
    }))
    return {
      number,
      ...pr,
      firstCommit: commits[0]?.authoredDate ?? pr.createdAt,
      mergedAt: pr.mergedAt,
      commits,
    }
  })
  const assignments = attributeSessionsToDeliveries(sessions, prContexts)
  const attributedFiles = new Set()
  const rows = reportRowsWithCostRatio(
    prContexts.map((context) =>
      fetchPrRow(opts.repo, context.number, sessions, attributedFiles, {
        pr: context,
        commits: context.commits,
        assigned: assignments.get(context.number) ?? [],
        weights: thresholds.costWeights,
      }),
    ),
    baseline,
    thresholds.costWeights,
  )
  const unattributed = unattributedUsage(sessions, attributedFiles)
  const openPrs = fetchOpenPrs(opts.repo)
  const issuesClosedCount = fetchIssuesClosedCount(opts.repo, opts.since, until)
  const mainSubjects = fetchMainSubjects(opts.since, until)

  const windowHours = (untilMs - sinceMs) / 3_600_000

  const aggregate = computeAggregate({
    rows,
    issuesClosedCount,
    windowHours,
    mainSubjects,
    openPrs,
    nowMs: reportNowMs(opts, untilMs),
  })

  const hookBlocks = {}
  for (const session of sessions) {
    for (const [name, count] of Object.entries(session.hookBlocks ?? {})) {
      hookBlocks[name] = (hookBlocks[name] ?? 0) + count
    }
  }

  const untilLabel = until ?? today()
  const payload = reportPayload({ opts, untilLabel, rows, aggregate, hookBlocks, unattributed })
  const live = sessions.filter((session) => session.live && attributedFiles.has(session.file))
  if (live.length > 0)
    process.stderr.write(
      `ship-kpi: ${live.length} attributed session(s) still being written, their cost may still grow: ${live.map((session) => session.file).join(', ')}\n`,
    )

  process.stdout.write(
    renderMarkdown({
      since: opts.since,
      until: untilLabel,
      rows,
      aggregate,
      hookBlocks,
      unattributed,
      weights: thresholds.costWeights,
    }),
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
    name: 'findEscapes finds a post-merge fix that cites the delivered issue',
    run: () =>
      findEscapes(
        [{ number: 1, mergedAt: '2026-01-01T00:00:00Z', issueIds: [2], commitShas: [] }],
        [{ sha: 'fixsha', date: '2026-01-02T00:00:00Z', subject: 'fix: repair #2', body: '' }],
        14,
      ).length === 1,
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
  {
    name: 'splitLeadTime preserves unknown phases as null',
    run: () =>
      splitLeadTime([
        { t: '2026-09-19T00:00:00Z', kind: 'work' },
        { t: '2026-09-19T00:00:10Z', kind: 'mystery' },
      ]).work === 10,
    expected: true,
  },
  {
    name: 'sessionUsage leaves unavailable token totals null',
    run: () => sessionUsage([JSON.stringify({ type: 'human' })]).input === null,
    expected: true,
  },
  {
    name: 'stratumOf widens a train delivery',
    run: () => stratumOf({ treatment: 'XS-S', train: true }) === 'Sensitive-train',
    expected: true,
  },
  {
    name: 'quantiles keeps the nearest-rank p90',
    run: () => quantiles([1, 2, 3, 4, 100]).p90 === 100,
    expected: true,
  },
  {
    name: 'overheadIndices applies the lead-time floor formula',
    run: () =>
      overheadIndices(
        {
          stratum: 'Standard',
          sourcesKnown: ['ci', 'claude'],
          leadTime: 120,
          preflight: 10,
          fullGate: 20,
          review: 30,
          ci: 40,
          tokens: 200,
        },
        { Standard: { writerTimeMedianSec: 20, writerCostUnitsMedian: 100 } },
      ).time === 1,
    expected: true,
  },
  {
    name: 'calibrate caps each stratum at thirty deliveries',
    run: () =>
      calibrate([
        {
          stratum: 'XS-S',
          number: 1,
          mergedAt: '2026-01-01T00:00:00Z',
          leadTime: 10,
          writerCostUnits: 20,
        },
      ])['XS-S']?.n === 1,
    expected: true,
  },
  {
    name: 'checkpointVerdict returns NO DATA below the checkpoint minimum',
    run: () => checkpointVerdict({ current: { n: 1 }, thresholds: loadThresholds() }) === 'NO DATA',
    expected: true,
  },
  {
    name: 'checkpointVerdict returns HOLD when more measuring is needed',
    run: () =>
      checkpointVerdict({
        current: {
          n: 10,
          indices: {
            time: { median: 1.6, p90: 1.6 },
            tokens: { median: 1.1, p90: 1.2 },
          },
          measured: { time: 10, tokens: 10 },
          andon: false,
          escapes: [],
        },
        thresholds: loadThresholds(),
      }) === 'HOLD',
    expected: true,
  },
  {
    name: 'formatLogEntry includes the HOLD verdict',
    run: () => formatLogEntry({ verdict: 'HOLD' }).includes('HOLD'),
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
