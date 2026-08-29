#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: spawn-time worktree guard (E5, #1947, design doc §E5).
// Fires on: PreToolUse → Task|Agent (sub-agent dispatch)
// Exit 2 (hard grading only): block — stderr returned to Claude as error context
// Exit 0: advisory (soft grading, default) — same stderr warning, does not block
//
// ACTIVATED advisory per OD-14 (2026-07-17): wired into .claude/settings.json's
// PreToolUse matchers at soft/advisory grading by default. Set
// ARBITER_SPAWN_GUARD_HARD=1 to promote to hard (exit 2) blocking, mirroring
// stop-finding-loss.mjs's advisory/hard knob (see docs/design/anti-context-rot-enforcers.md §E5).
//
// Mechanically flags (advisory) or refuses (hard) spawning a second write-intent
// sub-agent into the main working tree — the one failure mode with a confirmed
// real incident (R3, 2026-03-01). Also carries the M2 one-task-per-dispatch check.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getRepoRoot, SIDECAR_PATH, readJsonOrNull, pruneStaleSidecarEntries } from './lib.mjs'

const WRITE_CLASSES_PATH = join('.claude', 'agents', 'agent-write-classes.json')

/** Loads the {agent: "read-only"|"write-intent"} classification map, root-relative. */
function loadWriteClasses(root) {
  const doc = readJsonOrNull(join(root, WRITE_CLASSES_PATH))
  return doc && typeof doc.classes === 'object' && doc.classes !== null ? doc.classes : {}
}

/** True when cwd sits under a `<name>.worktrees/` sibling directory (any depth). */
function isWorktreeCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  return /(^|[/\\])[^/\\]+\.worktrees([/\\]|$)/.test(cwd)
}

function countTaskIds(prompt) {
  if (typeof prompt !== 'string') return 0
  const matches = prompt.match(/#\d+/g)
  return matches ? new Set(matches).size : 0
}

function main() {
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf-8')) ?? {}
    // FAIL-OPEN-INTENT: unreadable/non-JSON stdin — a guard that cannot read the dispatch payload must not block an unrelated tool call.
  } catch {
    process.exit(0)
  }

  const toolInput = input.tool_input ?? {}
  const subagentType = toolInput.subagent_type
  const isolation = toolInput.isolation
  const cwd = toolInput.cwd
  const prompt = toolInput.prompt

  const root = getRepoRoot()
  const writeClasses = loadWriteClasses(root)

  // 1. Classify write-intent. Unknown type => write-intent (fail-closed).
  const classification =
    typeof subagentType === 'string' && writeClasses[subagentType] === 'read-only'
      ? 'read-only'
      : 'write-intent'

  if (classification === 'read-only') process.exit(0) // M7 firewall path stays frictionless

  // 2. Write-intent path: allowed iff isolated in a worktree.
  const inWorktree = isolation === 'worktree' || isWorktreeCwd(cwd)

  const HARD_GRADING = process.env.ARBITER_SPAWN_GUARD_HARD === '1'

  const sidecarPath = join(root, SIDECAR_PATH)
  const now = Date.now()
  const existing = readJsonOrNull(sidecarPath)
  const entries = pruneStaleSidecarEntries(Array.isArray(existing) ? existing : [], now)

  if (!inWorktree && entries.length > 0) {
    const message =
      `[arbiter] SPAWN GUARD: a write-intent agent is already active on the main working tree.\n` +
      `Second write-agent on the main tree is blocked — open a worktree: \`/wt-open\` (ADR-103).\n`
    if (HARD_GRADING) {
      process.stderr.write(message)
      process.exit(2)
    }
    process.stderr.write(message) // advisory: soft grading always exits 0
    process.exit(0)
  }

  // 3. One-task-per-dispatch (M2): count distinct #NNN ids in the prompt. Checked
  // BEFORE registering the sidecar entry — a rejected spawn must never occupy a slot
  // (#2403: registering first let a rejected M2 spawn wedge the 2h TTL for nothing).
  const taskIdCount = countTaskIds(prompt)
  if (taskIdCount > 1) {
    const message =
      `[arbiter] SPAWN GUARD: dispatch prompt references ${taskIdCount} distinct task ids — ` +
      `one-task-per-dispatch (M2) requires exactly one.\n`
    if (HARD_GRADING) {
      process.stderr.write(message)
      process.exit(2)
    }
    process.stderr.write(message) // advisory: soft grading always exits 0
    process.exit(0)
  }

  // No other writer on the main tree, no M2 violation — allow and register.
  const updated = [
    ...entries,
    { agent: subagentType ?? 'unknown', ts: now, pid: process.pid, cwd: cwd ?? root },
  ]
  try {
    mkdirSync(join(root, '.arbiter'), { recursive: true })
    writeFileSync(sidecarPath, JSON.stringify(updated, null, 2) + '\n')
    // FAIL-OPEN-INTENT: best-effort bookkeeping — a sidecar write failure must not block a legal spawn.
  } catch {
    void 0
  }

  process.exit(0)
}

// Top-level guard: an unexpected crash in main() must fail closed (exit 1), never fall
// through to the shell's default success exit code, which a hook harness would read as allow.
try {
  main()
} catch (err) {
  process.stderr.write(
    `[arbiter] SPAWN GUARD: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
