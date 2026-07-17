#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: spawn-time worktree guard (E5, #1947, design doc §E5).
// Fires on: PreToolUse → Task|Agent (sub-agent dispatch)
// Exit 2: block — stderr returned to Claude as error context
//
// IMPLEMENT-BUT-NOT-ACTIVATED (OD-14): this file is emitted and tested but
// is NOT wired into .claude/settings.json's PreToolUse matchers. A live
// PreToolUse interceptor on Task|Agent could wedge the running harness's own
// sub-agent dispatch path — activation (adding the matcher block) is an
// explicit owner decision, not bundled with this implementation. To activate:
// add a PreToolUse group with `"matcher": "Task|Agent"` routing to this hook
// in .claude/settings.json (and the emitted twin
// src/templates/claude/settings.json.ejs), then promote INV-139 in
// src/invariants/catalog.ts + AGENTS.md (see docs/design/anti-context-rot-enforcers.md §E5).
//
// Mechanically refuses to spawn a second write-intent sub-agent into the main
// working tree — the one failure mode with a confirmed real incident (R3,
// 2026-03-01). Also carries the M2 one-task-per-dispatch check.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getRepoRoot } from './lib.mjs'

const WRITE_CLASSES_PATH = join('.claude', 'agents', 'agent-write-classes.json')
const SIDECAR_PATH = join('.arbiter', 'agents-active.json')
const SIDECAR_TTL_MS = 2 * 60 * 60 * 1000 // 2h — mirrors `arbiter worktree prune --stale`

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
    // FAIL-OPEN-INTENT: missing/malformed classification or sidecar file — caller treats null as "no data" and proceeds fail-closed on write-intent.
  } catch {
    return null
  }
}

/** Loads the {agent: "read-only"|"write-intent"} classification map, root-relative. */
function loadWriteClasses(root) {
  const doc = readJson(join(root, WRITE_CLASSES_PATH))
  return doc && typeof doc.classes === 'object' && doc.classes !== null ? doc.classes : {}
}

/** True when cwd sits under a `<name>.worktrees/` sibling directory (any depth). */
function isWorktreeCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  return /(^|[/\\])[^/\\]+\.worktrees([/\\]|$)/.test(cwd)
}

/** Drops sidecar entries older than SIDECAR_TTL_MS so a killed agent cannot wedge future spawns. */
function pruneStale(entries, now) {
  return entries.filter((e) => now - Number(e.ts ?? 0) < SIDECAR_TTL_MS)
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

  const sidecarPath = join(root, SIDECAR_PATH)
  const now = Date.now()
  const existing = readJson(sidecarPath)
  let entries = pruneStale(Array.isArray(existing) ? existing : [], now)

  if (!inWorktree && entries.length > 0) {
    process.stderr.write(
      `[arbiter] SPAWN GUARD: a write-intent agent is already active on the main working tree.\n` +
        `Second write-agent on the main tree is blocked — open a worktree: \`/wt-open\` (ADR-103).\n`,
    )
    process.exit(2)
  }

  // No other writer on the main tree, or this spawn is worktree-isolated — allow and register.
  entries = [
    ...entries,
    { agent: subagentType ?? 'unknown', ts: now, pid: process.pid, cwd: cwd ?? root },
  ]
  try {
    mkdirSync(join(root, '.arbiter'), { recursive: true })
    writeFileSync(sidecarPath, JSON.stringify(entries, null, 2) + '\n')
    // FAIL-OPEN-INTENT: best-effort bookkeeping — a sidecar write failure must not block a legal spawn.
  } catch {
    void 0
  }

  // 3. One-task-per-dispatch (M2): count distinct #NNN ids in the prompt.
  const taskIdCount = countTaskIds(prompt)
  if (taskIdCount > 1) {
    process.stderr.write(
      `[arbiter] SPAWN GUARD: dispatch prompt references ${taskIdCount} distinct task ids — ` +
        `one-task-per-dispatch (M2) requires exactly one.\n`,
    )
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
