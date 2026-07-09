// SPDX-License-Identifier: Apache-2.0
/**
 * Class guard (#1865): job-level `permissions:` REPLACES workflow-level on GitHub —
 * it never merges. A job that declares `permissions: { issues: write }` while the
 * workflow declares `permissions: { contents: read }` runs with contents: none, so
 * `actions/checkout` on a PRIVATE repo fails with "Repository not found". On a
 * downstream private target, drift-shadow + nightly-lite failed every night from
 * 2026-07-06 — silently, because the failing channel is the one that would have
 * opened the issue (#1865).
 *
 * Guard 1: for EVERY job of EVERY rendered workflow template that contains an
 * `actions/checkout` step, the EFFECTIVE permissions (job-level if present,
 * otherwise workflow-level) must include `contents`. Jobs without any permissions
 * block at either level pass — GitHub's default token grants include contents: read.
 *
 * Guard 2: `golang/govulncheck-action` re-checkouts the repo by default
 * (repo-checkout: true). When the job already ran an explicit `actions/checkout`,
 * the second internal checkout adds a second Authorization extraheader -> git 400
 * "Duplicate header". Every govulncheck-action step in a job with an explicit
 * checkout must set `with: repo-checkout: false`.
 *
 * Existing Code Survey (CANON-16): follows workflow-structure.test.ts (#1549) —
 * same glob, same render-data shape, same js-yaml parse; adds go-language configs
 * because the govulncheck steps only render for `language: 'go'`.
 */
import { describe, it, expect } from 'vitest'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

const TEMPLATES_DIR = resolve('src/templates')
const WORKFLOW_TEMPLATES = globSync('github/workflows/*.yml.ejs', { cwd: TEMPLATES_DIR }).sort()

function makeRenderData(overrides: Partial<ProjectConfig> = {}): Record<string, unknown> {
  return {
    ...makeConfig('/tmp/arbiter-workflow-permissions', {
      hasPublicApi: true,
      basePackage: 'com.example.demo',
      contractType: 'rest-owned',
      ...overrides,
    }),
    coverageEnabled: true,
    coverageThreshold: 80,
    mutationThreshold: 80,
    metricsProfile: {
      includeBundleSize: true,
      includePublicApiSurface: true,
      includeBranchCoverage: true,
      spotbugsEnabled: true,
      archunitEnabled: true,
    },
    evidenceRetention: { mode: 'local-last-N', count: 5 },
    frontendFramework: 'react',
  }
}

// The go configs matter: the govulncheck-action steps (guard 2) only render for
// `language: 'go'`. The rest mirror workflow-structure.test.ts's representative axes.
const CONFIGS: Array<{ name: string; data: Record<string, unknown> }> = [
  {
    name: 'typescript/L2/backend-api',
    data: makeRenderData({
      language: 'typescript',
      archetype: 'backend-api',
      governanceLevel: 'L2',
    }),
  },
  {
    name: 'go/L2/backend-api',
    data: makeRenderData({
      language: 'go',
      buildTool: 'go',
      archetype: 'backend-api',
      governanceLevel: 'L2',
    }),
  },
  {
    name: 'go/L3/backend-api',
    data: makeRenderData({
      language: 'go',
      buildTool: 'go',
      archetype: 'backend-api',
      governanceLevel: 'L3',
    }),
  },
  {
    name: 'java/L3/backend-web-db',
    data: makeRenderData({
      language: 'java',
      buildTool: 'maven',
      archetype: 'backend-web-db',
      governanceLevel: 'L3',
    }),
  },
  {
    name: 'python/L1/backend-api',
    data: makeRenderData({
      language: 'python',
      buildTool: 'pip',
      archetype: 'backend-api',
      governanceLevel: 'L1',
    }),
  },
  {
    name: 'trunk-solo/L2',
    data: makeRenderData({
      collaborationMode: 'trunk-solo',
      enableSoloDevMode: true,
      governanceLevel: 'L2',
    }),
  },
]

