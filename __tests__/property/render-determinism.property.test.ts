// SPDX-License-Identifier: Apache-2.0
/**
 * Render-determinism property test (literature GAP 4 — combination axis).
 *
 * "Determinism as precondition" is the literature's own framing (golden-master
 * / approval testing only works if capture is reproducible). fixture-bake.test.ts
 * relies on it implicitly (content-hash comparison across runs); this test
 * proves the underlying assumption directly and combinatorially, extending
 * render-coverage.test.ts (#1552) beyond its single required-keys-only fixed
 * point to a SAMPLED slice of the ProjectConfig space (fast-check is already a
 * dep — see config-migrations.property.test.ts for the established pattern).
 *
 * Two properties, per sampled config, across every top-level workflow
 * template (same corpus as render-coverage.test.ts):
 *   1. render never throws (extends #1552's single fixed point to a sample).
 *   2. rendering the SAME config twice yields byte-identical output — the
 *      actual determinism precondition golden-master hashing depends on.
 *
 * Language domain is deliberately scoped to the 5 stacks the codebase's own
 * full matrix tests exercise (cross-product.test.ts's LANGUAGES) — 'kotlin',
 * 'multi', and 'unknown' have thinner template coverage today and are out of
 * scope for this sweep (would need their own investigation, not a byproduct
 * of a testing-infra hardening pass).
 */
import * as fc from 'fast-check'
import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'
import type {
  Archetype,
  ArchitectureStyle,
  CollaborationMode,
  ContractType,
  DeployTarget,
  GovernanceLevel,
  Language,
  ProjectConfig,
} from '../../src/wizard/types.js'

const TEMPLATES_DIR = resolve('src/templates')
const WORKFLOW_TEMPLATES = globSync('github/workflows/*.yml.ejs', { cwd: TEMPLATES_DIR }).sort()

const FC_CONFIG = {
  seed: process.env.FC_SEED != null ? Number(process.env.FC_SEED) : 42,
  numRuns: 50,
  endOnFailure: true,
}

const BUILD_TOOL_BY_LANGUAGE: Record<Language, string> = {
  typescript: 'npm',
  java: 'gradle',
  rust: 'cargo',
  go: 'go',
  python: 'pip',
  kotlin: 'gradle',
  multi: 'npm',
  unknown: 'npm',
}

const LANGUAGES: Language[] = ['typescript', 'java', 'rust', 'go', 'python']
const ARCHETYPES: Archetype[] = [
  'backend-web-db',
  'cli',
  'library',
  'data-pipeline',
  'frontend-spa',
  'embedded',
]
const GOVERNANCE_LEVELS: GovernanceLevel[] = ['L1', 'L2', 'L3', 'L4']
const ARCHITECTURE_STYLES: ArchitectureStyle[] = [
  'hexagonal',
  'layered',
  'modular-monolith',
  'none',
]
const COLLABORATION_MODES: CollaborationMode[] = ['trunk-solo', 'peer-review', 'gated-review']
const CONTRACT_TYPES: ContractType[] = [
  'rest-owned',
  'rest-public',
  'graphql',
  'grpc',
  'message-queue',
  'none',
]
const DEPLOY_TARGETS: DeployTarget[] = [
  'ghcr',
  'azure-container-app',
  'aws-ecs',
  'gcp-cloud-run',
  'nas-compose',
  'none',
]

/** Sampled ProjectConfig overrides — a representative slice, not the full field set. */
const sampledConfig: fc.Arbitrary<ProjectConfig> = fc
  .record({
    language: fc.constantFrom(...LANGUAGES),
    archetype: fc.constantFrom(...ARCHETYPES),
    governanceLevel: fc.constantFrom(...GOVERNANCE_LEVELS),
    architectureStyle: fc.constantFrom(...ARCHITECTURE_STYLES),
    collaborationMode: fc.constantFrom(...COLLABORATION_MODES),
    contractType: fc.constantFrom(...CONTRACT_TYPES),
    deployTarget: fc.constantFrom(...DEPLOY_TARGETS),
    useGitHub: fc.boolean(),
    hasPublicApi: fc.boolean(),
    hasDatabase: fc.boolean(),
    isMultiTenant: fc.boolean(),
    enableDebtGates: fc.boolean(),
    enableSecurityScanning: fc.boolean(),
    enableSuppressions: fc.boolean(),
    enableMutationTesting: fc.boolean(),
    enablePerfTesting: fc.boolean(),
    enableCodeownersNotify: fc.boolean(),
  })
  .map((overrides) =>
    makeConfig('/tmp/arbiter-property-render', {
      ...overrides,
      buildTool: BUILD_TOOL_BY_LANGUAGE[overrides.language],
      githubOwner: overrides.useGitHub ? 'octo-org' : null,
      githubRepo: overrides.useGitHub ? 'octo-repo' : null,
      basePackage: overrides.language === 'java' ? 'com.example.demo' : undefined,
    }),
  )

describe('render-determinism property (fast-check)', () => {
  it('the workflow corpus is non-empty (glob guard)', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(30)
  })

  it('no workflow template throws for a sampled valid ProjectConfig', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(sampledConfig, (config) => {
        const failures: string[] = []
        for (const tpl of WORKFLOW_TEMPLATES) {
          try {
            renderTemplate(tpl, config as unknown as Record<string, unknown>)
          } catch (err) {
            failures.push(`${tpl}: ${String(err).split('\n')[0]}`)
          }
        }
        expect(failures, 'templates that threw for this sampled config').toEqual([])
      }),
      FC_CONFIG,
    )
  })

  it('workflow templates render byte-identically on repeated render', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(sampledConfig, (config) => {
        for (const tpl of WORKFLOW_TEMPLATES) {
          const first = renderTemplate(tpl, config as unknown as Record<string, unknown>)
          const second = renderTemplate(tpl, config as unknown as Record<string, unknown>)
          expect(second, `${tpl} rendered differently on a repeated call`).toBe(first)
        }
      }),
      FC_CONFIG,
    )
  })
})
