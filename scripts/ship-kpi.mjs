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
import { join } from 'node:path'
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
  const kinds =
    Array.isArray(events) &&
    events.some((event) => ['preflight', 'fullGate', 'ciRun'].includes(event?.kind))
      ? LEAD_TIME_KINDS
      : ['work', 'verify', 'review', 'ciWait', 'rework', 'ceremony']
  const result = Object.fromEntries(kinds.map((kind) => [kind, null]))
  if (!Array.isArray(events)) return result
  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i]
    const next = events[i + 1]
    const kind = current?.kind
    const start = Date.parse(current?.t ?? '')
    const end = Date.parse(next?.t ?? '')
    if (
      !(LEAD_TIME_KINDS.includes(kind) || kind === 'ceremony') ||
      !Number.isFinite(start) ||
      !Number.isFinite(end)
    ) {
      continue
    }
    const seconds = rounded(Math.max(0, end - start) / 1000)
    result[kind] = result[kind] === null ? seconds : rounded(result[kind] + seconds)
  }
  return result
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
  let input = null
  let output = null
  let cache = null
  let humanMessages = 0
  for (const line of Array.isArray(lines) ? lines : []) {
    const event = parseSessionLine(line)
    if (event === null) continue
    if (event.type === 'human' || event.type === 'user' || event.message?.role === 'user') {
      humanMessages++
    }
    const usage = event.message?.usage ?? event.usage
    input = addMetric(input, usageValue(usage, 'input_tokens', 'inputTokens'))
    output = addMetric(output, usageValue(usage, 'output_tokens', 'outputTokens'))
    const cacheRead = usageValue(usage, 'cache_read_input_tokens', 'cacheReadInputTokens')
    const cacheCreation = usageValue(
      usage,
      'cache_creation_input_tokens',
      'cacheCreationInputTokens',
    )
    cache = addMetric(cache, cacheRead)
    cache = addMetric(cache, cacheCreation)
  }
  return { input, output, cache, humanMessages }
}

/** Select the treatment, widening sensitive/train deliveries before size fallback. */
export function stratumOf(delivery) {
  if (delivery?.sensitive === true || delivery?.train === true) return 'Sensitive-train'
  if (typeof delivery?.treatment === 'string' && delivery.treatment.trim() !== '') {
    return delivery.treatment
  }
  const changedLoc = finiteNumber(delivery?.changedLoc)
  if (changedLoc === null) return null
  return changedLoc < 200 ? 'XS-S' : 'Standard'
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
  if (!Array.isArray(delivery?.sourcesKnown)) return true
  return delivery.sourcesKnown.includes(source)
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
  const result = {
    time: ciKnown ? ratio(leadTime, timeFloor) : null,
    tokens: ciKnown && sessionSourceKnown(delivery) ? ratio(measuredTokens, referenceTokens) : null,
  }
  if (!Array.isArray(delivery?.sourcesKnown)) return result
  return {
    ...result,
    floorComponents: {
      time: {
        leadTime,
        measured: floor.total,
        writerReference: referenceTime,
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
  return commits.filter(
    (commit) =>
      Array.isArray(commit?.checkRuns) &&
      commit.checkRuns.some((check) => String(check?.conclusion ?? '').toUpperCase() === 'FAILURE'),
  ).length
}

function sessionOverlaps(session, firstCommit, mergedAt) {
  const firstMs = Date.parse(firstCommit ?? '')
  const mergedMs = Date.parse(mergedAt ?? '')
  const sessionFirstMs = Date.parse(session?.firstTs ?? '')
  const sessionLastMs = Date.parse(session?.lastTs ?? '')
  const windowStartMs = firstMs - 2 * 60 * 60 * 1000
  return (
    Number.isFinite(firstMs) &&
    Number.isFinite(mergedMs) &&
    Number.isFinite(sessionFirstMs) &&
    Number.isFinite(sessionLastMs) &&
    sessionFirstMs <= mergedMs &&
    sessionLastMs >= windowStartMs
  )
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
  const result = []
  for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
    const mergedMs = Date.parse(delivery?.mergedAt ?? '')
    const pr = Number(delivery?.number)
    if (!Number.isFinite(mergedMs) || !Number.isSafeInteger(pr)) continue
    const issueIds = [
      pr,
      ...(Array.isArray(delivery?.issueIds) ? delivery.issueIds.map(Number) : []),
    ].filter(Number.isSafeInteger)
    const ownCommitShas = new Set(
      (Array.isArray(delivery?.commitShas) ? delivery.commitShas : []).filter(
        (sha) => typeof sha === 'string',
      ),
    )
    if (mainCommits === null || issues === null) return null
    for (const commit of Array.isArray(mainCommits) ? mainCommits : []) {
      const dateMs = Date.parse(commit?.date ?? '')
      const sha = commit?.sha
      const subject = typeof commit?.subject === 'string' ? commit.subject : ''
      const isRevert = /^revert\b/i.test(subject)
      const isFix = /^fix(?:\([^)]*\))?:/i.test(subject)
      if (
        !Number.isFinite(dateMs) ||
        dateMs <= mergedMs ||
        dateMs > mergedMs + windowMs ||
        typeof sha !== 'string' ||
        ownCommitShas.has(sha) ||
        sha === delivery?.mergeCommitOid ||
        new RegExp(`\\(#${pr}\\)\\s*$`).test(subject) ||
        (!isRevert && !isFix) ||
        isEvidenceOnlySubject(subject)
      ) {
        continue
      }
      const text = `${subject}\n${typeof commit?.body === 'string' ? commit.body : ''}`
      if (!containsIssueReference(text, issueIds)) continue
      result.push({ pr, sha, kind: isRevert ? 'revert' : 'fix', subject })
    }
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        const issueDate = Date.parse(issue?.createdAt ?? '')
        const text = `${issue?.title ?? ''}\n${issue?.body ?? ''}`
        if (
          Number.isFinite(issueDate) &&
          issueDate > mergedMs &&
          issueDate <= mergedMs + windowMs &&
          containsIssueReference(text, issueIds)
        ) {
          result.push({ pr, issue: issue.number, kind: 'issue', subject: issue.title ?? '' })
        }
      }
    }
  }
  return result
}

