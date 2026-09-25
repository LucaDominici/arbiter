#!/usr/bin/env node
// Arbiter hook: phase-aware TDD evidence gate (#2383)
// Hook type: Stop — retrospectively blocks after an implementation edit unless the
// edit precedes a successful Skill(tdd) result in the active phase or, in green/refactor, a
// committed valid RED receipt covers it (#2861). Plan, docs/** and *.md edits are exempt.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { claudeTranscriptIdentityError, getRepoRoot } from './lib.mjs'

const IMPLEMENTATION_PHASES = new Set(['red', 'green', 'refactor'])
const KNOWN_PHASES = new Set([
  'preflight',
  'plan',
  'red',
  'green',
  'refactor',
  'verification',
  'close',
  'complete',
])
const EDIT_TOOLS = new Set(['edit', 'write', 'notebookedit', 'multiedit'])
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024
const MAX_TRANSCRIPT_LINES = 100000
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
const TASK_ID = /^#\d+$/

// #2861 AC-1: the receipt rules of the emitted check-tdd-evidence validator, shared verbatim.
const FAILURE_SIGNATURES = [
  /(?<=^[ \t]*)FAIL[ \t]+(?:\|[^|\n]+\|[ \t]+)?\S+\.test\.[jt]sx?/m, // vitest (a test.projects |label| too, #2516)
  /(?<=^[ \t]*)FAIL[ \t]+(?:\|[^|\n]+\|[ \t]+)?\S+\.(spec|test)\.[jt]sx?/m, // jest
  /\d+ scenarios? \(\d+ failed/m, // cucumber
  /={3,}\s*FAILURES\s*={3,}/m, // pytest
  /FAILED\s*$|BUILD FAILED/m, // gradle
  /test[ ]result: FAILED/m, // cargo
  /--- FAIL:/m, // go
  /^[ \t]*FAIL:[ \t]+\S.*$/m, // shell self-test
  /^# fail [1-9]\d*/m, // tap (node:test)
  /^\s*[1-9]\d* failed\b/m, // playwright line/list reporter ("  1 failed")
]
const hasFailureSignature = (log) => FAILURE_SIGNATURES.some((re) => re.test(log))

/** Plain-JS mirror of the TddEvidenceV1 schema — returns { ok, reason }. */
function validateSchema(ev) {
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'evidence is not an object' }
  if (ev.$schemaVersion !== 1) return { ok: false, reason: '$schemaVersion must be 1' }
  if (typeof ev.task_id !== 'string' || !/^#\d+$/.test(ev.task_id))
    return { ok: false, reason: 'task_id must match /^#\\d+$/' }
  if (typeof ev.test_path !== 'string' || ev.test_path.length === 0)
    return { ok: false, reason: 'test_path must be a non-empty string' }
  if (typeof ev.test_commit_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(ev.test_commit_sha))
    return { ok: false, reason: 'test_commit_sha must be 40 hex characters' }
  if (typeof ev.test_run_log !== 'string')
    return { ok: false, reason: 'test_run_log must be a string' }
  if (typeof ev.observed_failure !== 'string' || ev.observed_failure.length === 0)
    return { ok: false, reason: 'observed_failure must not be empty' }
  if (typeof ev.recorded_at !== 'string' || Number.isNaN(Date.parse(ev.recorded_at)))
    return { ok: false, reason: 'recorded_at must be an ISO8601 datetime' }
  return { ok: true }
}

/**
 * #2116: REACHABILITY, not object existence. `cat-file -e` passes for any object still
 * present in the repo — including the pre-rebase commit of a branch that was rebased
 * before merging, whose evidence then "verifies" against history nobody can reach, and
 * turns unverifiable the day the stale branch is deleted. A rebase must fail loudly here
 * (re-record the evidence) instead of silently passing.
 */
function shaExists(sha) {
  try {
    git(['merge-base', '--is-ancestor', sha, 'HEAD'])
    return true
  } catch {
    return false
  }
}

const root = getRepoRoot()
const git = (args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
const input = readHookInput()
if (input === null) process.exit(0)
if (typeof input.session_id !== 'string' || !SESSION_ID.test(input.session_id)) {
  block('parseable hook input has no valid session_id')
}
const state = readPhaseState(root)
if (state.error) block(state.error)
if (!IMPLEMENTATION_PHASES.has(state.phase)) process.exit(0)
const transcript = readTranscript(input, root)
if (transcript === null) process.exit(0)
const verdict = inspectTranscript(transcript, state)
if (verdict.error) block(verdict.error)
if (verdict.lastEditId === null) process.exit(0)
if (state.phase !== 'red' && receiptVerified(state.taskId)) process.exit(0)
// #2861 AC-6: the host re-runs Stop after a block; the same edit of the same task, phase and
// transcript was already reported.
const marker = join(root, '.claude', '.task', `skill-forced-eval-${input.session_id}.json`)
const blocked = {
  taskId: state.taskId,
  phase: state.phase,
  transcriptPath: input.transcript_path,
  lastEditId: verdict.lastEditId,
}
if (input.stop_hook_active === true && readBlockedEdit(marker) === JSON.stringify(blocked)) {
  process.exit(0)
}
writeBlockedEdit(marker, blocked)
block(
  `phase ${state.phase} contains an implementation edit made before any successful Skill(tdd) result in the phase`,
)

function readHookInput() {
  let raw
  try {
    raw = readFileSync(0, 'utf-8')
  } catch {
    // FAIL-OPEN-INTENT: the host did not provide stdin, so no current-turn evidence can be read.
    return null
  }
  if (!raw.trim()) return null

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // FAIL-OPEN-INTENT: non-JSON stdin is an unavailable Claude hook envelope.
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    block('parseable hook input is not an object')
  }
  return parsed
}

function readPhaseState(repoRoot) {
  const path = join(repoRoot, '.claude', '.task', 'status.json')
  if (!existsSync(path)) return { phase: 'unknown' }

  let state
  try {
    state = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { error: 'task state is unreadable; repair .claude/.task/status.json before editing' }
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { error: 'task state is not a JSON object; repair .claude/.task/status.json' }
  }

  const rawPhase = state.phase
  if (rawPhase === undefined || rawPhase === 'unknown') return { phase: 'unknown' }
  if (typeof rawPhase !== 'string') {
    return { error: 'task state phase is not a string; repair .claude/.task/status.json' }
  }
  const phase = rawPhase === 'implementation' ? 'red' : rawPhase
  // FAIL-OPEN-INTENT: a newer task phase is outside this hook's contract; the phase gate stands down
  // until the hook learns it, while the task/gate lifecycle remains authoritative.
  if (!KNOWN_PHASES.has(phase)) return { phase: 'unknown' }
  if (!IMPLEMENTATION_PHASES.has(phase)) return { phase }

  const timestamps = state.timestamps
  if (!timestamps || typeof timestamps !== 'object' || Array.isArray(timestamps)) {
    return { error: `task state has no timestamp for active phase ${phase}` }
  }
  const timestamp = timestamps[rawPhase] ?? timestamps[phase]
  const startedAt = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
  if (Number.isNaN(startedAt))
    return { error: `task state timestamp for phase ${phase} is invalid` }
  return {
    phase,
    startedAt,
    taskId: typeof state.taskId === 'string' ? state.taskId : '',
    plan: typeof state.plan === 'string' ? state.plan : '',
  }
}

function readTranscript(event, repoRoot) {
  const path = event.transcript_path
  if (typeof path !== 'string' || path.length === 0) {
    // FAIL-OPEN-INTENT: Claude may omit transcript_path on hosts without local transcript access.
    return null
  }
  if (!existsSync(path)) return null
  const identityError = claudeTranscriptIdentityError(event, repoRoot)
  if (identityError) block(identityError)

  let raw
  try {
    const size = statSync(path).size
    if (size > MAX_TRANSCRIPT_BYTES) block(`transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`)
    raw = readFileSync(path, 'utf-8')
  } catch (error) {
    if (error?.code === 'ELOOP') block('transcript_path contains a symlink loop')
    // FAIL-OPEN-INTENT: absent or unavailable host transcript cannot be correlated by this hook.
    return null
  }
  const lineCount = raw.split('\n').length
  if (lineCount > MAX_TRANSCRIPT_LINES) block(`transcript exceeds ${MAX_TRANSCRIPT_LINES} lines`)
  return raw
}

function inspectTranscript(raw, { startedAt, plan }) {
  const lines = raw.split('\n')
  const lastNonEmpty = lines.reduce((last, line, index) => (line.trim() ? index : last), -1)
  const uses = new Map()
  const results = new Map()

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].trim()
    if (!text) continue

    let record
    try {
      record = JSON.parse(text)
    } catch {
      if (index === lastNonEmpty) continue
      return { error: `transcript record ${index + 1} is malformed` }
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { error: `transcript record ${index + 1} is not an object` }
    }

    const content = record.message?.content
    if (!Array.isArray(content)) continue
    for (const blockValue of content) {
      if (!blockValue || typeof blockValue !== 'object' || Array.isArray(blockValue)) {
        return { error: `transcript record ${index + 1} contains an invalid content block` }
      }
      if (blockValue.type === 'tool_use') {
        if (record.message?.role !== 'assistant') {
          return {
            error: `transcript record ${index + 1} has a tool call outside an assistant message`,
          }
        }
        if (typeof blockValue.id !== 'string' || blockValue.id.trim() === '') {
          return { error: `transcript record ${index + 1} has a tool call without an id` }
        }
        if (typeof blockValue.name !== 'string' || blockValue.name.trim() === '') {
          return { error: `transcript record ${index + 1} has a tool call without a name` }
        }
        if (uses.has(blockValue.id)) return { error: `transcript repeats tool id ${blockValue.id}` }
        const tool = blockValue.name.toLowerCase()
        const timestamp = EDIT_TOOLS.has(tool) || tool === 'skill' ? parseTimestamp(record) : null
        if ((EDIT_TOOLS.has(tool) || tool === 'skill') && timestamp === null) {
          return { error: `transcript record ${index + 1} has an invalid tool timestamp` }
        }
        uses.set(blockValue.id, { tool, input: blockValue.input, timestamp, sequence: index })
      } else if (blockValue.type === 'tool_result') {
        if (record.message?.role !== 'user') {
          return {
            error: `transcript record ${index + 1} has a tool result outside a user message`,
          }
        }
        if (typeof blockValue.tool_use_id !== 'string' || blockValue.tool_use_id.trim() === '') {
          return { error: `transcript record ${index + 1} has a tool result without an id` }
        }
        if (results.has(blockValue.tool_use_id)) {
          return { error: `transcript repeats result id ${blockValue.tool_use_id}` }
        }
        const use = uses.get(blockValue.tool_use_id)
        if (!use) return { error: `transcript result precedes or has no matching tool call` }
        if (blockValue.is_error !== undefined && typeof blockValue.is_error !== 'boolean') {
          return { error: `transcript result for ${blockValue.tool_use_id} has invalid is_error` }
        }
        results.set(blockValue.tool_use_id, { ok: blockValue.is_error !== true, sequence: index })
      }
    }
  }

  // #2861 AC-4: a successful Skill(tdd) forgives only the edits CALLED after its result (#2383
  // ordering: edit call vs skill result). An edit called before, or while the skill is in flight,
  // still counts unless a committed receipt covers the phase.
  let skillResultAt = Infinity
  for (const [id, result] of results) {
    const use = uses.get(id)
    if (!result.ok || use.timestamp < startedAt || use.tool !== 'skill') continue
    if (use.input?.skill?.toLowerCase?.() === 'tdd')
      skillResultAt = Math.min(skillResultAt, result.sequence)
  }
  let lastEditId = null
  for (const [id, result] of results) {
    const use = uses.get(id)
    if (!result.ok || use.timestamp < startedAt || !EDIT_TOOLS.has(use.tool)) continue
    if (use.sequence <= skillResultAt && !exemptEdit(use.input, plan)) lastEditId = id
  }
  return { lastEditId }
}

