// SPDX-License-Identifier: Apache-2.0
/**
 * Required-keys-only render coverage (#1552).
 *
 * Under EJS `with(locals)`, a BARE reference to a type-OPTIONAL `ProjectConfig`
 * key (e.g. `<% if (enableSoloDevMode) { %>`) throws `ReferenceError` when that
 * key is absent — but every real config-build path (init/prompts/resolve/kit)
 * populates the optional axis keys, so the crash is MASKED in normal use and no
 * existing test renders the corpus against a required-keys-only config. A bare
 * optional-key reference can therefore regress with zero CI signal (exactly how
 * the `enableSoloDevMode` reference in the always-emitted, highest-fanout
 * `01-pr-fast` workflow shipped a latent crash).
 *
 * This test renders every top-level workflow template against a config that
 * contains ONLY the non-optional `ProjectConfig` keys. Any surviving bare
 * optional-key reference surfaces here as a render `ReferenceError`. The fix is
 * always `locals.<key>` (or a `typeof` guard), which yields `undefined` instead
 * of throwing — letting the template's own falsy branch run.
 *
 * `basePackage` is the one optional key intentionally exempt: the single render
 * boundary (`withBasePackageDefault` in src/utils/render.ts) injects it as an
 * own key so the many bare `basePackage` references in Java templates resolve
 * their own fallback. This test relies on that normalization (#1348).
 *
 * Existing Code Survey (CANON-16): test-only file. No production source added;
 * reuses `renderTemplate`. No existing test builds a minimal required-keys-only
 * config — ci-render/*-render tests all go through `makeConfig`, which fills
 * optional defaults and so cannot surface a bare optional-key reference.
 */
import { describe, it, expect } from 'vitest'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

const TEMPLATES_DIR = resolve('src/templates')
const WORKFLOW_TEMPLATES = globSync('github/workflows/*.yml.ejs', { cwd: TEMPLATES_DIR }).sort()

/**
 * A `ProjectConfig` populated with EXACTLY its non-optional keys — every `?:`
 * field is omitted. Rendering against this surfaces any bare reference to an
 * optional key. Kept as a literal (not `makeConfig`, which fills optional
 * defaults and would mask the very class of bug under test).
 */
const REQUIRED_ONLY: ProjectConfig = {
  targetDir: '.',
  projectName: 'demo',
  description: 'demo project',
  language: 'typescript',
  framework: null,
  archetype: 'backend-api',
  architectureStyle: 'none',
  isMultiTenant: false,
  hasDatabase: false,
  hasPublicApi: false,
  buildTool: 'npm',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  lintCommand: 'npm run lint',
  formatCommand: 'npm run format',
  tools: ['claude'],
  governanceLevel: 'L2',
  useGitHub: true,
  githubOwner: 'owner',
  githubRepo: 'repo',
  existing: {
    agentsMd: false,
    claudeDir: false,
    agentsDir: false,
    aiRulez: false,
    settingsJson: false,
    checkAllScript: false,
    geminiDir: false,
    windsurfRules: false,
    aiderConf: false,
  },
  languageHooks: [],
  enableDebtGates: true,
  enableSuppressions: true,
  enableSecurityScanning: true,
  invariantTiers: ['architectural', 'governance', 'data', 'operational'],
  contractType: 'none',
  lanes: [],
} as ProjectConfig

describe('templates render against a required-keys-only config (#1552)', () => {
  it('the corpus is non-empty (glob guard)', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(25)
    expect(WORKFLOW_TEMPLATES).toContain('github/workflows/01-pr-fast.yml.ejs')
  })

  it('no workflow throws on a config that omits every optional key', () => {
    const failures: string[] = []
    for (const tpl of WORKFLOW_TEMPLATES) {
      try {
        renderTemplate(tpl, REQUIRED_ONLY)
      } catch (err) {
        // A ReferenceError here is a bare optional-key reference: fix it to
        // `locals.<key>` (or a typeof guard) in the named template.
        failures.push(`${tpl}: ${String(err).split('\n')[0]}`)
      }
    }
    expect(failures, 'templates with a bare optional-key reference').toEqual([])
  })
})
