// SPDX-License-Identifier: Apache-2.0
import type { ArbiterConfigV2 } from './schema.js'

export type GeneratorKey =
  | 'agents-md'
  | 'global-invariants'
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'copilot'
  | 'gemini'
  | 'windsurf'
  | 'aider'
  | 'skills'
  | 'agents-claude'
  | 'github'
  | 'root'
  | 'check-all'
  | 'debt-gates'
  | 'debt-ratchet'
  | 'coverage'
  | 'duplication'
  | 'suppressions'
  | 'security'
  | 'archunit'
  | 'eslint-boundaries'
  | 'rust-boundaries'
  | 'go-boundaries'
  | 'python-boundaries'
  | 'mutation'
  | 'nightly'
  | 'integration-testing'
  | 'contract-testing'
  | 'stride-enforcement'
  | 'evidence-retention'
  | 'test-taxonomy'
  | 'behavioral-tests'
  | 'playwright-python'
  | 'playwright-ts'
  | 'ssot'
  | 'githooks'
  | 'ship-driver'
  | 'github-setup'
  | 'docs'
  | 'api-middleware'
  | 'seed'
  | 'evidence-backlog'
  | 'self-validation'
  | 'operations'
  | 'risk-register'
  | 'compliance'
  | 'compliance-menu'
  | 'pharma'
  | 'iso27001-controls'
  | 'iso9001'
  | 'observability'
  | 'auth'
  | 'ci-tier'
  | 'local-wrapper'
  | 'env-template'
  | 'infra'
  | 'audit-toolchain'
  | 'perf-k6'
  | 'modulith'
  | 'quality'
  | 'frontend-governance'
  | 'frontend-quality'
  | 'feature-matrix'
  | 'anti-drift-validators'
  | 'resilience'
  | 'gap'
  | 'wiki'
  | 'solo-exception'
  | 'anti-proforma'
  | 'commit-footer-rationale'
  | 'stack-conformity'
  | 'test-pyramid'
  | 'api-e2e'
  | 'conformance'
  | 'gold-kit'

export interface ConfigDiff {
  paths: string[]
}

const AXIS_FIELDS = new Set([
  'governanceLevel',
  'archetype',
  'architectureStyle',
  'isMultiTenant',
  'hasDatabase',
  // #1317: a database engine migration (none→postgresql, postgresql→sqlite, …) changes
  // the integration-testing scaffolding (containerless vs testcontainers vs no DB test).
  // Treat as an axis field ⇒ full regen, which includes integration-testing.
  'databaseEngine',
  'hasPublicApi',
  'contractType',
  // language is an axis field: a language migration (TS→Python, Python→Java, etc.) affects
  // nearly every generator (e2e, quality, archunit, modulith, …). Full regen is correct.
  // language is persisted in ArbiterConfigV2 so diffConfig can detect it.
  'language',
])

// Normalize undefined optional fields to their semantic defaults so
// that a stored "none"/"false" doesn't diff against a user config that
// simply omits the key (both mean the same thing).
const FIELD_DEFAULTS: Record<string, unknown> = {
  contractType: 'none',
  architectureStyle: 'none',
  archetype: 'library',
  isMultiTenant: false,
  hasDatabase: false,
  // #1317: legacy/absent engine normalizes to 'none' so a stored config without
  // the field doesn't spuriously diff against an explicit none-engine config.
  databaseEngine: 'none',
  hasPublicApi: false,
}

function normField(key: string, val: unknown): unknown {
  if (val === undefined && key in FIELD_DEFAULTS) return FIELD_DEFAULTS[key]
  return val
}

type ImpactedSet = Set<GeneratorKey | '*'>

