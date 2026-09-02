// SPDX-License-Identifier: Apache-2.0
//
// #2476 — the PR-tier merge-gate workflows must not filter the pull_request BASE branch.
//
// On a `pull_request` event `branches:` filters the base, not the head. A tier
// workflow pinned to `branches: [main]` creates NO RUN AT ALL for a pull request
// based on a task or train branch: the pull request shows no failing checks
// because it has no checks, and branch protection cannot catch it either
// (protection lives on the base branch, and a task branch carries none).
//
// The committed `.github/workflows/*.yml` are covered by the gate script
// (`scripts/check-workflow-test-integrity.mjs`). This suite covers what the gate
// script cannot reach: the `.ejs` twins arbiter SHIPS (CANON-18), under BOTH
// `branchingStrategy` values — the `github-flow-with-develop` branch of the EJS
// conditional is never exercised by the render-parity fixture.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { renderTemplate } from '../../src/utils/render.js'

const CI_CTX = JSON.parse(
  readFileSync(new URL('../fixtures/ci-tier-render-context.json', import.meta.url), 'utf-8'),
)

const TIER_WORKFLOWS = [
  ['01-pr-fast.yml', 'github/workflows/01-pr-fast.yml.ejs'],
  ['02-pr-extended.yml', 'github/workflows/02-pr-extended.yml.ejs'],
] as const

const BRANCHING_STRATEGIES = ['github-flow', 'github-flow-with-develop'] as const

/** The `on:` mapping of a workflow doc, tolerating a YAML 1.1 loader folding `on` → true. */
function triggers(doc: Record<string, unknown>): Record<string, unknown> {
  const on = (doc.on ?? (doc as Record<string, unknown>)[String(true)]) as unknown
  expect(on, 'workflow declares an on: trigger mapping').toBeTruthy()
  return on as Record<string, unknown>
}

/** Base-branch filter keys present on the pull_request trigger(s), if any. */
function baseBranchFilters(doc: Record<string, unknown>): string[] {
  const on = triggers(doc)
  const found: string[] = []
  for (const event of ['pull_request', 'pull_request_target']) {
    const cfg = on[event]
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue
    for (const key of ['branches', 'branches-ignore']) {
      if ((cfg as Record<string, unknown>)[key] != null) found.push(`${event}.${key}`)
    }
  }
  return found
}

describe('#2476 — PR-tier workflows do not filter the pull_request base branch', () => {
  it.each(TIER_WORKFLOWS)('committed .github/workflows/%s', (out) => {
    const doc = parseYaml(readFileSync(`.github/workflows/${out}`, 'utf-8')) as Record<
      string,
      unknown
    >
    // The rule only binds workflows carrying a merge-gate aggregator job.
    const jobs = Object.keys((doc.jobs ?? {}) as Record<string, unknown>)
    expect(jobs.some((j) => j.endsWith('-required'))).toBe(true)
    expect(baseBranchFilters(doc)).toEqual([])
  })

  const cases = TIER_WORKFLOWS.flatMap(([out, tpl]) =>
    BRANCHING_STRATEGIES.map((bs) => [out, bs, tpl] as const),
  )

  it.each(cases)('template %s renders no base filter (branchingStrategy=%s)', (_out, bs, tpl) => {
    const doc = parseYaml(renderTemplate(tpl, { ...CI_CTX, branchingStrategy: bs })) as Record<
      string,
      unknown
    >
    expect(baseBranchFilters(doc)).toEqual([])
  })

  it.each(cases)(
    'template %s keeps its push:/post-merge branch scoping (branchingStrategy=%s)',
    (_out, bs, tpl) => {
      // The fix must ADD pull_request coverage, never SUBTRACT push coverage:
      // when a push trigger exists it stays scoped to the long-lived branches.
      const doc = parseYaml(renderTemplate(tpl, { ...CI_CTX, branchingStrategy: bs })) as Record<
        string,
        unknown
      >
      const push = triggers(doc).push as { branches?: string[] } | undefined
      if (!push) return
      const expected = bs === 'github-flow-with-develop' ? ['main', 'develop'] : ['main']
      expect(push.branches).toEqual(expected)
    },
  )
})
