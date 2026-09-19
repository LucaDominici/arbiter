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

// ---- Pure classifiers (exported, covered by --self-test + vitest) --------

const EVIDENCE_SUBJECT_RE =
  /^chore\(.*\): (refresh|record|correlate|finalize|complete|align) .*(evidence|manifest)/i
const REVIEW_LOOP_RE =
  /\b(close|harden|bind|reject|preserve|confine|restore)\b.*\b(gap|gaps|bypass|bypasses|evidence|review|regression|blocker|blockers)\b/i
const FEAT_RE = /^feat(\(|:)/i
const HOOK_BLOCK_RE = /hook error: \[node \.claude\/hooks\/([a-z-]+)\.mjs\]/g
const LEAD_TIME_KINDS = ['work', 'verify', 'review', 'ciWait', 'rework', 'ceremony']
const DELIVERY_TIME_KINDS = ['preflight', 'fullGate', 'review', 'ci', ...LEAD_TIME_KINDS]
const DEFAULT_THRESHOLDS = {
  plateau: 1.3,
  tune: 1.2,
  rethinkMedian: 2,
  rethinkP90: 4,
  andon: 3,
  n: 10,
  escapeWindowDays: 14,
}

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

/** Split ordered phase events; an unavailable phase stays null, never zero. */
export function splitLeadTime(events) {
  const result = Object.fromEntries(LEAD_TIME_KINDS.map((kind) => [kind, null]))
  if (!Array.isArray(events)) return result
  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i]
    const next = events[i + 1]
    const kind = current?.kind
    const start = Date.parse(current?.t ?? '')
    const end = Date.parse(next?.t ?? '')
    if (!LEAD_TIME_KINDS.includes(kind) || !Number.isFinite(start) || !Number.isFinite(end)) {
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
  } catch {
    // FAIL-OPEN-INTENT: malformed session lines are skipped because this is a best-effort delivery metric; the affected fields remain null rather than becoming zero.
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

function deliveryTime(delivery) {
  const phases = DELIVERY_TIME_KINDS.map((kind) => finiteNumber(delivery?.[kind])).filter(
    (value) => value !== null,
  )
  if (phases.length > 0) return Math.max(...phases)
  return finiteNumber(delivery?.time)
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

/** Compare the largest observed phase and total tokens with a stratum baseline. */
export function overheadIndices(delivery, baseline) {
  const reference = baseline?.[delivery?.stratum]
  if (!reference) return { time: null, tokens: null }
  const measuredTime = deliveryTime(delivery)
  const measuredTokens = tokenTotal(delivery?.tokens)
  const referenceTime = finiteNumber(reference.timeMedian)
  const referenceTokens = finiteNumber(reference.tokensMedian)
  const result = {
    time: sourceKnown(delivery, 'ci') ? ratio(measuredTime, referenceTime) : null,
    tokens: sessionSourceKnown(delivery) ? ratio(measuredTokens, referenceTokens) : null,
  }
  if (!Array.isArray(delivery?.sourcesKnown)) return result
  return {
    ...result,
    floorComponents: {
      time: { measured: measuredTime, reference: referenceTime },
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
    redCiRuns: checks.filter(
      (check) =>
        typeof check.conclusion === 'string' && check.conclusion.toUpperCase() === 'FAILURE',
    ).length,
  }
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

const DELIMITED_NUMBER_RE = /(?<!\d)\d+(?!\d)/g
const PROMPT_ISSUE_RE = /#(\d{3,5})\b/g

function sortedUnique(numbers) {
  return [...new Set(numbers)].sort((a, b) => a - b)
}

function delimitedNumbers(value) {
  if (typeof value !== 'string') return []
  return [...value.matchAll(DELIMITED_NUMBER_RE)].map((match) => Number(match[0]))
}

function promptIssueIds(prompt) {
  if (typeof prompt !== 'string') return []
  return sortedUnique([...prompt.matchAll(PROMPT_ISSUE_RE)].map((match) => Number(match[1])))
}

function containsIssueId(value, issueIds) {
  return delimitedNumbers(value).some((id) => issueIds.includes(id))
}

export function issueIdsOf(pr) {
  const branchIds = delimitedNumbers(pr?.headRefName)
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
      else if (containsIssueId(meta.cwd, issueIds)) via = 'cwd'
      else if (containsIssueId(meta.agentPath, issueIds)) via = 'agent-path'
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
        input: usageValue(total, 'input_tokens', 'inputTokens'),
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
  }
}

function sumNullable(values) {
  const present = values.map(finiteNumber).filter((value) => value !== null)
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null
}

function sourceMetric(row, sessions, key) {
  const measured = sumNullable(sessions.map((session) => session?.[key]))
  return measured ?? row?.[key] ?? null
}

/** Merge CI and attributed session measurements, preserving zeroes and unknown nulls. */
export function mergeDeliverySources(row, { ci, sessions } = {}) {
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
  if (finiteNumber(ci?.ciRunSec) !== null) leadTimeSplit.verify = ci.ciRunSec
  const models = [
    ...(Array.isArray(row?.models) ? row.models : []),
    ...attributed
      .filter((session) => typeof session?.model === 'string')
      .map((session) => `${session.model}${session.effort ? `@${session.effort}` : ''}`),
  ]
  const sourcesKnown = []
  if ([ci?.ciWaitSec, ci?.ciRunSec, ci?.redCiRuns].some((value) => finiteNumber(value) !== null)) {
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
    redCiRuns: finiteNumber(ci?.redCiRuns) !== null ? ci.redCiRuns : (row?.redCiRuns ?? null),
    leadTimeSplit,
    models: [...new Set(models)],
    sourcesKnown,
  }
}

export function unattributedUsage(metas, attributedFiles) {
  const result = { claude: 0, codex: 0, sessions: 0 }
  const isAttributed = (file) =>
    attributedFiles instanceof Set
      ? attributedFiles.has(file)
      : Array.isArray(attributedFiles) && attributedFiles.includes(file)
  for (const meta of Array.isArray(metas) ? metas : []) {
    if (isAttributed(meta?.file) || !['claude', 'codex'].includes(meta?.host)) continue
    result[meta.host] += tokenTotal(meta?.usage) ?? 0
    result.sessions++
  }
  return result
}

/** Build per-stratum writer references from the first thirty deliveries seen. */
export function calibrate(deliveries) {
  const groups = {}
  for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
    const stratum = delivery?.stratum
    if (typeof stratum !== 'string' || stratum === '') continue
    const group = (groups[stratum] ??= [])
    if (group.length < 30) group.push(delivery)
  }
  return Object.fromEntries(
    Object.entries(groups).map(([stratum, group]) => {
      const time = quantiles(group.map((delivery) => delivery.time ?? delivery.leadTime)).median
      const tokens = quantiles(group.map((delivery) => delivery.tokens)).median
      return [stratum, { timeMedian: time, tokensMedian: tokens, n: group.length }]
    }),
  )
}

function indexValues(checkpoint) {
  return ['time', 'tokens'].flatMap((kind) => {
    const index = checkpoint?.indices?.[kind]
    return [index?.median, index?.p90]
  })
}

function checkpointWithin(checkpoint, limit) {
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
    const baseTime = finiteNumber(baseBucket?.time)
    const baseTokens = finiteNumber(baseBucket?.tokens)
    if (
      time !== null &&
      tokens !== null &&
      baseTime !== null &&
      baseTokens !== null &&
      time > baseTime * threshold &&
      tokens > baseTokens * threshold
    ) {
      return name
    }
  }
  return null
}

function ineffectiveTuneCount(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-2)
    .filter((verdict) => typeof verdict === 'string' && verdict.startsWith('TUNE ')).length
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
  const limits = { ...DEFAULT_THRESHOLDS, ...(thresholds ?? {}) }
  if (typeof current?.rollback === 'string' && current.rollback.length > 0) {
    return 'ROLLBACK'
  }
  if ((current?.escapes?.length ?? 0) > 0 || (current?.maxOverhead ?? -Infinity) > limits.andon) {
    return 'ANDON'
  }
  if (
    (finiteNumber(current?.n) ?? 0) < limits.n ||
    ['time', 'tokens'].some((kind) => finiteNumber(current?.indices?.[kind]?.median) === null)
  ) {
    return 'NO DATA'
  }
  if (exceedsRethink(current, limits) && ineffectiveTuneCount(history) >= 2) {
    return 'RETHINK'
  }
  const bucket = tuningBucket(current, baseline, limits.tune)
  if (bucket !== null) return `TUNE ${current?.topBucket ?? bucket}`
  if (checkpointWithin(current, limits.plateau) && checkpointWithin(previous, limits.plateau)) {
    return 'PLATEAU'
  }
  return 'HOLD'
}

/** Render one deterministic markdown checkpoint entry for the tuning log. */
export function formatLogEntry(result) {
  const time = result?.indices?.time ?? { median: null, p90: null }
  const tokens = result?.indices?.tokens ?? { median: null, p90: null }
  return [
    `### Ship checkpoint — ${result?.date ?? 'NO DATA'}`,
    `- Window: ${result?.window?.since ?? 'NO DATA'} → ${result?.window?.until ?? 'NO DATA'}`,
    `- n: ${result?.n ?? 'NO DATA'}`,
    `- time: median=${time.median ?? 'NO DATA'}, p90=${time.p90 ?? 'NO DATA'}`,
    `- tokens: median=${tokens.median ?? 'NO DATA'}, p90=${tokens.p90 ?? 'NO DATA'}`,
    `- top bucket: ${result?.topBucket ?? 'NO DATA'}`,
    `- verdict: ${result?.verdict ?? 'NO DATA'}`,
    '',
  ].join('\n')
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

/** Count `hook error: [node .claude/hooks/<name>.mjs]` lines in in-window logs. */
export async function countHookBlocks(dir, sinceMs, untilMs) {
  const counts = {}
  for (const file of sessionFiles(dir, 'claude', sinceMs, untilMs)) {
    const lines = await readJsonlLines(file)
    if (lines === null) continue
    for (const line of lines) {
      for (const match of line.matchAll(HOOK_BLOCK_RE)) {
        counts[match[1]] = (counts[match[1]] ?? 0) + 1
      }
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
      'commits,createdAt,mergedAt,headRefName,closingIssuesReferences,additions,deletions,statusCheckRollup,labels',
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

function collectFiles(dir, predicate, maxDepth, depth = 0) {
  if (!existsSync(dir) || depth > maxDepth) return []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    // FAIL-OPEN-INTENT: an unreadable session directory contributes no delivery metrics; unavailable source is represented as null by the caller.
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
    } catch {
      // FAIL-OPEN-INTENT: an unstatable session log contributes no delivery metrics; unavailable source is represented as null by the caller.
      return false
    }
  })
}

async function readJsonlLines(file) {
  const lines = []
  try {
    const input = createReadStream(file, { encoding: 'utf-8' })
    const reader = createInterface({ input, crlfDelay: Infinity })
    for await (const line of reader) {
      if (line !== '') lines.push(line)
    }
    return lines
  } catch {
    // FAIL-OPEN-INTENT: an unreadable session log contributes no delivery metrics; unavailable source is represented as null by the caller.
    return null
  }
}

export async function discoverSessions(dir, host, sinceMs, untilMs) {
  const sessions = []
  for (const file of sessionFiles(dir, host, sinceMs, untilMs)) {
    const lines = await readJsonlLines(file)
    if (lines === null) continue
    const meta = host === 'claude' ? claudeSessionMeta(lines) : codexSessionMeta(lines)
    const facts = host === 'claude' ? sessionFacts(lines) : null
    sessions.push({
      ...meta,
      host,
      file,
      events: sessionEvents(lines),
      ...(facts === null
        ? {}
        : { fullGateRuns: facts.fullGateRuns, rounds: facts.rounds, model: facts.model }),
    })
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

function fetchPrRow(repo, number, sessions, worktreeDir, attributedFiles) {
  const pr = fetchPrDetail(repo, number)
  const commits = (pr.commits ?? []).map((c) => ({
    subject: c.messageHeadline,
    authoredDate: c.authoredDate,
    touchedOnlyEvidencePaths: touchedOnlyEvidencePaths(c.oid),
  }))
  // `gh pr view --json` (per #2398 spec's field list) does not include `number` —
  // it's already known from the `pr list` call that produced this PR, so inject it.
  const row = buildPrRow({ ...pr, number }, commits)
  const firstCommit = commits[0]?.authoredDate ?? pr.createdAt
  const attributed = attributeSessions(sessions, {
    ...pr,
    headRefName: pr.headRefName,
    firstCommit,
    mergedAt: pr.mergedAt,
    worktreeDir,
  })
  const attributedMetas = attributed.map(({ meta }) => meta)
  for (const session of attributedMetas) {
    if (session.file) attributedFiles?.add(session.file)
  }
  const enriched = enrichPrRow(row, pr, commits, null)
  const loggedEvents = attributedMetas.flatMap((session) => session.events ?? [])
  if (loggedEvents.length > 0) enriched.leadTimeSplit = splitLeadTime(loggedEvents)
  return mergeDeliverySources(enriched, { ci: ciTiming(pr), sessions: attributedMetas })
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

const KPI_HISTORY_DIR = join(process.cwd(), '.arbiter/evidence/kpi')
const BASELINE_PATH = join(process.cwd(), 'scripts/data/ship-kpi-baseline.json')
const THRESHOLDS_PATH = join(process.cwd(), 'scripts/data/ship-kpi-thresholds.json')
const TUNING_LOG_PATH = join(process.cwd(), 'docs/internal/SYSTEM/SHIP_TUNING_LOG.md')

function historicalRows() {
  if (!existsSync(KPI_HISTORY_DIR)) return []
  const rows = []
  for (const name of readdirSync(KPI_HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    let payload
    try {
      payload = JSON.parse(readFileSync(join(KPI_HISTORY_DIR, name), 'utf-8'))
    } catch {
      // FAIL-OPEN-INTENT: one malformed historical report is excluded; valid reports still provide auditable calibration input and missing measures remain null.
      continue
    }
    if (Array.isArray(payload)) rows.push(...payload)
    else if (Array.isArray(payload?.rows)) rows.push(...payload.rows)
  }
  return rows
}

function tokenTotal(tokens) {
  if (finiteNumber(tokens) !== null) return tokens
  if (!tokens || typeof tokens !== 'object') return null
  const values = ['input', 'output', 'cache'].map((key) => finiteNumber(tokens[key]))
  const present = values.filter((value) => value !== null)
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null
}

function costDelivery(row) {
  const split = row?.leadTimeSplit ?? {}
  const phases = LEAD_TIME_KINDS.map((kind) => finiteNumber(split[kind])).filter(
    (value) => value !== null,
  )
  const fallbackHours = finiteNumber(row?.leadTimeHours)
  const time =
    phases.length > 0 ? Math.max(...phases) : fallbackHours === null ? null : fallbackHours * 3600
  return {
    ...split,
    stratum: row?.stratum ?? null,
    time,
    leadTime: time,
    tokens: tokenTotal(row?.tokens),
  }
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeBaseline(baseline, recalibrate) {
  if (existsSync(BASELINE_PATH) && !recalibrate) {
    throw new Error(`refusing to overwrite ${BASELINE_PATH}; use --recalibrate`)
  }
  mkdirSync(join(BASELINE_PATH, '..'), { recursive: true })
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
}

function runCalibration(opts) {
  const deliveries = historicalRows()
    .map(costDelivery)
    .filter((delivery) => delivery.stratum !== null)
  const baseline = calibrate(deliveries)
  if (Object.keys(baseline).length === 0) {
    throw new Error('no historical deliveries with a stratum; refusing to write an empty baseline')
  }
  writeBaseline(baseline, opts.recalibrate)
  process.stderr.write(`ship-kpi: wrote ${BASELINE_PATH}\n`)
}

function checkpointForRows(rows, stratum, baseline) {
  const selected = rows.filter((row) => row.stratum === stratum).slice(-10)
  const costs = selected.map(costDelivery)
  const indices = costs.map((delivery) => overheadIndices(delivery, baseline))
  const time = quantiles(indices.map((index) => index.time))
  const tokens = quantiles(indices.map((index) => index.tokens))
  const observed = indices
    .flatMap((index) => [index.time, index.tokens])
    .filter((value) => finiteNumber(value) !== null)
  const escapes = selected
    .filter((row) => row.ciRedAtOpen === true || (finiteNumber(row.redCiRuns) ?? 0) > 0)
    .map(() => 'red-ci')
  return {
    n: selected.length,
    indices: { time, tokens },
    buckets: {},
    maxOverhead: observed.length > 0 ? Math.max(...observed) : null,
    escapes: [...new Set(escapes)],
    _selected: selected,
  }
}

function checkpointHistory() {
  if (!existsSync(TUNING_LOG_PATH)) return []
  return readFileSync(TUNING_LOG_PATH, 'utf-8')
    .split('\n')
    .map((line) => /^- verdict: (.+)$/.exec(line)?.[1])
    .filter(Boolean)
}

function ensureTuningLog() {
  if (existsSync(TUNING_LOG_PATH)) return
  mkdirSync(join(TUNING_LOG_PATH, '..'), { recursive: true })
  writeFileSync(
    TUNING_LOG_PATH,
    '# Ship tuning log\n\n<!-- Generated by ship-kpi --checkpoint. -->\n',
  )
}

function runCheckpoint() {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...loadJson(THRESHOLDS_PATH) }
  const baseline = loadJson(BASELINE_PATH)
  const rows = historicalRows()
  const strata = [...new Set(rows.map((row) => row.stratum).filter((stratum) => stratum))].sort()
  const history = checkpointHistory()
  const results = strata.map((stratum) => {
    const current = checkpointForRows(rows, stratum, baseline)
    const previousRows = rows.filter((row) => row.stratum === stratum).slice(-20, -10)
    const previous = checkpointForRows(previousRows, stratum, baseline)
    const verdict = checkpointVerdict({ current, previous, baseline, thresholds, history })
    return {
      date: today(),
      window: { since: current._selected[0]?.mergedAt ?? 'NO DATA', until: today() },
      n: current.n,
      indices: current.indices,
      topBucket: null,
      verdict,
      stratum,
    }
  })
  ensureTuningLog()
  for (const result of results) {
    process.stdout.write(`${result.stratum}: ${result.verdict} (n: ${result.n})\n`)
    appendFileSync(TUNING_LOG_PATH, formatLogEntry(result))
  }
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function renderStratumSummary(rows) {
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
    '| Stratum | n | Lead time median/p90 (h) | Median tokens | Median humanMessages | sourcesKnown |',
    '|---------|---|--------------------------|---------------|----------------------|--------------|',
  ]
  for (const [stratum, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lead = quantiles(group.map((row) => row.leadTimeHours))
    const tokens = quantiles(group.map((row) => tokenTotal(row.tokens)))
    const human = quantiles(group.map((row) => row.humanMessages))
    const coverage = ['ci', 'claude', 'codex']
      .map(
        (source) =>
          `${source} ${group.filter((row) => row.sourcesKnown?.includes(source)).length}/${group.length}`,
      )
      .join(', ')
    lines.push(
      `| ${stratum} | ${group.length} | ${lead.median ?? 'NO DATA'}/${lead.p90 ?? 'NO DATA'} | ${tokens.median ?? 'NO DATA'} | ${human.median ?? 'NO DATA'} | ${coverage} |`,
    )
  }
  return lines
}

export function renderMarkdown({ since, until, rows, aggregate, hookBlocks, unattributed }) {
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
  lines.push('', ...renderStratumSummary(rows))
  lines.push(
    `unattributed: claude ${unattributed?.claude ?? 0} / codex ${unattributed?.codex ?? 0} across ${unattributed?.sessions ?? 0} sessions`,
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
    runCheckpoint()
    return
  }

  if (!opts.since) {
    process.stderr.write(
      'usage: ship-kpi --since <date> [--until <date>] [--repo owner/name] [--json <path>] [--sessions <dir>] [--codex-sessions <dir>]\n' +
        '       ship-kpi --calibrate [--recalibrate]\n' +
        '       ship-kpi --checkpoint\n' +
        '       checkpoint verdicts: NO DATA | ANDON | ROLLBACK | RETHINK | TUNE <bucket> | PLATEAU | HOLD\n' +
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
  const attributedFiles = new Set()
  const rows = prNumbers.map((n) =>
    fetchPrRow(opts.repo, n, sessions, process.cwd(), attributedFiles),
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

  const hookBlocks = await countHookBlocks(opts.sessions, sinceMs, untilMs)

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
    name: 'overheadIndices compares the largest delivery phase',
    run: () =>
      overheadIndices(
        { stratum: 'Standard', ci: 40, tokens: 200 },
        { Standard: { timeMedian: 20, tokensMedian: 100 } },
      ).time === 2,
    expected: true,
  },
  {
    name: 'calibrate caps each stratum at thirty deliveries',
    run: () => calibrate([{ stratum: 'XS-S', time: 10, tokens: 20 }])['XS-S']?.n === 1,
    expected: true,
  },
  {
    name: 'checkpointVerdict returns NO DATA below the checkpoint minimum',
    run: () =>
      checkpointVerdict({ current: { n: 1 }, thresholds: DEFAULT_THRESHOLDS }) === 'NO DATA',
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
          maxOverhead: 1.2,
          escapes: [],
        },
        thresholds: DEFAULT_THRESHOLDS,
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
