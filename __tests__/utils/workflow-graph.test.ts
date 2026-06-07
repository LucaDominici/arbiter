// SPDX-License-Identifier: Apache-2.0
//
// Unit + regression tests for the workflow critical-path estimator helper (#1232).
// These exercise parseWorkflowJobs / estimateJobMinutes / longestWeightedPath in
// isolation (L1-fast, no template rendering). The render-driven integration
// matrix lives in __tests__/integration/workflow-perf.test.ts.
import { describe, it, expect } from 'vitest'
import {
  parseWorkflowJobs,
  estimateJobMinutes,
  longestWeightedPath,
  formatCriticalPath,
  WorkflowGraphCycleError,
  type StepEstimates,
} from './workflow-graph.js'

const ESTIMATES: StepEstimates = {
  'actions/checkout': 0.2,
  'actions/setup-java': 1.5,
  'mvn test': 8,
  'mvn integration-test': 25,
  _default: 1,
}

// ─── parseWorkflowJobs ─────────────────────────────────────────────────────────

describe('parseWorkflowJobs — DAG + step extraction (#1232)', () => {
  it('parses a linear block-format chain A → B → C with needs', () => {
    const yaml = `
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@abc  # v6
  b:
    runs-on: ubuntu-latest
    needs: [a]
    steps:
      - run: mvn test -Punit
  c:
    runs-on: ubuntu-latest
    needs: [b]
    steps:
      - run: echo done
`.trim()
    const jobs = parseWorkflowJobs(yaml)
    expect([...jobs.keys()]).toEqual(['a', 'b', 'c'])
    expect(jobs.get('a')?.needs).toEqual([])
    expect(jobs.get('b')?.needs).toEqual(['a'])
    expect(jobs.get('c')?.needs).toEqual(['b'])
  })

  it('strips the @<ref> pin and trailing comment from uses: steps', () => {
    const yaml = `
jobs:
  a:
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10  # v6.0.3
      - uses: ./.github/actions/setup-node-pnpm
`.trim()
    const steps = parseWorkflowJobs(yaml).get('a')?.steps
    expect(steps).toEqual(['actions/checkout', './.github/actions/setup-node-pnpm'])
  })

  it('captures only the first command line of a run: | block', () => {
    const yaml = `
jobs:
  a:
    steps:
      - name: install
        run: |
          mvn test -Pcontract
          echo second-line-ignored
      - run: echo after
`.trim()
    const steps = parseWorkflowJobs(yaml).get('a')?.steps
    expect(steps).toEqual(['mvn test -Pcontract', 'echo after'])
  })

  it('parses multi-line needs: lists', () => {
    const yaml = `
jobs:
  gate:
    steps: [{ run: echo gate }]
  ci-required:
    needs:
      - gate
      - other
    steps: [{ run: echo done }]
  other:
    steps: [{ run: echo other }]
`.trim()
    expect(parseWorkflowJobs(yaml).get('ci-required')?.needs).toEqual(['gate', 'other'])
  })

  it('flags if: always() aggregator sinks', () => {
    const yaml = `
jobs:
  a:
    steps: [{ run: echo a }]
  ci-required:
    needs: [a]
    if: always()
    steps: [{ run: echo done }]
`.trim()
    const jobs = parseWorkflowJobs(yaml)
    expect(jobs.get('ci-required')?.alwaysIf).toBe(true)
    expect(jobs.get('a')?.alwaysIf).toBe(false)
  })
})

// ─── estimateJobMinutes ────────────────────────────────────────────────────────

describe('estimateJobMinutes — step lookup (#1232)', () => {
  it('sums matched step estimates, longest-key wins', () => {
    // checkout 0.2 + `mvn test -Punit` matches `mvn test` (8) = 8.2
    expect(estimateJobMinutes(['actions/checkout', 'mvn test -Punit'], ESTIMATES)).toBeCloseTo(8.2)
  })

  it('prefers the more specific `mvn integration-test` over `mvn test`', () => {
    // `mvn integration-test` must match the 25-key, not the 8-key substring.
    expect(estimateJobMinutes(['mvn integration-test -Pit'], ESTIMATES)).toBe(25)
  })

  it('falls back to _default for unknown steps', () => {
    expect(estimateJobMinutes(['node scripts/foo.mjs', 'echo hi'], ESTIMATES)).toBe(2)
  })

  it('returns 0 for a job with no steps', () => {
    expect(estimateJobMinutes([], ESTIMATES)).toBe(0)
  })
})

