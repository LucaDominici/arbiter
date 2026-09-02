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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
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

// The rule is enforced on two surfaces, and they are DIFFERENT implementations:
// arbiter's own scripts/check-workflow-test-integrity.mjs parses the workflow with
// the `yaml` package, while the twin arbiter SHIPS is line-based on purpose (a
// generated project is not required to carry `yaml`). The dogfood diff-pin proves
// the two files stay in sync, not that the shipped one WORKS — so exercise the
// rendered twin directly, in both directions. A gate never seen to fail protects
// nothing.
describe('#2476 — the SHIPPED check-workflow-test-integrity twin enforces the same rule', () => {
  const MERGE_GATE_JOBS = `jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  ci-required:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`

  function runTwin(workflow: string, name = '01-pr-fast.yml') {
    const root = mkdtempSync(join(tmpdir(), 'twin-2476-'))
    try {
      const script = join(root, 'check-workflow-test-integrity.mjs')
      writeFileSync(
        script,
        renderTemplate('scripts/check-workflow-test-integrity.mjs.ejs', { projectName: 'demo' }),
      )
      const repo = join(root, 'repo')
      mkdirSync(join(repo, '.github', 'workflows'), { recursive: true })
      writeFileSync(join(repo, '.github', 'workflows', name), workflow)
      const r = spawnSync('node', [script, '--dir', repo], { encoding: 'utf-8' })
      return { status: r.status ?? 1, stderr: r.stderr ?? '' }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('fails a merge-gate workflow that filters the pull_request base branch', () => {
    const r = runTwin(`name: PR Fast
on:
  push:
    branches: [main]
  pull_request:
    types: [opened]
    branches: [main]
${MERGE_GATE_JOBS}`)
    expect(r.stderr).toMatch(/base-branch filter/)
    expect(r.stderr).toMatch(/#2476/)
    expect(r.status).toBe(1)
  })

  it('passes the same workflow once the base filter is gone', () => {
    const r = runTwin(`name: PR Fast
on:
  push:
    branches: [main]
  pull_request:
    types: [opened]
${MERGE_GATE_JOBS}`)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })

  it('exempts a supplementary lane that carries no merge-gate aggregator job', () => {
    const r = runTwin(
      `name: CodeQL
on:
  pull_request:
    branches: [main]
jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - run: echo scan
`,
      '15-codeql.yml',
    )
    expect(r.status).toBe(0)
  })
})
