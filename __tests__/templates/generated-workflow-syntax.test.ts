// SPDX-License-Identifier: Apache-2.0
/**
 * actionlint contract on the RENDERED workflow corpus (literature GAP 2).
 *
 * `check-all.mjs` (`runToolCheck('actionlint', 'actionlint', [])`) only lints
 * arbiter's OWN `.github/workflows/` — the self-intersection of what arbiter
 * happens to emit for itself. Archetype-conditional workflows arbiter never
 * materializes for its own repo (java/go/rust build lanes, deploy-test,
 * deploy-prod, k6, mutation, archunit-extended, license-scan, codeql,
 * frontend-quality/-lane, contract-postman, notify, sigstore, drift-shadow, …)
 * ship completely unvalidated. That is the exact gap class that let the #1548
 * `_notify` workflow break ship, and the same blind spot
 * generated-shell-syntax.test.ts (#1549) closed for shell — this closes it for
 * YAML/Actions-schema/expression correctness instead.
 *
 * Mirrors generated-shell-syntax.test.ts: render every `github/workflows/*.yml.ejs`
 * template directly (bypassing the generator's own conditional emission
 * gating — same rationale as the shell sweep, so a branch the REAL generator
 * would never select for one config still gets validated under another),
 * YAML-parse each render, then actionlint it. Skips with a reason (never a
 * false RED) when the `actionlint` binary is absent locally; CI installs it
 * (scripts/install-ci-tools.mjs) so the real corpus is validated there.
 */
import { describe, it, expect } from 'vitest'
import { globSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

const TEMPLATES_DIR = resolve('src/templates')
const WORKFLOW_ROOT = 'github/workflows'

// Every workflow template arbiter can emit, relative to `src/templates/`.
const WORKFLOW_TEMPLATES = globSync('*.yml.ejs', { cwd: join(TEMPLATES_DIR, WORKFLOW_ROOT) })
  .map((f) => `${WORKFLOW_ROOT}/${f}`)
  .sort()

function hasBinary(bin: string): boolean {
  const r = spawnSync('which', [bin], { encoding: 'utf-8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

const HAS_ACTIONLINT = hasBinary('actionlint')

// "Kitchen sink" — every render-affecting feature flag turned on so each
// template's own EJS conditionals exercise their richest branch, independent
// of whether the real generator (github.ts/ci-tier.ts/perf-k6.ts/
// contract-testing.ts) would actually gate that template on for this config.
function makeRenderData(overrides: Partial<ProjectConfig> = {}): Record<string, unknown> {
  return {
    ...makeConfig('/tmp/arbiter-workflow-syntax', {
      governanceLevel: 'L4',
      hasPublicApi: true,
      hasDatabase: true,
      useGitHub: true,
      githubOwner: 'octo-org',
      githubRepo: 'octo-repo',
      contractType: 'rest-owned',
      pipelineStyle: 'industrial',
      enablePerfTesting: true,
      enableCodeownersNotify: true,
      enableMutationTesting: true,
      enableContractTesting: true,
      enableEvidenceHarness: true,
      collaborationMode: 'peer-review',
      deployTarget: 'ghcr',
      industryOverlay: 'iso27001',
      k6ScriptPath: 'tests/load/default.js',
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
    harnessCmd: 'claude',
    shipLabel: 'ship',
  }
}

// One config per language so build/test/lint commands and language-specific
// EJS branches across the whole corpus (e.g. Java/Gradle deploy steps, Go
// module caching) each materialize and get actionlinted at least once.
const CONFIGS: Array<{ name: string; data: Record<string, unknown> }> = [
  {
    name: 'go/backend-web-db',
    data: makeRenderData({
      language: 'go',
      buildTool: 'go',
      archetype: 'backend-web-db',
    }),
  },
  {
    name: 'java/backend-web-db',
    data: makeRenderData({
      language: 'java',
      buildTool: 'gradle',
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
      basePackage: 'com.example.demo',
    }),
  },
  {
    name: 'python/backend-web-db',
    data: makeRenderData({
      language: 'python',
      buildTool: 'pip',
      archetype: 'backend-web-db',
    }),
  },
  {
    name: 'typescript/backend-web-db',
    data: makeRenderData({
      language: 'typescript',
      buildTool: 'npm',
      archetype: 'backend-web-db',
    }),
  },
]

describe('generated GitHub Actions workflows pass actionlint (#actionlint-corpus)', () => {
  it('renders at least the full known set of workflow templates', () => {
    // Guard against the glob silently going empty (which would vacuously pass
    // every per-config assertion below). 35 templates as of this writing.
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(30)
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/01-pr-fast.yml.ejs')
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/_notify.yml.ejs')
  })

  for (const { name, data } of CONFIGS) {
    it.skipIf(!HAS_ACTIONLINT)(
      `every workflow template renders, is valid YAML, and passes actionlint (${name})`,
      () => {
        const tmp = mkdtempSync(join(tmpdir(), 'arbiter-workflow-syntax-'))
        try {
          const workflowsDir = join(tmp, '.github', 'workflows')
          mkdirSync(workflowsDir, { recursive: true })

          const renderFailures: string[] = []
          const yamlFailures: string[] = []
          const filesByTemplate = new Map<string, string>()

          for (const tpl of WORKFLOW_TEMPLATES) {
            let rendered: string
            try {
              rendered = renderTemplate(tpl, data)
            } catch (err) {
              renderFailures.push(`${tpl}: ${String(err).split('\n')[0]}`)
              continue
            }
            try {
              parseYaml(rendered)
            } catch (err) {
              yamlFailures.push(`${tpl}: ${String(err).split('\n')[0]}`)
              continue
            }
            const outName = tpl.slice(`${WORKFLOW_ROOT}/`.length).replace(/\.ejs$/, '')
            const outPath = join(workflowsDir, outName)
            writeFileSync(outPath, rendered)
            filesByTemplate.set(outPath, tpl)
          }

          expect(renderFailures, `templates failed to render under ${name}`).toEqual([])
          expect(yamlFailures, `templates rendered to invalid YAML under ${name}`).toEqual([])

          const outPaths = [...filesByTemplate.keys()]
          const check = spawnSync('actionlint', outPaths, { encoding: 'utf-8' })
          if (check.status !== 0) {
            // Map actionlint's absolute file paths back to the source template so a
            // failure names the `.yml.ejs` to fix, not an opaque tmpdir path.
            let report = check.stdout || check.stderr || `exit ${String(check.status)}`
            for (const [outPath, tpl] of filesByTemplate) {
              report = report.split(outPath).join(tpl)
            }
            expect.fail(`actionlint found issues under ${name}:\n${report}`)
          }
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
      },
    )
  }

  it.skipIf(HAS_ACTIONLINT)('SKIP reason: actionlint not installed locally', () => {
    expect(HAS_ACTIONLINT).toBe(false)
  })
})
