#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: finding-loss detector (E6b, #1948, design doc §E6b).
// Fires on: Stop
// Exit 2 (hard grading only): re-prompts the model to persist findings before stopping.
// Exit 0: advisory (soft grading) or nothing to flag.
//
// IMPLEMENT-BUT-NOT-ACTIVATED (OD-14): this file is emitted and tested but is
// NOT wired into .claude/settings.json's Stop chain. A live Stop interceptor
// could interfere with the running harness's own Stop handling — activation
// (adding the registration alongside stop-evidence-guard.mjs) is an explicit
// owner decision, not bundled with this implementation. To activate: register
// this hook in the Stop chain of .claude/settings.json (and the emitted twin
// src/templates/claude/settings.json.ejs), after stop-evidence-guard.mjs, then
// promote the hardness classification per docs/design/anti-context-rot-enforcers.md §E6b.
//
// Detects the R1 signature at session scale: a session that dispatched >= 2
// research sub-agents (Task/Agent tool_use blocks) but persisted NOTHING — no
// .arbiter/findings/*.jsonl lines, no .arbiter/evidence/agent-returns/ files —
// since session start. Distinct from stop-evidence-guard.mjs's reflectionSweep,
// which nudges to drain findings already in the spool; this detects that ZERO
// were ever captured.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getRepoRoot } from './lib.mjs'

/** Parses the Stop transcript JSONL, returning { dispatchCount, sessionStartMs } or null. */
function parseTranscript(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return null
  let raw
  try {
    raw = readFileSync(transcriptPath, 'utf-8')
  } catch {
    return null
  }
  let dispatchCount = 0
  let sessionStartMs = null
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue // skip a partially-written trailing line
    }
    if (sessionStartMs === null && typeof obj.timestamp === 'string') {
      const ms = Date.parse(obj.timestamp)
      if (!Number.isNaN(ms)) sessionStartMs = ms
    }
    const blocks =
      obj?.message && Array.isArray(obj.message.content) ? obj.message.content : []
    for (const b of blocks) {
      if (b && b.type === 'tool_use' && (b.name === 'Task' || b.name === 'Agent')) dispatchCount++
    }
  }
  if (sessionStartMs === null) return null
  return { dispatchCount, sessionStartMs }
}

/** Counts JSONL lines with ts >= sinceMs across .arbiter/findings/*.jsonl. */
function countFindingsSince(root, sinceMs) {
  const dir = join(root, '.arbiter', 'findings')
  if (!existsSync(dir)) return 0
  let count = 0
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    let raw
    try {
      raw = readFileSync(join(dir, f), 'utf-8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const entry = JSON.parse(trimmed)
        const ms = Date.parse(entry.ts)
        if (!Number.isNaN(ms) && ms >= sinceMs) count++
      } catch {
        // skip malformed line
      }
    }
  }
  return count
}

/** Counts files under .arbiter/evidence/agent-returns/ with mtime >= sinceMs. */
function countAgentReturnsSince(root, sinceMs) {
  const dir = join(root, '.arbiter', 'evidence', 'agent-returns')
  if (!existsSync(dir)) return 0
  let count = 0
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(p)
      } else if (entry.isFile()) {
        try {
          if (statSync(p).mtimeMs >= sinceMs) count++
        } catch {
          // ignore races with concurrent writers
        }
      }
    }
  }
  try {
    walk(dir)
  } catch {
    // best-effort — a scan error must not crash the guard
  }
  return count
}

function main() {
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf-8')) ?? {}
  } catch {
    // Unreadable/non-JSON stdin — nothing to correlate against.
    // FAIL-OPEN-INTENT: same stand-down posture as stop-evidence-guard.mjs — a
    // guard that cannot read the Stop payload must not block the stop.
    process.exit(0)
  }

  // Re-entry guard: exit 2 re-prompts the model with this hook still active. If it
  // fired again we would loop forever, so always allow the stop on re-entry.
  if (input.stop_hook_active === true) process.exit(0)

  const parsed = parseTranscript(input.transcript_path)
  if (parsed === null) process.exit(0) // unreadable transcript — stand down (FAIL-OPEN-INTENT)

  const { dispatchCount, sessionStartMs } = parsed
  if (dispatchCount < 2) process.exit(0) // nothing to flag — fewer than 2 research dispatches

  const root = getRepoRoot()
  const persisted =
    countFindingsSince(root, sessionStartMs) + countAgentReturnsSince(root, sessionStartMs)
  if (persisted > 0) process.exit(0) // at least one artifact was captured — not a total loss

  const HARD_GRADING = process.env.ARBITER_FINDING_LOSS_HARD === '1'
  const message =
    `[arbiter] FINDING LOSS: ${dispatchCount} research agent${dispatchCount === 1 ? '' : 's'} ` +
    `returned; nothing was persisted — write \`arbiter note\` / record envelopes before stopping.\n`

  if (HARD_GRADING) {
    process.stderr.write(message)
    process.exit(2)
  }
  process.stderr.write(message) // advisory: soft grading always exits 0
  process.exit(0)
}

main()
