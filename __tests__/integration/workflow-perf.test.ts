// SPDX-License-Identifier: Apache-2.0
//
// Static critical-path time estimator for rendered CI workflows (#1232, §17.5 rec 5).
//
// Pipeline: render each budgeted workflow per archetype → parse jobs + needs:
// into a DAG → estimate each job's wall-clock minutes from per-step time
// estimates → compute the longest weighted path → assert it is within the
// per-workflow budget. ADR-pipeline-006 (check-workflow-parallelism) asserts the
// STRUCTURAL chain length (≤ edges); this test goes further and bounds the
// estimated WALL-CLOCK time.
//
// Matrix decision (#1232): the integration matrix renders TypeScript across all
// six archetypes (arbiter's own stack; archetype is the axis the issue varies).
// The fixture budgets are fixed by spec and MUST stay green on current templates.
// java/maven `01-pr-fast` is measured at ~22.7m vs the 15m budget — a real signal
// surfaced in the issue thread, not silently smoothed by lowering an estimate.
// The estimator's teeth on heavy paths are proven by the regression case in
// __tests__/utils/workflow-graph.test.ts (fabricated mvn integration-test DAG).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { Archetype } from '../../src/wizard/types.js'
import {
  parseWorkflowJobs,
  estimateJobMinutes,
  longestWeightedPath,
  formatCriticalPath,
  type StepEstimates,
} from '../utils/workflow-graph.js'

interface BudgetFixture {
  readonly stepEstimates: StepEstimates
  readonly workflowBudgets: Record<string, number>
}

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'workflow-perf-budgets.json'), 'utf-8'),
) as BudgetFixture

// The budgeted workflows that have a template under github/workflows/.
const WORKFLOWS = [
  '01-pr-fast',
  '02-pr-extended',
  '03-human-approval',
  '06-nightly',
  '07-weekly',
  '08-monthly',
] as const

// Render axis: archetype (issue §17.5 rec 5 says "per ogni archetype").
const ARCHETYPES: Archetype[] = [
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
]

function renderWorkflow(name: string, archetype: Archetype): string {
  return renderTemplate(
    `github/workflows/${name}.yml.ejs`,
    makeConfig('/tmp/workflow-perf', {
      language: 'typescript',
      buildTool: 'npm',
      archetype,
      governanceLevel: 'L2',
    }),
  )
}

function criticalPathMinutes(yaml: string): ReturnType<typeof longestWeightedPath> {
  const jobs = parseWorkflowJobs(yaml)
  return longestWeightedPath(jobs, (job) => estimateJobMinutes(job.steps, FIXTURE.stepEstimates))
}

describe('workflow-perf — critical-path time budget (#1232, §17.5 rec 5)', () => {
  it('every budgeted workflow has a budget entry in the fixture', () => {
    for (const wf of WORKFLOWS) {
      expect(FIXTURE.workflowBudgets[wf]).toBeGreaterThan(0)
    }
  })

  const cases = WORKFLOWS.flatMap((wf) => ARCHETYPES.map((arch) => ({ wf, arch })))

  it.each(cases)(
    '$wf @ $arch: estimated critical path is within the time budget',
    ({ wf, arch }) => {
      const budget = FIXTURE.workflowBudgets[wf]
      const yaml = renderWorkflow(wf, arch)
      const cp = criticalPathMinutes(yaml)
      // On breach, surface the full chain so the failure is actionable.
      expect(cp.minutes, formatCriticalPath(cp, budget)).toBeLessThanOrEqual(budget)
    },
  )

  it('01-pr-fast resolves a non-trivial weighted path (sanity: estimator is wired)', () => {
    // Guards against a silently-empty graph making the budget assertion vacuous.
    const cp = criticalPathMinutes(renderWorkflow('01-pr-fast', 'library'))
    expect(cp.path.length).toBeGreaterThanOrEqual(2)
    expect(cp.minutes).toBeGreaterThan(0)
  })
})
