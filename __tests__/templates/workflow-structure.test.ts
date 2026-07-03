// SPDX-License-Identifier: Apache-2.0
/**
 * Structural validation for every emitted GitHub Actions workflow (#1549).
 *
 * Before this sweep, 41 of 42 workflow render tests asserted via `.toContain()`
 * only — just `01-pr-fast` was ever `yaml.parse`d, and the bake snapshots are
 * byte-equality, so a YAML-breaking edit (or a broken job graph) in any other
 * workflow was snapshot-updated and shipped. The high-severity `_notify`
 * contract break (#1548) — a permanently-invalid reusable call that every
 * existing guard missed because nothing resolved the caller `with:` against the
 * callee `on.workflow_call.inputs` — is live proof this gap matters.
 *
 * This sweep renders every top-level workflow template under several
 * representative configs and asserts, via real `js-yaml` parsing:
 *   1. the rendered workflow is valid YAML (it loads without throwing);
 *   2. every `needs:` target resolves to a declared job in the same workflow;
 *   3. every local reusable call (`uses: ./.github/workflows/_X.yml`) passes a
 *      `with:` block that is a SUBSET of the callee's declared inputs, and
 *      supplies every `required: true` callee input.
 *
 * (3) is the static guard that would have caught #1548.
 *
 * Deploy-target axis (#1558): workflows are also rendered under every container
 * deploy target (`ghcr`/`aws-ecs`/`gcp-cloud-run`/`azure-container-app`), which
 * pulls in the `_partials/sigstore-preflight`, `_cosign-copy/<target>` and
 * `_deploy/<target>` includes. This locks out the regression #1558 fixed: the
 * `_cosign-copy/ghcr` partial emitted an inline multi-line `python3 -c` heredoc
 * whose column-0 lines broke the enclosing `run: |` block scalar, so
 * `10-deploy-prod`/`05-release` rendered to INVALID YAML whenever a container
 * deploy target was configured. This sweep is what surfaced it.
 *
 * Existing Code Survey (CANON-16): test-only file. Reuses the reusable-contract
 * resolution helpers added to `__tests__/utils/workflow-graph.ts` (#1548); no
 * new production source.
 */
import { describe, it, expect } from 'vitest'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'
import {
  parseJobNeeds,
  parseReusableCalls,
  parseWorkflowCallInputs,
  resolveReusableContract,
  type ReusableInputSpec,
} from '../utils/workflow-graph.js'

const TEMPLATES_DIR = resolve('src/templates')

// Top-level workflow templates only (the `*.yml.ejs` directly under
// github/workflows/). The `_partials/`, `_deploy/`, `_cosign-copy/` subdirs are
// EJS includes, not standalone workflows, so they are not globbed here.
const WORKFLOW_TEMPLATES = globSync('github/workflows/*.yml.ejs', { cwd: TEMPLATES_DIR }).sort()

function makeRenderData(overrides: Partial<ProjectConfig> = {}): Record<string, unknown> {
  return {
    ...makeConfig('/tmp/arbiter-workflow-structure', {
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
  // Container deploy-target axis (#1558): `10-deploy-prod`/`05-release` pull in the
  // `_partials/sigstore-preflight`, `_cosign-copy/<target>` and `_deploy/<target>`
  // includes only when a container deploy target is configured. Every target must
  // still render to valid YAML — the inline digest-resolution steps must not break
  // the enclosing `run: |` block scalar (the defect this axis was added to lock out).
  {
    name: 'deploy/ghcr/L2',
    data: makeRenderData({ governanceLevel: 'L2', deployTarget: 'ghcr' }),
  },
  {
    name: 'deploy/aws-ecs/L2',
    data: makeRenderData({ governanceLevel: 'L2', deployTarget: 'aws-ecs' }),
  },
  {
    name: 'deploy/gcp-cloud-run/L2',
    data: makeRenderData({ governanceLevel: 'L2', deployTarget: 'gcp-cloud-run' }),
  },
  {
    name: 'deploy/azure-container-app/L2',
    data: makeRenderData({ governanceLevel: 'L2', deployTarget: 'azure-container-app' }),
  },
]

/** Render every workflow template under one config → map of file name → content. */
function renderAll(data: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>()
  for (const tpl of WORKFLOW_TEMPLATES) {
    const fileName = tpl.replace(/^github\/workflows\//, '').replace(/\.ejs$/, '')
    out.set(fileName, renderTemplate(tpl, data))
  }
  return out
}

describe('emitted workflows are structurally valid (#1549)', () => {
  it('renders at least the full known set of workflow templates', () => {
    // Guard against the glob silently going empty. 31 templates as of writing.
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(25)
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/01-pr-fast.yml.ejs')
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/10-deploy-prod.yml.ejs')
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/_notify.yml.ejs')
  })

  for (const { name, data } of CONFIGS) {
    it(`every workflow is valid YAML and loads without throwing (${name})`, () => {
      const failures: string[] = []
      for (const [file, content] of renderAll(data)) {
        try {
          load(content)
        } catch (err) {
          failures.push(`${file}: ${String(err).split('\n')[0]}`)
        }
      }
      expect(failures, `workflows rendered to invalid YAML under ${name}`).toEqual([])
    })

    it(`every needs: target resolves to a declared job (${name})`, () => {
      const failures: string[] = []
      for (const [file, content] of renderAll(data)) {
        let jobNeeds: Map<string, string[]>
        try {
          jobNeeds = parseJobNeeds(content)
        } catch {
          continue // invalid YAML is asserted by the sibling test
        }
        const declared = new Set(jobNeeds.keys())
        for (const [job, needs] of jobNeeds) {
          for (const dep of needs) {
            if (!declared.has(dep)) failures.push(`${file}: job "${job}" needs undeclared "${dep}"`)
          }
        }
      }
      expect(failures, `unresolved needs: targets under ${name}`).toEqual([])
    })

    it(`every reusable call's with: resolves against the callee contract (${name})`, () => {
      const rendered = renderAll(data)

      // Build callee contracts: every rendered workflow that declares
      // on.workflow_call.inputs, keyed by its file name (e.g. `_notify.yml`).
      const contracts = new Map<string, Map<string, ReusableInputSpec>>()
      for (const [file, content] of rendered) {
        let inputs: Map<string, ReusableInputSpec> | null
        try {
          inputs = parseWorkflowCallInputs(content)
        } catch {
          continue
        }
        if (inputs) contracts.set(file, inputs)
      }

      // A reusable callee must actually be resolvable — guards against a typo'd
      // `uses:` path silently skipping the check.
      const unresolved: string[] = []
      const violations: string[] = []
      let resolvedCalls = 0
      for (const [file, content] of rendered) {
        let calls: ReturnType<typeof parseReusableCalls>
        try {
          calls = parseReusableCalls(content)
        } catch {
          continue
        }
        for (const call of calls) {
          if (!contracts.has(call.callee)) {
            unresolved.push(`${file}: job "${call.job}" calls unknown callee "${call.callee}"`)
          }
        }
        const vs = resolveReusableContract(calls, contracts)
        resolvedCalls += calls.filter((c) => contracts.has(c.callee)).length
        for (const v of vs) {
          violations.push(`${file}: job "${v.job}" → ${v.callee} ${v.kind}: ${v.input}`)
        }
      }

      expect(unresolved, `reusable calls to an unknown callee under ${name}`).toEqual([])
      expect(violations, `reusable-contract violations under ${name}`).toEqual([])
      // Sanity: the deploy callers DO exercise the _notify contract here.
      expect(resolvedCalls, 'expected at least one resolved reusable call').toBeGreaterThan(0)
    })
  }
})
