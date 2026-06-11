// SPDX-License-Identifier: Apache-2.0
//
// #1290 — thin consumer ship driver (ADR-093). Emits the stateless tick supervisor and
// the tick prompt into `.arbiter/ship/`. The driver runs the model steps and calls the
// engine (`arbiter ship`, `arbiter ship-on-red`) for every decision — it holds no
// sequencing or failure-policy logic of its own (that is the engine, #1288/#1289).
import { chmodSync } from 'node:fs'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ShipDriverOptions {
  /** GitHub label that marks driver-managed issues/PRs (default `ship`). */
  shipLabel?: string
  /** Harness CLI the supervisor invokes per tick (default `claude`). */
  harnessCmd?: string
  dryRun?: boolean
}

export interface ShipDriverResult {
  files: WriteResult[]
}

const SCRIPT_MODE = 0o755
// Substituted into shell command position — validated, never escaped-after-the-fact.
const LABEL_RE = /^[A-Za-z0-9._-]+$/
const HARNESS_RE = /^[A-Za-z0-9._/-]+$/

export function generateShipDriver(
  config: ProjectConfig,
  opts: ShipDriverOptions = {},
): ShipDriverResult {
  const shipLabel = opts.shipLabel ?? 'ship'
  const harnessCmd = opts.harnessCmd ?? 'claude'
  const dryRun = opts.dryRun ?? false
  if (!LABEL_RE.test(shipLabel)) {
    throw new Error(`ship-driver: invalid shipLabel "${shipLabel}" — allowed: [A-Za-z0-9._-]`)
  }
  if (!HARNESS_RE.test(harnessCmd)) {
    throw new Error(`ship-driver: invalid harnessCmd "${harnessCmd}" — allowed: [A-Za-z0-9._/-]`)
  }

  const data = { ...config, shipLabel, harnessCmd }
  const base = config.targetDir
  const files: WriteResult[] = []

  const supervisorPath = resolvedPath(base, '.arbiter', 'ship', 'supervisor.sh')
  const supervisor = writeFile(supervisorPath, renderTemplate('ship/supervisor.sh.ejs', data), {
    skipIfExists: true,
    dryRun,
  })
  if (!dryRun && supervisor.action !== 'skipped') {
    chmodSync(supervisorPath, SCRIPT_MODE)
  }
  files.push(supervisor)

  files.push(
    writeFile(
      resolvedPath(base, '.arbiter', 'ship', 'TICK_PROMPT.md'),
      renderTemplate('ship/TICK_PROMPT.md.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  )

  return { files }
}
