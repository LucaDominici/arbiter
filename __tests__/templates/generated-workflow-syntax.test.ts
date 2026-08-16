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

// The canonical language × governance matrix makes every language-specific EJS
// branch actionlinted at each emitted tier, rather than validating L4 only.
const WORKFLOW_STACKS = [
  { language: 'typescript', buildTool: 'npm' },
  {
    language: 'java',
    buildTool: 'gradle',
    architectureStyle: 'hexagonal',
    basePackage: 'com.example.demo',
  },
  { language: 'rust', buildTool: 'cargo' },
  { language: 'go', buildTool: 'go' },
  { language: 'python', buildTool: 'pip' },
] as const

const CONFIGS: Array<{ name: string; data: Record<string, unknown> }> = WORKFLOW_STACKS.flatMap(
  (stack) =>
    (['L1', 'L2', 'L3', 'L4'] as const).map((governanceLevel) => ({
      name: `${stack.language}/backend-web-db/${governanceLevel}`,
      data: makeRenderData({ ...stack, archetype: 'backend-web-db', governanceLevel }),
    })),
)

describe('generated GitHub Actions workflows pass actionlint (#actionlint-corpus)', () => {
  it('renders at least the full known set of workflow templates', () => {
    // Guard against the glob silently going empty (which would vacuously pass
    // every per-config assertion below). 35 templates as of this writing.
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(30)
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/01-pr-fast.yml.ejs')
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/_notify.yml.ejs')
    expect(CONFIGS).toHaveLength(20)
  })

  for (const { name, data } of CONFIGS) {
    // #2288: the whole case used to be `skipIf(!HAS_ACTIONLINT)`, so on CI — which has no
    // actionlint on PATH — the RENDER and YAML-validity assertions never ran either, even though
    // neither needs the binary. Only the actionlint invocation is tool-gated now; rendering every
    // template under every config is unconditional.
    it(`every workflow template renders, is valid YAML, and passes actionlint (${name})`, () => {
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

        if (!HAS_ACTIONLINT) return // render + YAML asserted above; the lint pass needs the binary
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
    })
  }

  it.skipIf(HAS_ACTIONLINT)('SKIP reason: actionlint not installed locally', () => {
    expect(HAS_ACTIONLINT).toBe(false)
  })
})
