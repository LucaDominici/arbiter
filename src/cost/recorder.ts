// SPDX-License-Identifier: Apache-2.0
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from '../utils/fs.js'

export interface PhaseCostDelta {
  in: number
  out: number
  samples: number
}

export interface CostReport {
  taskId: string
  byPhase: Record<string, PhaseCostDelta>
  totals: PhaseCostDelta
}

export function recordPhaseCost(
  taskId: string,
  phase: string,
  delta: PhaseCostDelta,
  dir = process.cwd(),
): void {
  const evidenceDir = join(dir, '.arbiter', 'evidence', 'cost')
  mkdirSync(evidenceDir, { recursive: true })
  const target = join(evidenceDir, `${taskId}.json`)

  let report: CostReport = { taskId, byPhase: {}, totals: { in: 0, out: 0, samples: 0 } }
  try {
    report = JSON.parse(readFileSync(target, 'utf-8')) as CostReport
  } catch {
    // First write — start fresh
  }

  const existing = report.byPhase[phase] ?? { in: 0, out: 0, samples: 0 }
  report.byPhase[phase] = {
    in: existing.in + delta.in,
    out: existing.out + delta.out,
    samples: existing.samples + delta.samples,
  }

  report.totals = Object.values(report.byPhase).reduce(
    (acc, v) => ({ in: acc.in + v.in, out: acc.out + v.out, samples: acc.samples + v.samples }),
    { in: 0, out: 0, samples: 0 },
  )

  writeFile(target, JSON.stringify(report, null, 2) + '\n')
}