const PATH_TO_KEYS: Readonly<Record<string, GeneratorKey[]>> = {
  // githooks is always-on (enabled: true in registry). It lives under the
  // `tools` key as belt-and-suspenders: any tool change should re-run the
  // githooks generator because tool config can affect which gate steps the
  // generated hooks invoke.
  tools: [
    'agents-md',
    'claude',
    'codex',
    'cursor',
    'copilot',
    'gemini',
    'windsurf',
    'aider',
    'skills',
    'agents-claude',
    'githooks',
    'ship-driver',
  ],
  useGitHub: ['github', 'root', 'check-all'],
  permitGitHub: ['github', 'root', 'check-all', 'ci-tier', 'github-setup'],
  'features.debtGates': [
    'debt-gates',
    'debt-ratchet',
    'coverage',
    'duplication',
    'stride-enforcement',
    'anti-drift-validators',
  ],
  'features.securityScanning': ['security'],
  'features.mutationTesting': ['mutation', 'check-all', 'nightly'],
  'features.contractTesting': ['contract-testing', 'integration-testing', 'github'],
  'features.evidenceHarness': ['evidence-retention', 'nightly'],
  'features.selfValidationHarness': ['self-validation'],
  'features.suppressions': ['suppressions'],
  'features.soloDevMode': ['github', 'githooks'],
  // ADR-051 (#1119): collaborationMode drives claude template ceremony (task.md / CLAUDE.md),
  // github CI shape, githooks, root docs, and check-all gate variants.
  collaborationMode: ['github', 'githooks', 'root', 'check-all', 'claude'],
  // solo.mergeMode and branchingStrategy override the derived merge/branch axis — affects
  // claude templates (task.md Phase 10) and github workflows (branching strategy).
  solo: ['claude', 'github'],
  branchingStrategy: ['claude', 'github'],
  'thresholds.lineCoverage': ['check-all', 'coverage'],
  'thresholds.branchCoverage': ['check-all', 'coverage'],
  'thresholds.mutationScore': ['mutation', 'check-all'],
  'thresholds.cyclomaticComplexity': ['debt-gates'],
  'thresholds.methodLength': ['debt-gates'],
  'thresholds.maxParams': ['debt-gates'],
  invariantTiers: ['global-invariants', 'agents-md'],
  hasPublicApi: ['api-middleware'],
  industryOverlay: ['pharma', 'iso27001-controls', 'iso9001'],
  'observability.provider': ['observability'],
  'auth.provider': ['auth'],
  // bare 'frontend' path: emitted when frontend block is added/removed wholesale
  frontend: ['frontend-governance', 'frontend-quality'],
  'frontend.framework': ['frontend-governance', 'frontend-quality'],
  'frontend.stateManager': ['frontend-governance'],
  'frontend.validationLib': ['frontend-governance'],
  lanes: ['frontend-governance', 'frontend-quality', 'playwright-ts', 'playwright-python'],
}

function diffLeaf(prefix: string, a: unknown, b: unknown, paths: string[]): void {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) paths.push(prefix)
    return
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      diffLeaf(
        `${prefix}.${k}`,
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        paths,
      )
    }
    return
  }
  if (a !== b) paths.push(prefix)
}

export function diffConfig(stored: ArbiterConfigV2, next: ArbiterConfigV2): ConfigDiff {
  const paths: string[] = []
  const s = stored as unknown as Record<string, unknown>
  const n = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(s), ...Object.keys(n)])
  for (const k of keys) {
    const a = normField(k, s[k])
    const b = normField(k, n[k])
    if (
      k === 'features' ||
      k === 'thresholds' ||
      k === 'observability' ||
      k === 'auth' ||
      k === 'frontend'
    ) {
      diffLeaf(k, a, b, paths)
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      paths.push(k)
    }
  }
  return { paths }
}

export function impactedGenerators(diff: ConfigDiff): ImpactedSet {
  const result: ImpactedSet = new Set()

  for (const path of diff.paths) {
    if (AXIS_FIELDS.has(path)) {
      result.add('*')
      return result
    }
  }

  for (const path of diff.paths) {
    const keys = PATH_TO_KEYS[path]
    if (keys) {
      for (const k of keys) result.add(k)
    }
  }

  return result
}