export function rollbackControl(escapes, controls) {
  for (const escape of Array.isArray(escapes) ? escapes : []) {
    const text = `${escape?.subject ?? ''}\n${escape?.body ?? ''}`
    for (const control of Array.isArray(controls) ? controls : []) {
      if (typeof control?.id !== 'string' || typeof control?.pattern !== 'string') continue
      if (new RegExp(control.pattern, 'i').test(text)) return control.id
    }
  }
  return null
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

/** Attribute overlapping sessions through an issue-bearing path or Codex ancestry. */
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
      let via = null
      if (containsIssueId(meta.gitBranch, issueIds)) via = 'branch'
      else if (typeof pr.worktreeDir === 'string' && meta.cwd === pr.worktreeDir) via = 'cwd'
      else if (containsIssueId(meta.cwd, issueIds)) via = 'cwd'
      else if (issueNumbers(meta.agentPath, 'agent').some((id) => issueIds.includes(id)))
        via = 'agent-path'
      else if (
        meta.host === 'codex' &&
        typeof meta.parentThreadId === 'string' &&
        attributedThreads.has(meta.parentThreadId)
      ) {
        via = 'parent'
      } else if (
        meta.host === 'claude' &&
        meta.issueIdsInPrompt?.length === 1 &&
        issueIds.includes(meta.issueIdsInPrompt[0])
      ) {
        via = 'prompt'
      }
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

function overlapSeconds(session, delivery) {
  const start = Math.max(Date.parse(session.firstTs ?? ''), Date.parse(delivery.firstCommit ?? ''))
  const end = Math.min(Date.parse(session.lastTs ?? ''), Date.parse(delivery.mergedAt ?? ''))
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
}

/** Attribute each session once, preferring explicit branch/cwd/agent/parent/prompt evidence. */
export function attributeSessionsToDeliveries(sessions, deliveries) {
  const result = new Map((deliveries ?? []).map((delivery) => [delivery.number, []]))
  const assigned = new Set()
  const candidates = (sessions ?? []).map((meta) => {
    const matches = (deliveries ?? [])
      .map((delivery) => {
        const found = attributeSessions([meta], delivery)
        return found.length > 0 ? { delivery, match: found[0] } : null
      })
      .filter(Boolean)
    return { meta, matches }
  })
  const assignedThreads = new Map()
  for (const { meta, matches } of candidates) {
    if (matches.length === 0) continue
    matches.sort((a, b) => {
      const rank = { branch: 0, cwd: 1, 'agent-path': 2, parent: 3, prompt: 4 }
      return (
        rank[a.match.via] - rank[b.match.via] ||
        overlapSeconds(meta, b.delivery) - overlapSeconds(meta, a.delivery) ||
        Number(a.delivery.number) - Number(b.delivery.number)
      )
    })
    const chosen = matches[0]
    result.get(chosen.delivery.number)?.push(chosen.match)
    assigned.add(meta)
    if (meta.host === 'codex' && typeof meta.threadId === 'string') {
      assignedThreads.set(meta.threadId, chosen.delivery.number)
    }
  }
  for (const meta of sessions ?? []) {
    if (assigned.has(meta) || meta.host !== 'codex' || typeof meta.parentThreadId !== 'string')
      continue
    const number = assignedThreads.get(meta.parentThreadId)
    const delivery = (deliveries ?? []).find((candidate) => candidate.number === number)
    if (!delivery || !sessionOverlaps(meta, delivery.firstCommit, delivery.mergedAt)) continue
    result.get(number)?.push({ meta, via: 'parent' })
    assigned.add(meta)
    if (typeof meta.threadId === 'string') assignedThreads.set(meta.threadId, number)
  }
  return new Map([...result].filter(([, entries]) => entries.length > 0))
}

function messageContent(event) {
  return event?.message?.content ?? event?.content
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
  if (host === 'codex' && event?.payload?.type === 'function_call') {
    if (event.payload.name !== 'exec_command') return null
    try {
      return JSON.parse(event.payload.arguments ?? '{}').cmd ?? null
      // FAIL-OPEN-INTENT: malformed Codex tool arguments cannot identify a KPI phase; the phase remains unknown and is never counted as zero.
    } catch {
      return null
    }
  }
  const blocks = Array.isArray(event?.message?.content) ? event.message.content : []
  const block = blocks.find((candidate) => candidate?.type === 'tool_use')
  if (!block || !['Bash', 'Agent', 'Task'].includes(block.name)) return null
  return block.input?.command ?? block.input?.cmd ?? null
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
    const command = commandFromCall(event, host)
    const id = callIdentity(event, host)
    if (command && id) {
      const kind = FULL_GATE_RE.test(command)
        ? 'fullGate'
        : PREFLIGHT_RE.test(command)
          ? 'preflight'
          : null
      if (kind) open.set(id, { kind, timestamp: Date.parse(eventTimestamp(event) ?? '') })
      continue
    }
    const resultId = resultIdentity(event, host)
    const started = open.get(resultId)
    const end = Date.parse(eventTimestamp(event) ?? '')
    if (!started || !Number.isFinite(end) || !Number.isFinite(started.timestamp)) continue
    const seconds = Math.max(0, Math.round((end - started.timestamp) / 1000))
    facts[`${started.kind}Sec`] = (facts[`${started.kind}Sec`] ?? 0) + seconds
    if (started.kind === 'fullGate') facts.fullGateRuns++
    open.delete(resultId)
  }
  return facts
}

