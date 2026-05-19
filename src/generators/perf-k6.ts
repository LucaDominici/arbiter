// SPDX-License-Identifier: Apache-2.0
// F6: k6 performance testing ecosystem generator (#895)
// CANON-05: generator function; CANON-11: brownfield-safe (all files use skipIfExists)
// Existing Code Survey: grepped src/generators/ and src/templates/ for k6/perf — nothing similar exists; new file justified.
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface PerfK6GeneratorResult {
  files: WriteResult[]
}

const SCENARIO_NAMES = [
  'load',
  'stress',
  'spike',
  'soak',
  'volume',
  'breakpoint',
  'smoke',
  'ramp-up',
  'ramp-down',
  'steady-state',
  'burst',
  'endurance',
] as const

const REPORT_NAMES = ['html-report', 'json-report', 'csv-report'] as const

/**
 * F6: Emit k6 performance testing ecosystem.
 * Gated on config.enablePerfTesting — off by default.
 * All files use skipIfExists for brownfield safety.
 */
export function generatePerfK6(config: ProjectConfig): PerfK6GeneratorResult {
  if (!config.enablePerfTesting) {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true } as const

  const workflowsDir = resolvedPath(base, '.github', 'workflows')
  const scenariosDir = resolvedPath(base, 'perf', 'k6', 'scenarios')
  const reportsDir = resolvedPath(base, 'perf', 'k6', 'reports')
  const seedDir = resolvedPath(base, 'perf', 'k6', 'seed')
  const scriptsDir = resolvedPath(base, 'scripts')

  const files: WriteResult[] = []

  // ── GitHub workflow: on-demand dispatcher ────────────────────────────────
  files.push(
    writeFile(
      join(workflowsDir, '11-k6-on-demand.yml'),
      renderTemplate('github/workflows/11-k6-on-demand.yml.ejs', data),
      skip,
    ),
  )

  // ── GitHub workflow: reusable k6 runner ──────────────────────────────────
  files.push(
    writeFile(
      join(workflowsDir, '_k6-runner.yml'),
      renderTemplate('github/workflows/_k6-runner.yml.ejs', data),
      skip,
    ),
  )

  // ── Scenario templates ───────────────────────────────────────────────────
  for (const name of SCENARIO_NAMES) {
    files.push(
      writeFile(
        join(scenariosDir, `${name}.js`),
        renderTemplate(`perf/k6/scenarios/${name}.js.ejs`, data),
        skip,
      ),
    )
  }

  // ── Python report generators ─────────────────────────────────────────────
  for (const name of REPORT_NAMES) {
    files.push(
      writeFile(
        join(reportsDir, `${name}.py`),
        renderTemplate(`perf/k6/reports/${name}.py.ejs`, data),
        skip,
      ),
    )
  }

  // ── Seed SQL ─────────────────────────────────────────────────────────────
  files.push(
    writeFile(
      join(seedDir, 'test-data.sql'),
      renderTemplate('perf/k6/seed/test-data.sql.ejs', data),
      skip,
    ),
  )

  // ── Scenario completeness validator ──────────────────────────────────────
  files.push(
    writeFile(
      join(scriptsDir, 'validate-k6-scenarios.mjs'),
      renderTemplate('scripts/validate-k6-scenarios.mjs.ejs', data),
      skip,
    ),
  )

  return { files }
}