type Step = { uses?: string; with?: Record<string, unknown> }
type Job = {
  steps?: Step[]
  permissions?: Record<string, string> | string
}
type Workflow = { permissions?: Record<string, string> | string; jobs?: Record<string, Job> }

/**
 * True when a permissions value includes contents access. The string shorthands
 * `read-all` / `write-all` include contents; a mapping must name `contents`
 * explicitly (any mapping without it means contents: none for that scope).
 */
function includesContents(perms: Record<string, string> | string): boolean {
  if (typeof perms === 'string') return perms === 'read-all' || perms === 'write-all'
  return 'contents' in perms
}

function isCheckoutStep(step: Step): boolean {
  return typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout')
}

/** Render every workflow template under one config → map of file name → parsed workflow. */
function renderAllParsed(data: Record<string, unknown>): Map<string, Workflow> {
  const out = new Map<string, Workflow>()
  for (const tpl of WORKFLOW_TEMPLATES) {
    const fileName = tpl.replace(/^github\/workflows\//, '').replace(/\.ejs$/, '')
    // Invalid YAML / render errors are workflow-structure.test.ts's concern; here
    // they must still fail loudly rather than silently shrink the guard's surface.
    out.set(fileName, load(renderTemplate(tpl, data)) as Workflow)
  }
  return out
}

describe('workflow templates — checkout jobs keep effective contents permission (#1865)', () => {
  it('renders the full workflow template set (glob not silently empty)', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(25)
  })

  for (const { name, data } of CONFIGS) {
    it(`every job with actions/checkout has effective contents permission (${name})`, () => {
      const violations: string[] = []
      let checkoutJobs = 0
      for (const [file, wf] of renderAllParsed(data)) {
        if (!wf?.jobs) continue
        for (const [jobId, job] of Object.entries(wf.jobs)) {
          const steps = Array.isArray(job?.steps) ? job.steps : []
          if (!steps.some(isCheckoutStep)) continue
          checkoutJobs++
          // Job-level permissions REPLACE workflow-level (GitHub semantics — no merge).
          const effective = job.permissions ?? wf.permissions
          if (effective !== undefined && !includesContents(effective)) {
            violations.push(
              `${file}: job "${jobId}" checks out but effective permissions lack contents`,
            )
          }
        }
      }
      expect(checkoutJobs, 'guard surface collapsed — no checkout jobs found').toBeGreaterThan(0)
      expect(violations, `checkout jobs stripped of contents under ${name}`).toEqual([])
    })

    it(`every govulncheck-action step in a job with explicit checkout sets repo-checkout: false (${name})`, () => {
      const violations: string[] = []
      for (const [file, wf] of renderAllParsed(data)) {
        if (!wf?.jobs) continue
        for (const [jobId, job] of Object.entries(wf.jobs)) {
          const steps = Array.isArray(job?.steps) ? job.steps : []
          if (!steps.some(isCheckoutStep)) continue
          for (const step of steps) {
            if (typeof step?.uses !== 'string') continue
            if (!step.uses.startsWith('golang/govulncheck-action')) continue
            if (step.with?.['repo-checkout'] !== false) {
              violations.push(
                `${file}: job "${jobId}" runs govulncheck-action after an explicit checkout without repo-checkout: false`,
              )
            }
          }
        }
      }
      expect(
        violations,
        `govulncheck double-checkout (400 Duplicate header) under ${name}`,
      ).toEqual([])
    })
  }

  it('guard exercises the govulncheck surface at least once (go configs render it)', () => {
    let govulnSteps = 0
    for (const { data } of CONFIGS) {
      for (const [, wf] of renderAllParsed(data)) {
        for (const job of Object.values(wf?.jobs ?? {})) {
          for (const step of job?.steps ?? []) {
            if (
              typeof step?.uses === 'string' &&
              step.uses.startsWith('golang/govulncheck-action')
            ) {
              govulnSteps++
            }
          }
        }
      }
    }
    expect(
      govulnSteps,
      'no govulncheck-action step rendered — guard 2 surface collapsed',
    ).toBeGreaterThan(0)
  })
})
