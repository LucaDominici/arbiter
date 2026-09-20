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
import {
  getRepoRoot,
  isGitWorktree,
  SIDECAR_PATH,
  nativeHostBindingError,
  readJsonOrNull,
  pruneStaleSidecarEntries,
  withSidecarLock,
} from './lib.mjs'

const WRITE_CLASSES_PATH = join('.claude', 'agents', 'agent-write-classes.json')

/** Loads the {agent: "read-only"|"write-intent"} classification map, root-relative. */
function loadWriteClasses(root) {
  const doc = readJsonOrNull(join(root, WRITE_CLASSES_PATH))
  return doc && typeof doc.classes === 'object' && doc.classes !== null ? doc.classes : {}
}

/**
 * The pid that outlives this hook (#2588): Claude Code runs hooks as `/bin/sh -c "node …"`, so
 * process.pid and process.ppid exit with the hook; CLAUDE_PID names the session process.
 * Absent, malformed, or naming this hook or its launcher ⇒ undefined, and the sidecar entry is
 * age-only — a transient pid would be pruned at once and silently disable the guard.
 */
function sessionPid() {
  const pid = Number(process.env.CLAUDE_PID)
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  return pid === process.pid || pid === process.ppid ? undefined : pid
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
  const HARD_GRADING = process.env.ARBITER_SPAWN_GUARD_HARD === '1'
  const bindingError = nativeHostBindingError(input, root)
  if (bindingError) {
    process.stderr.write(
      `[arbiter] SPAWN GUARD: ${bindingError}; run arbiter lifecycle preflight from the exact worktree session.\n`,
    )
    process.exit(HARD_GRADING ? 2 : 0)
  }
  const writeClasses = loadWriteClasses(root)

  // 1. Classify write-intent. Unknown type => write-intent (fail-closed).
  const classification =
    typeof subagentType === 'string' && writeClasses[subagentType] === 'read-only'
      ? 'read-only'
      : 'write-intent'

  if (classification === 'read-only') process.exit(0) // M7 firewall path stays frictionless

  // 2. Write-intent path: allowed iff isolated in a worktree.
  const inWorktree = isolation === 'worktree' || isGitWorktree(cwd ?? root)

  const sidecarPath = join(root, SIDECAR_PATH)
  const now = Date.now()
  try {
    const rejection = withSidecarLock(root, () => {
      const existing = readJsonOrNull(sidecarPath)
      const entries = pruneStaleSidecarEntries(Array.isArray(existing) ? existing : [], now)
      if (!inWorktree && entries.length > 0) {
        return (
          `[arbiter] SPAWN GUARD: a write-intent agent is already active on the main working tree.\n` +
          `Active entries read from ${sidecarPath} — that file, not the main checkout's, holds the block.\n` +
          `Second write-agent on the main tree is blocked — open a worktree: \`/wt-open\` (ADR-103).\n`
        )
      }
      const taskIdCount = countTaskIds(prompt)
      if (taskIdCount > 1) {
        return (
          `[arbiter] SPAWN GUARD: dispatch prompt references ${taskIdCount} distinct task ids — ` +
          `one-task-per-dispatch (M2) requires exactly one.\n`
        )
      }
      const updated = [
        ...entries,
        { agent: subagentType ?? 'unknown', ts: now, pid: sessionPid(), cwd: cwd ?? root },
      ]
      writeFileSync(sidecarPath, JSON.stringify(updated, null, 2) + '\n')
      return null
    })
    if (rejection !== null) {
      process.stderr.write(rejection)
      process.exit(HARD_GRADING ? 2 : 0)
    }
  } catch (err) {
    process.stderr.write(`[arbiter] SPAWN GUARD: ${err.message}\n`)
    process.exit(2)
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
