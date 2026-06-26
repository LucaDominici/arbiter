// SPDX-License-Identifier: Apache-2.0
/**
 * Syntax-validation smoke for every emitted executable gate script (#1540).
 *
 * arbiter ships ~91 executable `.mjs` gate scripts rendered from
 * `src/templates/scripts/*.mjs.ejs` into every consumer project. Before this
 * test, only 3 were ever `node --check`-validated against rendered output;
 * the rest were "tested" with `render).not.toThrow()`, `.toContain(...)`, or
 * `existsSync(...)` — none of which prove the emitted artifact is parseable
 * JavaScript. EJS happily passes a broken JS body through as plain text, and
 * two of these templates contain ZERO EJS tags (pure static `.mjs` wrapped in
 * `.ejs`), so a hand-edited syntax error in either would ship green to every
 * consumer. Because many of these scripts run advisory (`runWarnCheck`) in the
 * consumer gate, a runtime crash would only WARN, hiding the break.
 *
 * This is the CANON-07 spirit (a generator that emits an executable artifact
 * must have an EXECUTED test). Here we render every script template under
 * several representative configs and assert `node --check` parses each one.
 *
 * Existing Code Survey (CANON-16): test-only file — no production source added.
 *   - grep for "node', \['--check'" across __tests__: only generated-check-all
 *     (L2-gated), conformance.test, gold-kit.test syntax-check a single script
 *     each. No always-on sweep over the full scripts/ template set exists.
 *   - Decision: new always-on (L1) test that iterates the whole template glob.
 *     Rejected extending generated-check-all.test.ts: it is `describe.skipIf`
 *     L2-gated (needs toolchains) and scoped to one script's runtime behaviour;
 *     a cheap parse-only sweep belongs in an always-on unit test.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

const SCRIPTS_TEMPLATE_DIR = resolve('src/templates/scripts')

const SCRIPT_TEMPLATES = readdirSync(SCRIPTS_TEMPLATE_DIR)
  .filter((f) => f.endsWith('.mjs.ejs'))
  .sort()

/**
 * Build the render context for a script template. Beyond ProjectConfig,
 * generators derive a handful of extra fields onto the EJS data object
 * (computeMetricsProfile, resolveEffectiveThresholds, evidence-retention
 * defaults, etc.). We supply representative values for those so every
 * template — including the few that reference them — renders without a
 * ReferenceError. Missing any of these is itself a render failure the test
 * would surface, so the set is self-checking.
 */
function makeRenderData(overrides: Partial<ProjectConfig> = {}): Record<string, unknown> {
  return {
    ...makeConfig('/tmp/arbiter-script-syntax', {
      hasPublicApi: true,
      basePackage: 'com.example.demo',
      contractType: 'rest-owned',
      ...overrides,
    }),
    // Derived render vars added by generators (not part of ProjectConfig):
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

// Representative configs to exercise the language/governance/archetype EJS
// branches in the script templates. Each is rendered for every template.
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
    name: 'python/L1/backend-api',
    data: makeRenderData({
      language: 'python',
      buildTool: 'poetry',
      archetype: 'backend-api',
      governanceLevel: 'L1',
      enableDebtGates: false,
      enableSecurityScanning: false,
    }),
  },
  {
    name: 'rust/L4/library',
    data: makeRenderData({
      language: 'rust',
      buildTool: 'cargo',
      archetype: 'library',
      governanceLevel: 'L4',
    }),
  },
  {
    name: 'java/L3/backend-web-db',
    data: makeRenderData({
      language: 'java',
      buildTool: 'gradle',
      archetype: 'backend-web-db',
      governanceLevel: 'L3',
      architectureStyle: 'hexagonal',
    }),
  },
  {
    name: 'typescript/L2/frontend-spa',
    data: makeRenderData({
      language: 'typescript',
      archetype: 'frontend-spa',
      governanceLevel: 'L2',
    }),
  },
]

describe('generated executable script templates are valid JavaScript (#1540, CANON-07)', () => {
  it('renders at least the full known set of script templates', () => {
    // Guard against the glob silently going empty (which would vacuously pass
    // every per-config assertion below). 91 templates as of this writing.
    expect(SCRIPT_TEMPLATES.length).toBeGreaterThanOrEqual(80)
    expect(SCRIPT_TEMPLATES).toContain('check-all.mjs.ejs')
    expect(SCRIPT_TEMPLATES).toContain('check-duplication.mjs.ejs')
    expect(SCRIPT_TEMPLATES).toContain('validate-k6-scenarios.mjs.ejs')
  })

  for (const { name, data } of CONFIGS) {
    it(`every script template renders and passes node --check (${name})`, () => {
      const tmp = mkdtempSync(join(tmpdir(), 'arbiter-script-syntax-'))
      try {
        const renderFailures: string[] = []
        const syntaxFailures: string[] = []

        for (const tpl of SCRIPT_TEMPLATES) {
          let rendered: string
          try {
            rendered = renderTemplate(`scripts/${tpl}`, data)
          } catch (err) {
            renderFailures.push(`${tpl}: ${String(err).split('\n')[0]}`)
            continue
          }
          const outPath = join(tmp, tpl.replace(/\.ejs$/, ''))
          writeFileSync(outPath, rendered)
          const check = spawnSync('node', ['--check', outPath], { encoding: 'utf-8' })
          if (check.status !== 0) {
            syntaxFailures.push(
              `${tpl}: ${(check.stderr ?? '').split('\n').slice(0, 3).join(' | ')}`,
            )
          }
        }

        expect(renderFailures, `templates failed to render under ${name}`).toEqual([])
        expect(
          syntaxFailures,
          `templates rendered to unparseable JavaScript under ${name}`,
        ).toEqual([])
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})