function optionalExecutionFacts(execution, reviewer) {
  if (reviewer || execution.preflightSec !== null || execution.fullGateSec !== null) {
    return { ...execution, reviewer }
  }
  return {}
}

/** Summarize Claude JSONL without counting sidechains or tool-result messages. */
export function claudeSessionMeta(lines) {
  let gitBranch = null
  let cwd = null
  let effort = null
  let humanMessages = 0
  let hasHumanMessage = false
  let input = null
  let output = null
  let cache = null
  let firstPrompt = null
  let issueIdsInPrompt = []
  const times = { firstTs: null, lastTs: null }
  for (const line of Array.isArray(lines) ? lines : []) {
    const event = parseSessionLine(line)
    if (event === null) continue
    updateSessionTimes(times, eventTimestamp(event))
    if (gitBranch === null && typeof event.gitBranch === 'string') gitBranch = event.gitBranch
    if (cwd === null && typeof event.cwd === 'string') cwd = event.cwd
    if (typeof event.effort === 'string') effort = event.effort
    const role = event.message?.role ?? event.type
    if (role === 'user' && event.isSidechain !== true && !isToolResultMessage(event)) {
      humanMessages++
      hasHumanMessage = true
      const content = messageContent(event)
      if (firstPrompt === null && typeof content === 'string') {
        firstPrompt = content.slice(0, 400)
        issueIdsInPrompt = promptIssueIds(firstPrompt)
      }
    }
    if (role !== 'assistant') continue
    const usage = event.message?.usage ?? event.usage
    input = addMetric(input, usageValue(usage, 'input_tokens', 'inputTokens'))
    output = addMetric(output, usageValue(usage, 'output_tokens', 'outputTokens'))
    cache = addMetric(cache, usageValue(usage, 'cache_read_input_tokens', 'cacheReadInputTokens'))
    cache = addMetric(
      cache,
      usageValue(usage, 'cache_creation_input_tokens', 'cacheCreationInputTokens'),
    )
  }
  const events = (Array.isArray(lines) ? lines : [])
    .map(parseSessionLine)
    .filter((event) => event !== null)
  const execution = executionFacts(events, 'claude')
  return {
    gitBranch,
    cwd,
    firstTs: times.firstTs,
    lastTs: times.lastTs,
    usage: { input, output, cache },
    humanMessages: hasHumanMessage ? humanMessages : null,
    effort,
    firstPrompt,
    issueIdsInPrompt,
    ...optionalExecutionFacts(
      execution,
      REVIEWER_RE.test(`${firstPrompt ?? ''} ${gitBranch ?? ''}`),
    ),
  }
}

