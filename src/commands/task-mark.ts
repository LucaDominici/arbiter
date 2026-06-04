// SPDX-License-Identifier: Apache-2.0
//
// `arbiter mark` (#1206) — pinpoint step-cursor snapshot.
//
// Writes a fine-grained step-cursor {tddPhase, lastAction, nextAction} into the unified task
// document and appends a one-line progress digest to log.md. After a mid-task `/clear`, `arbiter task
// resume` reads this cursor and lands on the EXACT next action instead of inferring from phase.
import { type TddPhase, writeUnifiedState, appendLog } from './task-state.js'

export interface TaskMarkOptions {
  dir?: string
  /** Set/override the active task id (e.g. on first mark of a task). */
  taskId?: string
  tddPhase?: TddPhase
  /** One-line description of the sub-step just completed. */
  last?: string
  /** One-line description of the exact next sub-step to resume on. */
  next?: string
  /** Free-form progress digest line for log.md; defaults to a line derived from `next`. */
  digest?: string
}

export function runTaskMark(opts: TaskMarkOptions = {}): void {
  const root = opts.dir ?? process.cwd()

  const cursor: { tddPhase?: TddPhase; lastAction?: string; nextAction?: string } = {}
  if (opts.tddPhase !== undefined) cursor.tddPhase = opts.tddPhase
  if (opts.last !== undefined) cursor.lastAction = opts.last
  if (opts.next !== undefined) cursor.nextAction = opts.next

  const patch: Parameters<typeof writeUnifiedState>[1] = { cursor }
  if (opts.taskId !== undefined && opts.taskId.length > 0) patch.taskId = opts.taskId
  writeUnifiedState(root, patch)

  const digest = opts.digest ?? (opts.next ? `mark → next: ${opts.next}` : 'mark')
  appendLog(root, digest)
}