/**
 * Plan, docs/** and *.md edits inside the repo are not implementation edits (#2861 AC-2),
 * judged by the REAL path: a symlink, or a path that does not resolve, still counts.
 */
function exemptEdit(toolInput, plan) {
  const path = toolInput?.file_path ?? toolInput?.notebook_path
  if (typeof path !== 'string' || path.length === 0) return false
  let rel
  try {
    const target = resolve(root, path)
    if (lstatSync(target).isSymbolicLink()) return false
    rel = relative(realpathSync(root), realpathSync(target))
  } catch {
    return false
  }
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false
  const normalized = rel.split('\\').join('/')
  return normalized === plan || normalized.split('/')[0] === 'docs' || normalized.endsWith('.md')
}

/**
 * #2861 AC-1: the receipt COMMITTED at HEAD (an untracked file proves nothing), checked in
 * process with the validator's rules: schema, task binding, RED signature, a RED commit
 * reachable from HEAD and the test path in it. Any error fails closed into the block.
 */
function receiptVerified(taskId) {
  if (!TASK_ID.test(taskId)) return false
  try {
    const ev = JSON.parse(git(['show', `HEAD:.arbiter/evidence/tdd/${taskId}.json`]))
    return (
      validateSchema(ev).ok &&
      ev.task_id === taskId &&
      hasFailureSignature(ev.test_run_log) &&
      shaExists(ev.test_commit_sha) &&
      git(['ls-tree', '--name-only', ev.test_commit_sha, ev.test_path]).length > 0
    )
  } catch {
    return false
  }
}

function readBlockedEdit(path) {
  try {
    return JSON.stringify(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    return null
  }
}

function writeBlockedEdit(path, blocked) {
  try {
    writeFileSync(path, JSON.stringify(blocked) + '\n')
  } catch {
    // FAIL-OPEN-INTENT: the caller blocks regardless; an unwritable marker only costs one
    // extra block on the host's stop_hook_active re-run.
  }
}

function parseTimestamp(record) {
  if (typeof record.timestamp !== 'string') return null
  const timestamp = Date.parse(record.timestamp)
  return Number.isNaN(timestamp) ? null : timestamp
}

function block(reason) {
  process.stderr.write(
    `[skill-forced-eval] blocked: ${reason}\n` +
      `In green/refactor, commit a valid RED receipt (arbiter lifecycle record-red); otherwise\n` +
      `run /tdd and wait for its successful result before the next implementation edit; then run npm test.\n`,
  )
  process.exit(2)
}
