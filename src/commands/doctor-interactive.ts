// SPDX-License-Identifier: Apache-2.0
// #1168 Phase 3: `arbiter doctor --interactive` — run the health check, then
// offer a one-key repair when fixable issues are present. Delegates the actual
// work to runDoctorHealth so behaviour stays identical to the non-interactive path.

import { intro, outro, confirm, isCancel, cancel } from '@clack/prompts'
import { runDoctorHealth } from './doctor.js'

export interface InteractiveDoctorOptions {
  dir?: string
}

/**
 * Guided doctor: health check first (no repair), then — if the run reports a
 * fixable issue (a stale lock) — prompt to repair and re-run with --repair.
 * Requires a TTY (caller guards). Mirrors runDoctorHealth's exit semantics.
 */
export async function runInteractiveDoctor(opts: InteractiveDoctorOptions = {}): Promise<void> {
  const dir = opts.dir
  intro('arbiter doctor')

  const first = await runDoctorHealth({
    ...(dir !== undefined ? { dir } : {}),
    json: false,
    repair: false,
  })

  // A stale lock is the one issue runDoctorHealth can auto-repair. Detect it from
  // the failing checks so we only prompt when repair would actually do something.
  const fixable = first.checks.some(
    (c) => c.status === 'FAIL' && /lock/i.test(`${c.label} ${c.detail}`),
  )

  if (!fixable) {
    outro(first.exitCode === 0 ? 'Healthy — nothing to repair.' : 'No auto-fixable issues found.')
    if (first.exitCode !== 0) process.exitCode = first.exitCode
    return
  }

  const doRepair = await confirm({ message: 'Fixable issue detected. Attempt repair now?' })
  if (isCancel(doRepair)) {
    cancel('Cancelled.')
    return
  }
  if (!doRepair) {
    outro('Skipped repair.')
    if (first.exitCode !== 0) process.exitCode = first.exitCode
    return
  }

  const repaired = await runDoctorHealth({
    ...(dir !== undefined ? { dir } : {}),
    json: false,
    repair: true,
  })
  outro(repaired.exitCode === 0 ? 'Repaired — project healthy.' : 'Repair ran; some issues remain.')
  if (repaired.exitCode !== 0) process.exitCode = repaired.exitCode
}