/** Summarize Codex rollout JSONL using its latest context and token snapshot. */
export function codexSessionMeta(lines) {
  let cwd = null
  let agentPath = null
  let threadId = null
  let parentThreadId = null
  let model = null
  let effort = null
  let usage = { input: null, output: null, cache: null }
  const times = { firstTs: null, lastTs: null }
  for (const line of Array.isArray(lines) ? lines : []) {
    const event = parseSessionLine(line)
    if (event === null) continue
    updateSessionTimes(times, eventTimestamp(event))
    const payload = event.payload ?? {}
    const spawn = payload.source?.subagent?.thread_spawn
    if (cwd === null && typeof (payload.cwd ?? event.cwd) === 'string')
      cwd = payload.cwd ?? event.cwd
    if (
      agentPath === null &&
      typeof (spawn?.agent_path ?? payload.agent_path ?? event.agent_path) === 'string'
    ) {
      agentPath = spawn?.agent_path ?? payload.agent_path ?? event.agent_path
    }
    if (
      threadId === null &&
      typeof (payload.id ?? payload.thread_id ?? event.thread_id) === 'string'
    ) {
      threadId = payload.id ?? payload.thread_id ?? event.thread_id
    }
    if (
      parentThreadId === null &&
      typeof (payload.parent_thread_id ?? spawn?.parent_thread_id ?? event.parent_thread_id) ===
        'string'
    ) {
      parentThreadId = payload.parent_thread_id ?? spawn?.parent_thread_id ?? event.parent_thread_id
    }
    if (event.type === 'turn_context') {
      if (typeof payload.model === 'string') model = payload.model
      const nextEffort = payload.reasoning_effort ?? payload.effort
      if (typeof nextEffort === 'string') effort = nextEffort
    }
    const total = payload.info?.total_token_usage
    if (total && typeof total === 'object') {
      usage = {
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
  }
  const events = (Array.isArray(lines) ? lines : [])
    .map(parseSessionLine)
    .filter((event) => event !== null)
  const execution = executionFacts(events, 'codex')
  return {
    cwd,
    firstTs: times.firstTs,
    lastTs: times.lastTs,
    model,
    effort,
    agentPath,
    threadId,
    parentThreadId,
    usage,
    ...optionalExecutionFacts(execution, REVIEWER_RE.test(`${agentPath ?? ''}`)),
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
  const tokenMaps = attributed.map((session) => session?.usage).filter(Boolean)
  const tokens =
    tokenMaps.length > 0
      ? {
          input: sumNullable(tokenMaps.map((usage) => usage.input)),
          output: sumNullable(tokenMaps.map((usage) => usage.output)),
          cache: sumNullable(tokenMaps.map((usage) => usage.cache)),
        }
      : (row?.tokens ?? null)
  const leadTimeSplit = { ...(row?.leadTimeSplit ?? {}) }
  if (finiteNumber(ci?.ciWaitSec) !== null) leadTimeSplit.ciWait = ci.ciWaitSec
  if (finiteNumber(ci?.ciRunSec) !== null) {
    leadTimeSplit.ciRun = ci.ciRunSec
    leadTimeSplit.verify = ci.ciRunSec
  }
  const writerSessions = attributed.filter((session) => session?.reviewer !== true)
  const reviewerSessions = attributed.filter((session) => session?.reviewer === true)
  const writerCostUnits = weights
    ? sumNullable(writerSessions.map((session) => costUnits(session?.usage, weights)))
    : null
  const reviewerCostUnits = weights
    ? sumNullable(reviewerSessions.map((session) => costUnits(session?.usage, weights)))
    : null
  const preflight = sumNullable(attributed.map((session) => session?.preflightSec))
  const fullGate = sumNullable(attributed.map((session) => session?.fullGateSec))
  const review = sumNullable(reviewerSessions.map(sessionSeconds))
  const knownPhases = [
    preflight,
    fullGate,
    review,
    finiteNumber(ci?.ciWaitSec),
    finiteNumber(ci?.ciRunSec),
    finiteNumber(reworkSec ?? row?.reworkSec),
  ]
  const leadTime = finiteNumber(row?.leadTimeHours) === null ? null : row.leadTimeHours * 3600
  const work =
    leadTime === null
      ? null
      : rounded(Math.max(0, leadTime - knownPhases.reduce((sum, value) => sum + (value ?? 0), 0)))
  for (const [kind, value] of Object.entries({ preflight, fullGate, review, work })) {
    if (value !== null) leadTimeSplit[kind] = value
  }
  if (finiteNumber(reworkSec ?? row?.reworkSec) !== null) {
    leadTimeSplit.rework = reworkSec ?? row.reworkSec
  }
  const models = [
    ...(Array.isArray(row?.models) ? row.models : []),
    ...attributed
      .filter((session) => typeof session?.model === 'string')
      .map((session) => `${session.model}${session.effort ? `@${session.effort}` : ''}`),
  ]
  const sourcesKnown = []
  if (
    [ci?.ciWaitSec, ci?.ciRunSec, ci?.redCiRuns, redCiRuns].some(
      (value) => finiteNumber(value) !== null,
    )
  ) {
    sourcesKnown.push('ci')
  }
  if (attributed.some((session) => session?.host === 'claude')) sourcesKnown.push('claude')
  if (attributed.some((session) => session?.host === 'codex')) sourcesKnown.push('codex')
  return {
    ...row,
    tokens,
    humanMessages: sourceMetric(row, attributed, 'humanMessages'),
    rounds: sourceMetric(row, attributed, 'rounds'),
    fullGateRuns: sourceMetric(row, attributed, 'fullGateRuns'),
    redCiRuns:
      finiteNumber(redCiRuns) !== null
        ? redCiRuns
        : finiteNumber(ci?.redCiRuns) !== null
          ? ci.redCiRuns
          : (row?.redCiRuns ?? null),
    leadTimeSplit,
    ceremony: row?.ceremony ?? {
      evidenceOnlyCommits: row?.evidenceOnlyCommits ?? null,
      hookBlocks: row?.hookBlocks ?? null,
    },
    writerCostUnits,
    reviewerCostUnits,
    models: [...new Set(models)],
    sourcesKnown,
  }
}

export function unattributedUsage(metas, attributedFiles) {
  const result = { claude: null, codex: null, sessions: null }
  const isAttributed = (file) =>
    attributedFiles instanceof Set
      ? attributedFiles.has(file)
      : Array.isArray(attributedFiles) && attributedFiles.includes(file)
  for (const meta of Array.isArray(metas) ? metas : []) {
    if (isAttributed(meta?.file) || !['claude', 'codex'].includes(meta?.host)) continue
    const tokens = tokenTotal(meta?.usage)
    if (tokens !== null) result[meta.host] = (result[meta.host] ?? 0) + tokens
    result.sessions = (result.sessions ?? 0) + 1
  }
  return result
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
  const leadTime = finiteNumber(delivery?.leadTime)
  if (leadTime === null) return null
  const ci = finiteNumber(delivery?.ciRun) ?? finiteNumber(delivery?.ci)
  const phases = ['preflight', 'fullGate', 'review', 'rework'].map((kind) =>
    finiteNumber(delivery?.[kind]),
  )
  return Math.max(0, leadTime - phases.reduce((sum, value) => sum + (value ?? 0), ci ?? 0))
}

function indexValues(checkpoint) {
  return ['time', 'tokens'].flatMap((kind) => {
    const index = checkpoint?.indices?.[kind]
    return [index?.median, index?.p90]
  })
}

function checkpointWithin(checkpoint, limit, minimumN = 0) {
  if ((finiteNumber(checkpoint?.n) ?? 0) < minimumN) return false
  const values = indexValues(checkpoint).map(finiteNumber)
  return values.length === 4 && values.every((value) => value !== null && value <= limit)
}

function tuningBucket(current, baseline, threshold) {
  const names = Object.keys(current?.buckets ?? {})
  for (const name of names) {
    const currentBucket = current.buckets[name]
    const baseBucket = baseline?.buckets?.[name]
    const time = finiteNumber(currentBucket?.time)
    const tokens = finiteNumber(currentBucket?.tokens)
    const baseTime = finiteNumber(baseBucket?.timeMedianSec)
    const baseTokens = finiteNumber(baseBucket?.costUnitsMedian)
    const excesses = [ratio(time, baseTime), ratio(tokens, baseTokens)].filter(
      (value) => value !== null,
    )
    if (excesses.some((value) => value > threshold)) {
      return name
    }
  }
  return null
}

function ineffectiveTuneCount(history) {
  const entries = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.stratum === history?.currentStratum)
    .slice(-2)
  if (entries.length < 2) return false
  const [first, last] = entries
  return (
    typeof first?.verdict === 'string' &&
    typeof last?.verdict === 'string' &&
    first.verdict === last.verdict &&
    first.verdict.startsWith('TUNE ') &&
    finiteNumber(first.bucketExcess) !== null &&
    finiteNumber(last.bucketExcess) !== null &&
    first.bucketExcess / last.bucketExcess < 2
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
  if (typeof current?.rollback === 'string' && current.rollback.length > 0) {
    return 'ROLLBACK'
  }
  if (current?.escapes === null) return 'HOLD'
  if ((current?.escapes?.length ?? 0) > 0 || current?.andon === true) {
    return 'ANDON'
  }
  if (
    (finiteNumber(current?.n) ?? 0) < (finiteNumber(limits.n) ?? Infinity) ||
    (finiteNumber(current?.measured?.time) ?? 0) < (finiteNumber(limits.minMeasured) ?? Infinity) ||
    (finiteNumber(current?.measured?.tokens) ?? 0) <
      (finiteNumber(limits.minMeasured) ?? Infinity) ||
    ['time', 'tokens'].some((kind) => finiteNumber(current?.indices?.[kind]?.median) === null)
  ) {
    return 'NO DATA'
  }
  const sameStratumHistory = (Array.isArray(history) ? history : []).filter(
    (entry) => entry?.stratum === current?.stratum,
  )
  const rethinkHistory = Object.assign(sameStratumHistory, { currentStratum: current?.stratum })
  if (exceedsRethink(current, limits) && ineffectiveTuneCount(rethinkHistory)) {
    return 'RETHINK'
  }
  const bucket = tuningBucket(current, baseline, limits.tune)
  if (bucket !== null) return `TUNE ${current?.topBucket ?? bucket}`
  const loggedPrevious = sameStratumHistory.at(-1) ?? previous
  if (
    checkpointWithin(current, limits.plateau) &&
    checkpointWithin(loggedPrevious, limits.plateau, finiteNumber(limits.n) ?? 0)
  ) {
    return 'PLATEAU'
  }
  return 'HOLD'
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
  const lines = [
    '',
    `### Ship checkpoint — ${result?.date ?? 'NO DATA'}`,
    '',
    `- stratum: ${result?.stratum ?? 'NO DATA'}`,
    `- Window: ${result?.window?.since ?? 'NO DATA'} → ${result?.window?.until ?? 'NO DATA'}`,
    `- n: ${result?.n ?? 'NO DATA'}`,
    `- measured: time=${result?.measured?.time ?? 'NO DATA'}/${result?.n ?? 'NO DATA'}, tokens=${result?.measured?.tokens ?? 'NO DATA'}/${result?.n ?? 'NO DATA'}`,
    `- time: median=${formatMetric(time.median)}, p90=${formatMetric(time.p90)}`,
    `- tokens: median=${formatMetric(tokens.median)}, p90=${formatMetric(tokens.p90)}`,
    `- top bucket: ${result?.topBucket ?? 'NO DATA'}`,
    `- top bucket excess: ${formatMetric(result?.bucketExcess)}`,
    `- verdict: ${result?.verdict ?? 'NO DATA'}`,
  ]
  lines.push(`- escape window open: ${result?.escapeWindowOpen ?? 0}`)
  if (result?.verdict === 'ANDON' || result?.verdict === 'ROLLBACK') {
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
  const escapes = Array.isArray(result?.escapes) ? result.escapes : []
  lines.push(
    `- escapes: ${
      result?.escapes === null
        ? 'NO DATA'
        : escapes.length > 0
          ? escapes
              .map((escape) =>
                escape.kind === 'issue'
                  ? `#${escape.pr} ← issue #${escape.issue}: ${String(escape.subject).slice(0, 80)}`
                  : `#${escape.pr} ← ${String(escape.sha).slice(0, 7)} ${escape.kind}: ${String(escape.subject).slice(0, 80)}`,
              )
              .join('; ')
          : 'none'
    }`,
  )
  // One-line HTML comment: prettier leaves it untouched (a fenced JSON block gets re-wrapped and the
  // entry stops parsing), and instruction loaders strip comments, so it costs no context.
  lines.push('', `<!-- shipKpiCheckpoint ${JSON.stringify(roundDeep(result))} -->`, '')
  return lines.join('\n')
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

function fetchPrDetail(repo, number) {
  return ghJsonOrThrow(
    [
      'pr',
      'view',
      String(number),
      '--json',
      'commits,createdAt,mergedAt,headRefName,closingIssuesReferences,additions,deletions,statusCheckRollup,labels',
      ...repoArgs(repo),
    ],
    `gh pr view #${number}`,
  )
}

function fetchCheckRunHistory(repo, commits) {
  if (typeof repo !== 'string' || !Array.isArray(commits)) return null
  const results = []
  try {
    for (const commit of commits) {
      const data = ghJsonOrThrow(
        ['api', `repos/${repo}/commits/${commit.oid ?? commit.sha}/check-runs`, '--paginate'],
        `gh api check-runs ${commit.oid ?? commit.sha}`,
      )
      results.push({ sha: commit.oid ?? commit.sha, checkRuns: data?.check_runs ?? data })
    }
    return results
  } catch (error) {
    // FAIL-OPEN-INTENT: check-run history is optional external evidence; surface its failure and return null so redCiRuns stays NO DATA.
    process.stderr.write(`ship-kpi: check-run history unavailable: ${error?.message ?? error}\n`)
    return null
  }
}

function fetchEscapeIssues(repo, deliveries) {
  if (typeof repo !== 'string') return []
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

function reviewReworkSeconds(commits) {
  const dates = (Array.isArray(commits) ? commits : [])
    .filter((commit) => isReviewLoopSubject(commit.subject))
    .map((commit) => Date.parse(commit.authoredDate ?? ''))
    .filter(Number.isFinite)
  if (dates.length < 2) return dates.length === 1 ? 0 : null
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
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && predicate(entry.name)) files.push(full)
    else if (entry.isDirectory() && !entry.name.includes('observer-sessions') && depth < maxDepth) {
      files.push(...collectFiles(full, predicate, maxDepth, depth + 1))
    }
  }
  return files
}

function sessionFiles(dir, host, sinceMs, untilMs) {
  const maxDepth = host === 'claude' ? 1 : Number.POSITIVE_INFINITY
  const predicate =
    host === 'claude'
      ? (name) => name.endsWith('.jsonl')
      : (name) => /^rollout-.*\.jsonl$/.test(name)
  return collectFiles(dir, predicate, maxDepth).filter((file) => {
    try {
      const mtimeMs = statSync(file).mtimeMs
      return mtimeMs >= sinceMs && mtimeMs <= untilMs
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
    times: { firstTs: null, lastTs: null },
    execution: { preflightSec: null, fullGateSec: null, fullGateRuns: 0 },
    openCalls: new Map(),
    hookBlocks: {},
  }
}

function consumeExecution(accumulator, event) {
  const command = commandFromCall(event, accumulator.host)
  const id = callIdentity(event, accumulator.host)
  if (command && id) {
    const kind = FULL_GATE_RE.test(command)
      ? 'fullGate'
      : PREFLIGHT_RE.test(command)
        ? 'preflight'
        : null
    if (kind)
      accumulator.openCalls.set(id, { kind, timestamp: Date.parse(eventTimestamp(event) ?? '') })
    return
  }
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
  const usage = event.message?.usage ?? event.usage
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
  if (accumulator.host === 'claude') {
    if (accumulator.gitBranch === null && typeof event.gitBranch === 'string')
      accumulator.gitBranch = event.gitBranch
    if (accumulator.cwd === null && typeof event.cwd === 'string') accumulator.cwd = event.cwd
    if (typeof event.effort === 'string') accumulator.effort = event.effort
    const role = event.message?.role ?? event.type
    if (role === 'user' && event.isSidechain !== true && !isToolResultMessage(event)) {
      accumulator.humanMessages++
      accumulator.hasHumanMessage = true
      const content = messageContent(event)
      if (accumulator.firstPrompt === null && typeof content === 'string') {
        accumulator.firstPrompt = content.slice(0, 400)
        accumulator.issueIdsInPrompt = promptIssueIds(accumulator.firstPrompt)
      }
    }
  } else {
    const payload = event.payload ?? {}
    const spawn = payload.source?.subagent?.thread_spawn
    if (accumulator.cwd === null && typeof (payload.cwd ?? event.cwd) === 'string')
      accumulator.cwd = payload.cwd ?? event.cwd
    if (
      accumulator.agentPath === null &&
      typeof (spawn?.agent_path ?? payload.agent_path ?? event.agent_path) === 'string'
    )
      accumulator.agentPath = spawn?.agent_path ?? payload.agent_path ?? event.agent_path
    if (
      accumulator.threadId === null &&
      typeof (payload.id ?? payload.thread_id ?? event.thread_id) === 'string'
    )
      accumulator.threadId = payload.id ?? payload.thread_id ?? event.thread_id
    if (
      accumulator.parentThreadId === null &&
      typeof (payload.parent_thread_id ?? spawn?.parent_thread_id ?? event.parent_thread_id) ===
        'string'
    )
      accumulator.parentThreadId =
        payload.parent_thread_id ?? spawn?.parent_thread_id ?? event.parent_thread_id
    if (event.type === 'turn_context') {
      if (typeof payload.model === 'string') accumulator.model = payload.model
      if (typeof (payload.reasoning_effort ?? payload.effort) === 'string')
        accumulator.effort = payload.reasoning_effort ?? payload.effort
    }
    const total = payload.info?.total_token_usage
    if (total && typeof total === 'object') {
      // OpenAI usage reports input_tokens inclusive of cached_input_tokens (Anthropic's excludes
      // cache reads), so fresh input is the difference; otherwise the cached share counts twice.
      accumulator.usage = {
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
  }
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
    firstTs: accumulator.times.firstTs,
    lastTs: accumulator.times.lastTs,
    usage: accumulator.usage,
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

export async function discoverSessions(dir, host, sinceMs, untilMs) {
  const sessions = []
  for (const file of sessionFiles(dir, host, sinceMs, untilMs)) {
    let input
    try {
      input = createReadStream(file, { encoding: 'utf-8' })
      const reader = createInterface({ input, crlfDelay: Infinity })
      const accumulator = newSessionAccumulator(host, file)
      for await (const line of reader) consumeSessionLine(accumulator, line)
      sessions.push(finishSessionAccumulator(accumulator))
    } catch (error) {
      // FAIL-OPEN-INTENT: an unreadable transcript cannot support attribution or KPI phases; omit it and preserve NO DATA in the affected delivery while surfacing the source error.
      process.stderr.write(`ship-kpi: unreadable session ${file}: ${error?.message ?? error}\n`)
      if (input) input.destroy()
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
  for (const event of events) {
    if (event?.isSidechain === true) {
      if (typeof event.model === 'string') models.add(event.model)
      if (typeof event.effort === 'string') efforts.add(event.effort)
    }
    for (const block of toolUses([event])) {
      const model = block.input?.model
      const effort = block.input?.reasoning_effort ?? block.input?.effort
      if (typeof model === 'string') models.add(model)
      if (typeof effort === 'string') efforts.add(effort)
    }
  }
  return {
    model: models.size > 0 ? [...models].sort().join(', ') : null,
    reasoningEffort: efforts.size > 0 ? [...efforts].sort().join(', ') : null,
  }
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

function fetchPrRow(repo, number, sessions, worktreeDir, attributedFiles, options = {}) {
  const pr = options.pr ?? fetchPrDetail(repo, number)
  const commits =
    options.commits ??
    (pr.commits ?? []).map((c) => ({
      oid: c.oid,
      subject: c.messageHeadline,
      authoredDate: c.authoredDate,
      touchedOnlyEvidencePaths: touchedOnlyEvidencePaths(c.oid),
    }))
  // `gh pr view --json` (per #2398 spec's field list) does not include `number` —
  // it's already known from the `pr list` call that produced this PR, so inject it.
  const row = buildPrRow({ ...pr, number }, commits)
  const firstCommit = commits[0]?.authoredDate ?? pr.createdAt
  const attributed =
    options.assigned ??
    attributeSessions(sessions, {
      ...pr,
      headRefName: pr.headRefName,
      firstCommit,
      mergedAt: pr.mergedAt,
      worktreeDir,
    })
  const attributedMetas = attributed.map((entry) => entry.meta)
  for (const session of attributedMetas) {
    if (session.file) attributedFiles?.add(session.file)
  }
  const enriched = enrichPrRow(row, pr, commits, null)
  const history = options.redCiRuns ?? redCiRunsFromHistory(fetchCheckRunHistory(repo, commits))
  return mergeDeliverySources(enriched, {
    ci: ciTiming(pr),
    sessions: attributedMetas,
    redCiRuns: history,
    reworkSec: reviewReworkSeconds(commits),
    weights: options.weights,
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
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--self-test') opts.selfTest = true
    else if (a === '--calibrate') opts.calibrate = true
    else if (a === '--recalibrate') opts.recalibrate = true
    else if (a === '--checkpoint') opts.checkpoint = true
    else if (a === '--since') opts.since = argv[++i]
    else if (a === '--until') opts.until = argv[++i]
    else if (a === '--repo') opts.repo = argv[++i]
    else if (a === '--json') opts.json = argv[++i]
    else if (a === '--sessions') opts.sessions = argv[++i]
    else if (a === '--codex-sessions') opts.codexSessions = argv[++i]
  }
  return opts
}

function historicalRows() {
  if (!existsSync(KPI_HISTORY_DIR)) return []
  const numbered = new Map()
  const unnumbered = []
  for (const name of readdirSync(KPI_HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    let payload
    try {
      payload = JSON.parse(readFileSync(join(KPI_HISTORY_DIR, name), 'utf-8'))
      // FAIL-OPEN-INTENT: one malformed historical report is excluded; valid reports still provide auditable calibration input and missing measures remain null.
    } catch {
      continue
    }
    const snapshotRows = Array.isArray(payload) ? payload : payload?.rows
    if (!Array.isArray(snapshotRows)) continue
    for (const row of snapshotRows) {
      if (row?.number === null || row?.number === undefined) unnumbered.push(row)
      else numbered.set(String(row.number), row)
    }
  }
  return [...unnumbered, ...numbered.values()]
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
  const fallbackHours = finiteNumber(row?.leadTimeHours)
  const leadTime = fallbackHours === null ? finiteNumber(row?.leadTime) : fallbackHours * 3600
  return {
    ...row,
    ...Object.fromEntries(Object.keys(split).map((kind) => [kind, finiteNumber(split[kind])])),
    stratum: row?.stratum ?? null,
    leadTime,
    tokens:
      row?.tokens === null || row?.tokens === undefined ? null : costUnits(row.tokens, weights),
    writerCostUnits: finiteNumber(row?.writerCostUnits),
    reviewerCostUnits: finiteNumber(row?.reviewerCostUnits),
  }
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
    .filter((row) => row.stratum === stratum)
    .sort((a, b) => {
      const aMs = mergedAtMs(a)
      const bMs = mergedAtMs(b)
      if (aMs === null) return bMs === null ? 0 : -1
      if (bMs === null) return 1
      return aMs - bMs
    })
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
  const escapeWindowOpen = selected.filter((row) => {
    const mergedMs = mergedAtMs(row)
    return mergedMs !== null && mergedMs <= nowMs && nowMs - mergedMs < windowDays * 86_400_000
  }).length
  const buckets = Object.fromEntries(
    ['writer', 'review'].map((kind) => {
      const values = costs.map((delivery) =>
        kind === 'writer'
          ? { time: writerTimeReference(delivery), tokens: delivery.writerCostUnits }
          : { time: delivery.review, tokens: delivery.reviewerCostUnits },
      )
      const time = quantiles(values.map((value) => value.time)).median
      const tokens = quantiles(values.map((value) => value.tokens)).median
      const base = baseline?.[stratum]?.buckets?.[kind]
      const timeExcess = ratio(time, finiteNumber(base?.timeMedianSec))
      const tokenExcess = ratio(tokens, finiteNumber(base?.costUnitsMedian))
      return [
        kind,
        { time, tokens, excess: Math.max(timeExcess ?? -Infinity, tokenExcess ?? -Infinity) },
      ]
    }),
  )
  const topBucket =
    Object.entries(buckets)
      .filter(([, bucket]) => finiteNumber(bucket.excess) !== null)
      .sort(([, a], [, b]) => b.excess - a.excess)[0]?.[0] ?? null
  const measured = {
    time: indices.filter((index) => index.time !== null).length,
    tokens: indices.filter((index) => index.tokens !== null).length,
  }
  const leadValues = costs.map((delivery) => delivery.leadTime).filter((value) => value !== null)
  const tokenValues = costs.map((delivery) => delivery.tokens).filter((value) => value !== null)
  const leadMedian = median(leadValues)
  const tokenMedian = median(tokenValues)
  const andon = costs.some(
    (delivery) =>
      (delivery.leadTime !== null && delivery.leadTime > leadMedian * 3) ||
      (delivery.tokens !== null && delivery.tokens > tokenMedian * 3),
  )
  const controls = existsSync(REMOVED_CONTROLS_PATH)
    ? JSON.parse(readFileSync(REMOVED_CONTROLS_PATH, 'utf-8'))
    : []
  const rollback = rollbackControl(escapes ?? [], controls)
  const ranked = indices
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

export function checkpointHistory(path = TUNING_LOG_PATH) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.match(/^<!-- shipKpiCheckpoint (\{.*\}) -->$/)?.[1])
    .flatMap((payload) => {
      try {
        return payload ? [{ shipKpiCheckpoint: JSON.parse(payload) }] : []
        // FAIL-OPEN-INTENT: one malformed historical checkpoint is excluded; valid logged checkpoints remain available and a missing history only prevents PLATEAU.
      } catch {
        return []
      }
    })
    .map((entry) => entry.shipKpiCheckpoint)
    .filter(Boolean)
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
  lines.push(`# Ship KPI — ${since} → ${until}`, '')
  lines.push('## Per-PR', '')
  lines.push(
    '| PR | Commits | Evidence-only | Review-loop | Lead time (h) | Split w/p/f/r/q/c | costUnits | Human | Rounds | Gates | CI red at open | +/- |',
  )
  lines.push(
    '|----|---------|---------------|-------------|----------------|-------------------|-----------|-------|--------|-------|----------------|-----|',
  )
  for (const r of rows) {
    lines.push(
      `| #${r.number} | ${formatMetric(r.commits)} | ${formatMetric(r.evidenceOnlyCommits)} | ${formatMetric(r.reviewLoopCommits)} | ${formatMetric(r.leadTimeHours)} | ${['work', 'preflight', 'fullGate', 'review', 'ciWait', 'ciRun'].map((kind) => formatMetric(r.leadTimeSplit?.[kind])).join('/')} | ${formatCompact(r.costUnits ?? costUnits(r.tokens, weights))} | ${formatMetric(r.humanMessages)} | ${formatMetric(r.rounds)} | ${formatMetric(r.fullGateRuns)} | ${r.ciRedAtOpen === null ? 'NO DATA' : r.ciRedAtOpen ? 'yes' : 'no'} | +${formatMetric(r.additions)}/-${formatMetric(r.deletions)} |`,
    )
  }
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

  if (opts.calibrate) {
    runCalibration(opts)
    return
  }

  if (opts.checkpoint) {
    runCheckpoint(opts)
    return
  }

  if (!opts.since) {
    process.stderr.write(
      'usage: ship-kpi --since <date> [--until <date>] [--repo owner/name] [--json <path>] [--sessions <dir>] [--codex-sessions <dir>]\n' +
        '       ship-kpi --calibrate [--recalibrate]\n' +
        '       ship-kpi --checkpoint\n' +
        '       checkpoint verdicts: NO DATA | ANDON | ROLLBACK | RETHINK | TUNE <bucket> | PLATEAU | HOLD\n' +
        '       ROLLBACK requires a matching entry in scripts/data/ship-kpi-removed-controls.json (empty today).\n' +
        '       ship-kpi --self-test\n',
    )
    process.exit(2)
  }

  const until = opts.until
  const prNumbers = fetchMergedPrNumbers(opts.repo, opts.since, until)
  const sinceMs = new Date(`${opts.since}T00:00:00Z`).getTime()
  const untilMs = until ? new Date(`${until}T23:59:59Z`).getTime() : Date.now()
  const sessions = [
    ...(await discoverSessions(opts.sessions, 'claude', sinceMs, untilMs)),
    ...(await discoverSessions(opts.codexSessions, 'codex', sinceMs, untilMs)),
  ]
  const thresholds = loadThresholds()
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
      worktreeDir: process.cwd(),
      commits,
    }
  })
  const assignments = attributeSessionsToDeliveries(sessions, prContexts)
  const attributedFiles = new Set()
  const rows = prContexts.map((context) =>
    fetchPrRow(opts.repo, context.number, sessions, process.cwd(), attributedFiles, {
      pr: context,
      commits: context.commits,
      assigned: assignments.get(context.number) ?? [],
      weights: thresholds.costWeights,
    }),
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
    nowMs: Date.now(),
  })

  const hookBlocks = {}
  for (const session of sessions) {
    for (const [name, count] of Object.entries(session.hookBlocks ?? {})) {
      hookBlocks[name] = (hookBlocks[name] ?? 0) + count
    }
  }

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
    unattributed,
  }

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
