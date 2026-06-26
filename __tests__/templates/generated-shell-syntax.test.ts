// SPDX-License-Identifier: Apache-2.0
/**
 * Syntax-validation smoke for every emitted shell artifact (#1549).
 *
 * arbiter renders ~10 `*.sh.ejs` templates into every consumer project
 * (githooks/setup-hooks, local-wrapper/run, scripts/seed-*, scripts/lib/*,
 * ship/supervisor, api-e2e/run, …). Before this sweep these were asserted only
 * via `.toContain(...)` on a single rendered branch, and the consumer-side
 * `shellcheck` CI lane runs `git ls-files '*.sh'` against the *materialized*
 * project — so a branch that no fixture renders (e.g. `api-e2e/run.sh.ejs` has
 * go/java/python/node EJS branches but only the go branch is ever rendered in
 * the existing tests) ships unvalidated. EJS passes a broken shell body through
 * as plain text, so a syntax error in an unrendered branch reaches consumers
 * silently. The high-severity `_notify` workflow break (#1548) is live proof
 * this "never parse the rendered artifact" gap matters.
 *
 * This sweep renders every `*.sh.ejs` under representative configs — including
 * one per language so `run.sh`'s go/java/python/node branches all materialize —
 * and asserts `bash -n` (parse-only, no execution) returns status 0.
 *
 * Existing Code Survey (CANON-16): test-only file — no production source added.
 *   - grep for `bash`, `-n`, `shellcheck` across __tests__: heartbeat-shell-
 *     safety.test.ts asserts specific patterns in ONE rendered workflow's shell
 *     body; no always-on sweep `bash -n`s the rendered `.sh.ejs` corpus.
 *   - Decision: new always-on (L1) test mirroring generated-scripts-syntax.test
 *     (the `.mjs` node --check sweep) for the shell artifacts it does not cover.
 */
import { describe, it, expect } from 'vitest'
import { globSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

const TEMPLATES_DIR = resolve('src/templates')

// Every emitted shell artifact across the template tree, relative to
// `src/templates/` (e.g. `api-e2e/run.sh.ejs`, `scripts/lib/seed-common.sh.ejs`).
const SHELL_TEMPLATES = globSync('**/*.sh.ejs', { cwd: TEMPLATES_DIR }).sort()

function makeRenderData(overrides: Partial<ProjectConfig> = {}): Record<string, unknown> {
  return {
    ...makeConfig('/tmp/arbiter-shell-syntax', {
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
    // ship/ driver templates derive these from arbiter.json (generator defaults).
    harnessCmd: 'claude',
    shipLabel: 'ship',
  }
}

// One config per language so `api-e2e/run.sh.ejs`'s go/java/python/node EJS
// branches each materialize and get `bash -n`'d at least once.
const CONFIGS: Array<{ name: string; data: Record<string, unknown> }> = [
  {
    name: 'go/backend-api',
    data: makeRenderData({ language: 'go', buildTool: 'go', archetype: 'backend-api' }),
  },
  {
    name: 'java/backend-web-db',
    data: makeRenderData({
      language: 'java',
      buildTool: 'maven',
      archetype: 'backend-web-db',
      architectureStyle: 'hexagonal',
    }),
  },
  {
    name: 'python/backend-api',
    data: makeRenderData({ language: 'python', buildTool: 'pip', archetype: 'backend-api' }),
  },
  {
    name: 'typescript/backend-api',
    data: makeRenderData({ language: 'typescript', buildTool: 'npm', archetype: 'backend-api' }),
  },
]

describe('generated shell templates are valid bash (#1549)', () => {
  it('renders at least the full known set of shell templates', () => {
    // Guard against the glob silently going empty (which would vacuously pass
    // every per-config assertion below). 10 templates as of this writing.
    expect(SHELL_TEMPLATES.length).toBeGreaterThanOrEqual(8)
    expect(SHELL_TEMPLATES).toContain('api-e2e/run.sh.ejs')
    expect(SHELL_TEMPLATES).toContain('scripts/lib/seed-common.sh.ejs')
    expect(SHELL_TEMPLATES).toContain('githooks/setup-hooks.sh.ejs')
  })

  for (const { name, data } of CONFIGS) {
    it(`every shell template renders and passes bash -n (${name})`, () => {
      const tmp = mkdtempSync(join(tmpdir(), 'arbiter-shell-syntax-'))
      try {
        const renderFailures: string[] = []
        const syntaxFailures: string[] = []

        for (const tpl of SHELL_TEMPLATES) {
          let rendered: string
          try {
            rendered = renderTemplate(tpl, data)
          } catch (err) {
            renderFailures.push(`${tpl}: ${String(err).split('\n')[0]}`)
            continue
          }
          const outPath = join(tmp, tpl.replace(/\.ejs$/, '').replace(/[/\\]/g, '__'))
          writeFileSync(outPath, rendered)
          const check = spawnSync('bash', ['-n', outPath], { encoding: 'utf-8' })
          if (check.status !== 0) {
            syntaxFailures.push(
              `${tpl}: ${(check.stderr ?? '').split('\n').slice(0, 3).join(' | ')}`,
            )
          }
        }

        expect(renderFailures, `templates failed to render under ${name}`).toEqual([])
        expect(syntaxFailures, `templates rendered to invalid bash under ${name}`).toEqual([])
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})
