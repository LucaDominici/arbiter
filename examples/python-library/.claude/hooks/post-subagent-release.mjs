#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: post-subagent sidecar release, companion to
// pre-spawn-worktree-guard.mjs (E5, #1947, #2403).
// Fires on: SubagentStop
// Exit: always 0 — this is best-effort bookkeeping cleanup, never a blocking gate.
//
// pre-spawn-worktree-guard.mjs registers a `.arbiter/agents-active.json` entry for
// every allowed write-intent spawn; without a companion cleanup an agent that
// finishes normally still occupies its slot for the full 2h TTL, which can wedge
// the next legitimate spawn on the main tree (#2403).
//
// Correlation caveat: the Claude Code `SubagentStop` stdin payload is not documented
// to carry the finished dispatch's `subagent_type` or its Task/Agent-time `cwd` — the
// published hooks reference lists only common fields (session_id, cwd, hook_event_name,
// transcript_path), and `cwd` there is the session's, not necessarily the spawned
// agent's isolated worktree. This hook reads whatever identifying fields ARE present
// on the payload (`agent`/`subagent_type`/`agent_type`, `cwd`) and removes the OLDEST
// sidecar entry matching them; matching degrades gracefully as those fields go missing
// (cwd-only, then a no-op prune). The 2h TTL in pre-spawn-worktree-guard.mjs remains
// the backstop for whatever this correlation cannot catch.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getRepoRoot, SIDECAR_PATH, readJsonOrNull, pruneStaleSidecarEntries } from './lib.mjs'

function main() {
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf-8')) ?? {}
    // FAIL-OPEN-INTENT: unreadable/non-JSON stdin — cleanup bookkeeping must never block SubagentStop.
  } catch {
    process.exit(0)
  }

  const agentKey = input.agent ?? input.subagent_type ?? input.agent_type ?? undefined
  const cwdKey = typeof input.cwd === 'string' && input.cwd.length > 0 ? input.cwd : undefined

  const root = getRepoRoot()
  const sidecarPath = join(root, SIDECAR_PATH)
  const now = Date.now()
  const existing = readJsonOrNull(sidecarPath)
  const entries = pruneStaleSidecarEntries(Array.isArray(existing) ? existing : [], now)

  if (cwdKey !== undefined) {
    // Remove the OLDEST entry matching this dispatch (agent+cwd when the agent is
    // known, else cwd alone) — SubagentStop carries no stable per-dispatch id to
    // correlate exactly, so FIFO-by-ts is the best available tie-break.
    let removeAt = -1
    let oldestTs = Infinity
    entries.forEach((e, i) => {
      const matches = e.cwd === cwdKey && (agentKey === undefined || e.agent === agentKey)
      if (matches && Number(e.ts ?? 0) < oldestTs) {
        oldestTs = Number(e.ts ?? 0)
        removeAt = i
      }
    })
    if (removeAt !== -1) entries.splice(removeAt, 1)
  }

  try {
    mkdirSync(join(root, '.arbiter'), { recursive: true })
    writeFileSync(sidecarPath, JSON.stringify(entries, null, 2) + '\n')
    // FAIL-OPEN-INTENT: best-effort bookkeeping — a sidecar write failure must never block Stop.
  } catch {
    void 0
  }

  process.exit(0)
}

// Top-level guard: an unexpected crash in main() must fail closed loudly (exit 1) so a
// real bug surfaces in logs, never fall through to the shell's default success exit code.
try {
  main()
} catch (err) {
  process.stderr.write(
    `[arbiter] SUBAGENT RELEASE: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
