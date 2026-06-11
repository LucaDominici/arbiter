// SPDX-License-Identifier: Apache-2.0
//
// `arbiter ship-on-red` (#1289) — the engine surface the dual-side ship driver (#1290)
// calls when a gate goes red. Reads the failed-gate log, asks the deterministic fix-on-red
// policy for the next action, and prints it. The decision (`fix` / `escalate` /
// `escalate-uncertain`) is a valid computed output → exit 0; only an IO/usage error
// (unreadable log, missing task id) exits non-zero.
import { evaluateRed, readBoundedLog, type Decision } from '../ship/fix-on-red.js'
import { readTaskId } from './task-state.js'
import { sanitizeTaskId } from '../worktree/paths.js'
import { resolveShipProfile } from './ship-profile.js'

export interface ShipFixOnRedOptions {
  /** The gate/check that went red (e.g. `lint`, `unit-test`, `jscpd`). */
  check: string
  /** Path to the captured failed-gate log. */
  logFile: string
  /** Task id override; falls back to the active task state. */
  id?: string
  /** #1291 — per-run autonomy override; resolution: flag > arbiter.json > L0. */
  autonomy?: string
  dir?: string
}

export interface ShipFixOnRedSuccess {
  ok: true
  decision: Decision
  lines: string[]
}
export interface ShipFixOnRedFailure {
  ok: false
  reason: string
}

/** Human-readable decision lines; absent signature/attempt print as `unknown` (RT-03). */
export function formatDecisionLines(decision: Decision): string[] {
  const signature =
    decision.kind === 'escalate-uncertain' ? (decision.signature ?? 'unknown') : decision.signature
  const attempt =
    decision.kind === 'escalate-uncertain'
      ? decision.attempt !== undefined
        ? String(decision.attempt)
        : 'unknown'
      : String(decision.attempt)
  const lines = [
    `Decision: ${decision.kind}`,
    `Signature: ${signature}`,
    `Attempt: ${attempt}`,
    `Next: ${decision.nextAction}`,
  ]
  // #1291 — the driver obeys PRINTED text; the autopush authorization must be visible.
  if (decision.kind === 'fix') {
    lines.push(
      `Autopush: ${decision.autopush ? 'authorized (autonomy L3)' : 'refused — hand the push to a human'}`,
    )
  }
  if (decision.kind === 'escalate-uncertain') lines.push(`Reason: ${decision.reason}`)
  return lines
}

export function runShipFixOnRed(
  opts: ShipFixOnRedOptions,
): ShipFixOnRedSuccess | ShipFixOnRedFailure {
  const dir = opts.dir ?? process.cwd()
  let taskId: string | undefined
  try {
    taskId = opts.id !== undefined ? sanitizeTaskId(opts.id) : readTaskId(dir)
  } catch (err) {
    return {
      ok: false,
      reason: `invalid task id: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (taskId === undefined || !/^#\d+$/.test(taskId)) {
    return { ok: false, reason: 'no valid task id — pass --id #NNN or run inside an active task' }
  }
  let log: string
  try {
    log = readBoundedLog(opts.logFile)
  } catch (err) {
    return {
      ok: false,
      reason: `cannot read --log-file ${opts.logFile}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  // #1291 — resolve the autonomy level from the target repo (flag > config > L0).
  const profile = resolveShipProfile(
    dir,
    opts.autonomy !== undefined ? { autonomyOverride: opts.autonomy } : {},
  )
  const decision = evaluateRed({
    taskId,
    checkName: opts.check,
    log,
    repoDir: dir,
    autonomy: profile.autonomy,
  })
  return { ok: true, decision, lines: formatDecisionLines(decision) }
}
