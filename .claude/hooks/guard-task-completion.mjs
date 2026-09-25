#!/usr/bin/env node
// Arbiter hook: hard-block premature task-completion claims
// Hook type: Stop — fires when the agent finishes responding
// Hard block (exit 2) — returns stderr to Claude as error context
// Reads .claude/.task/status.json + assistant text to detect early "complete" declarations
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readStopAssistantText } from './lib.mjs'

function getRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  })
  if (result.status === 0 && result.stdout) return result.stdout.trim()
  process.stderr.write('guard-task-completion: git rev-parse failed, falling back to cwd\n')
  return process.cwd()
}

function readTaskState(root) {
  const statusPath = join(root, '.claude', '.task', 'status.json')
  let state = {}
  if (existsSync(statusPath)) {
    try {
      state = JSON.parse(readFileSync(statusPath, 'utf-8'))
    } catch (err) {
      // Fail visibly: a corrupt document silently disarms this guard, so warn rather than
      // treat corruption as a fresh tree.
      process.stderr.write(
        `[arbiter] warn: ${statusPath} is unreadable (${err.message}); treating task state as unknown.\n`,
      )
      state = {}
    }
  }
  const pick = (v) => (typeof v === 'string' && v.length > 0 ? v : 'unknown')
  return {
    taskId: pick(state.taskId),
    phase: pick(state.phase),
    tier: pick(state.tier),
  }
}

// .arbiter/agents-dispatched.json, bound to the task that wrote it
function readDispatched(root, taskId) {
  const p = join(root, '.arbiter', 'agents-dispatched.json')
  if (!existsSync(p)) return 0
  try {
    const s = JSON.parse(readFileSync(p, 'utf-8'))
    return s && s.taskId === taskId && Number.isInteger(s.count) ? s.count : 0
  } catch {
    return 0 // unreadable = none dispatched, never "met"
  }
}

// status.json treatment.finalReviewers, or null when no treatment is persisted
function readPanelTotal(root) {
  try {
    const s = JSON.parse(readFileSync(join(root, '.claude', '.task', 'status.json'), 'utf-8'))
    const n = s?.treatment?.finalReviewers
    return n === 1 || n === 2 || n === 3 ? n : null
  } catch {
    return null
  }
}

function readMarker(path) {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

const root = getRepoRoot()
const { taskId, phase, tier } = readTaskState(root)

// Only guard during implementation phases (red/green/refactor) or verification
const IMPL_PHASES = new Set(['red', 'green', 'refactor', 'verification'])
if (!IMPL_PHASES.has(phase)) process.exit(0)

let input
try {
  input = JSON.parse(readFileSync(process.stdin.fd, 'utf-8')) ?? {} // Stop envelope from stdin
} catch {
  process.exit(0)
}
const claimText = readStopAssistantText(input, root)
if (claimText === null) process.exit(0)

// Completion claim patterns
const COMPLETION_PATTERNS =
  /\b(task (is )?(complete|completed|done|finished)|task complete|task completed|all phases complete|work is (done|complete)|implementation (is )?(complete|done|finished)|pr merged|merged to main|wrapping up|ready to (merge|close)|shipped)\b/i
if (!COMPLETION_PATTERNS.test(claimText)) process.exit(0)

// Completion claimed before the task reached the complete phase.
const dispatched = readDispatched(root, taskId)
const panelTotal = readPanelTotal(root)

const warnings = []
warnings.push(`- phase: ${phase} (must be complete before claiming completion)`)
if (panelTotal === null) {
  warnings.push('- ship treatment: not persisted in .claude/.task/status.json (run arbiter ship)')
} else if (dispatched < panelTotal) {
  warnings.push(`- agents-dispatched: ${dispatched} (minimum ${panelTotal} for treatment ${tier})`)
}

// Check TDD evidence when ARBITER_SKIP_TDD is not set (or is not '1' for non-L1)
const skipTdd = process.env.ARBITER_SKIP_TDD === '1'
if (!skipTdd && taskId !== 'unknown') {
  const evidencePath = join(root, '.arbiter', 'evidence', 'tdd', `${taskId}.json`)
  if (!existsSync(evidencePath)) {
    warnings.push(
      `- TDD evidence missing at ${evidencePath} — run \`arbiter lifecycle record-red --test-path <path>\` first`,
    )
  }
}

// #2861-style re-entry marker, session-bound: skip the re-block only when the
// recomputed payload matches what was already reported for this session.
const sid =
  typeof input.session_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.session_id)
    ? input.session_id
    : null
if (sid !== null) {
  const marker = join(root, '.claude', '.task', `guard-task-completion-${sid}.json`)
  const blocked = JSON.stringify({
    taskId,
    phase,
    transcriptPath: input.transcript_path ?? null,
    claimHash: createHash('sha256').update(claimText).digest('hex'),
    dispatched,
    panelTotal,
  })
  if (input.stop_hook_active === true && readMarker(marker) === blocked) process.exit(0)
  // FAIL-OPEN-INTENT: an unwritable marker costs one extra block, never one fewer.
  try {
    writeFileSync(marker, blocked)
  } catch {
    /* swallow */
  }
}

process.stderr.write(
  `━━━ COMPLETION GUARD ━━━\n` +
    `Premature task-completion claim detected.\n` +
    `Missing evidence:\n${warnings.join('\n')}\n\n` +
    `Required before completion: record TDD evidence, resolve review/verifier findings, run node scripts/check-all.mjs L2, commit, push, merge PR, then set phase=complete.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
)
process.exit(2)