// ─── longestWeightedPath ───────────────────────────────────────────────────────

describe('longestWeightedPath — weighted critical path (#1232)', () => {
  it('computes the weighted longest path through a diamond DAG', () => {
    // root(0.2) → heavy(8.2) → sink(1) ; root → light(1) → sink
    const yaml = `
jobs:
  root:
    steps:
      - uses: actions/checkout@x
  heavy:
    needs: [root]
    steps:
      - run: mvn test
  light:
    needs: [root]
    steps:
      - run: echo light
  sink:
    needs: [heavy, light]
    steps:
      - run: echo sink
`.trim()
    const jobs = parseWorkflowJobs(yaml)
    const cp = longestWeightedPath(jobs, (j) => estimateJobMinutes(j.steps, ESTIMATES))
    // root 0.2 + heavy 8 + sink 1 = 9.2 (vs light branch 0.2 + 1 + 1 = 2.2)
    expect(cp.minutes).toBeCloseTo(9.2)
    expect(cp.path.map((n) => n.job)).toEqual(['root', 'heavy', 'sink'])
  })

  it('excludes if: always() sinks from the critical path', () => {
    const yaml = `
jobs:
  a:
    steps:
      - run: mvn test
  ci-required:
    needs: [a]
    if: always()
    steps:
      - run: mvn integration-test
`.trim()
    const jobs = parseWorkflowJobs(yaml)
    const cp = longestWeightedPath(jobs, (j) => estimateJobMinutes(j.steps, ESTIMATES))
    // ci-required (25m) is a sink → excluded; path is just a (8m).
    expect(cp.minutes).toBe(8)
    expect(cp.path.map((n) => n.job)).toEqual(['a'])
  })

  it('handles a multi-root graph (two independent roots feeding one sink)', () => {
    const yaml = `
jobs:
  root-a:
    steps:
      - run: mvn test
  root-b:
    steps:
      - run: echo b
  sink:
    needs: [root-a, root-b]
    steps:
      - run: echo sink
`.trim()
    const jobs = parseWorkflowJobs(yaml)
    const cp = longestWeightedPath(jobs, (j) => estimateJobMinutes(j.steps, ESTIMATES))
    // root-a 8 + sink 1 = 9 is the longer of the two root chains.
    expect(cp.minutes).toBe(9)
    expect(cp.path.map((n) => n.job)).toEqual(['root-a', 'sink'])
  })

  it('returns an empty path when every job is an always() sink', () => {
    const yaml = `
jobs:
  only:
    if: always()
    steps: [{ run: echo x }]
`.trim()
    const cp = longestWeightedPath(parseWorkflowJobs(yaml), () => 99)
    expect(cp).toEqual({ minutes: 0, path: [] })
  })

  it('throws WorkflowGraphCycleError on a cyclic needs-graph (does not hang)', () => {
    // a → b → a is a cycle; the estimator must guard, not recurse forever.
    const cyclic = new Map([
      ['a', { needs: ['b'], alwaysIf: false, steps: [] }],
      ['b', { needs: ['a'], alwaysIf: false, steps: [] }],
    ])
    expect(() => longestWeightedPath(cyclic, () => 1)).toThrow(WorkflowGraphCycleError)
  })

  // Regression (#1232 test plan): a deliberately expensive step on the critical
  // path must push the estimate past a tight budget — proves the estimator bites.
  it('regression: an expensive mvn integration-test step breaches a tight budget', () => {
    const yaml = `
jobs:
  gate:
    steps:
      - uses: actions/checkout@x
      - uses: actions/setup-java@y
  it-tests:
    needs: [gate]
    steps:
      - uses: actions/checkout@x
      - run: mvn integration-test -Pit
`.trim()
    const jobs = parseWorkflowJobs(yaml)
    const cp = longestWeightedPath(jobs, (j) => estimateJobMinutes(j.steps, ESTIMATES))
    // gate (0.2 + 1.5 = 1.7) + it-tests (0.2 + 25 = 25.2) = 26.9m
    expect(cp.minutes).toBeCloseTo(26.9)
    const budget = 15
    expect(cp.minutes).toBeGreaterThan(budget)
    expect(formatCriticalPath(cp, budget)).toContain('budget 15m')
    expect(formatCriticalPath(cp, budget)).toMatch(/gate\([\d.]+m\) → it-tests\([\d.]+m\)/)
  })
})
