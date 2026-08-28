// SPDX-License-Identifier: Apache-2.0
// #1121: `arbiter settings` — discovery view of every settable arbiter.json path
// with its current value, grouped by category. Editing is delegated to
// `arbiter configure` (interactive on TTY, or --set). The SETTINGS_CATALOG is the
// single source of truth that check-settings-coverage.mjs reconciles against
// configure.ts ALLOWED_PATHS — drift is a build failure.

import { loadConfig } from '../utils/config.js'
import { jsonOutput } from '../utils/json-output.js'

interface SettingField {
  /** Dotted path as accepted by `arbiter configure --set path=value`. */
  path: string
  /** Human label shown in the discovery listing. */
  label: string
}

export interface SettingGroup {
  group: string
  fields: SettingField[]
}

/**
 * Catalog of every settable path, grouped for discovery. MUST stay in lockstep
 * with ALLOWED_PATHS in configure.ts (enforced by check-settings-coverage.mjs).
 */
export const SETTINGS_CATALOG: SettingGroup[] = [
  {
    group: 'Collaboration',
    fields: [
      { path: 'collaborationMode', label: 'Collaboration mode' },
      { path: 'solo.mergeMode', label: 'Solo merge mode' },
      { path: 'branchingStrategy', label: 'Branching strategy' },
    ],
  },
  {
    group: 'Governance',
    fields: [
      { path: 'governanceLevel', label: 'Governance level' },
      { path: 'permitGitHub', label: 'Permit GitHub integration' },
    ],
  },
  {
    group: 'Tools',
    fields: [{ path: 'tools', label: 'AI tools' }],
  },
  {
    group: 'Project shape',
    fields: [
      { path: 'archetype', label: 'Archetype' },
      { path: 'architectureStyle', label: 'Architecture style' },
      { path: 'contractType', label: 'Contract type' },
      { path: 'isMultiTenant', label: 'Multi-tenant' },
      { path: 'hasDatabase', label: 'Has database' },
      { path: 'hasPublicApi', label: 'Has public API' },
    ],
  },
  {
    group: 'Features',
    fields: [
      { path: 'features.debtGates', label: 'Debt gates' },
      { path: 'features.suppressions', label: 'Suppressions' },
      { path: 'features.securityScanning', label: 'Security scanning' },
      { path: 'features.mutationTesting', label: 'Mutation testing' },
      { path: 'features.contractTesting', label: 'Contract testing' },
      { path: 'features.evidenceHarness', label: 'Evidence harness' },
      { path: 'features.acceptanceAnchor', label: 'Acceptance-criteria anchor gate (INV-138)' },
      { path: 'features.soloDevMode', label: 'Solo dev mode (deprecated)' },
      // #1887-A: activation path for 3 previously-unreachable opt-in generators.
      { path: 'features.codeownersNotify', label: 'CODEOWNERS post-merge email notify (L2+)' },
      { path: 'features.taxonomy25d', label: '26-dimension compliance test taxonomy' },
      { path: 'features.perfTesting', label: 'k6 performance testing ecosystem' },
      // #1887 (Finding-A residual): activation path for the 5 compliance
      // doc-pack flags previously reachable only via --preset industrial-grade.
      { path: 'features.riskRegister', label: 'Risk register doc' },
      { path: 'features.operationsHandbook', label: 'Operations handbook doc' },
      { path: 'features.iso27001Mapping', label: 'ISO 27001 control mapping' },
      { path: 'features.nis2Mapping', label: 'NIS2 control mapping' },
      { path: 'features.gdprMapping', label: 'GDPR control mapping' },
    ],
  },
  {
    group: 'Automation',
    fields: [
      // #1261: ship-autonomy axis (ADR-093 §4). Absent = L0 (ask each ship step);
      // legacy configs without the block stay valid. No `arbiter init` flag by
      // design — set here, via a recipe, or per-run with `arbiter ship --autonomy`.
      { path: 'automation.autonomy', label: 'Ship autonomy level (absent = L0)' },
      // #1306 (ADR-094 §Decision.4): orchestration prefs derived per collaboration
      // mode / governance level at init.
      // #2333: maxParallelWorktrees is PERSISTENT-ONLY — no per-run `--set`, no
      // resolver floor. It is a persistent wave cap consumed by doctor/wizard
      // coherence and rendered /drain surfaces; absent ⇒ collaboration-mode default.
      { path: 'automation.maxParallelWorktrees', label: 'Max parallel wave worktrees' },
      // defaultGateLevel keeps its resolver floor (absent ⇒ L1 at every read site).
      { path: 'automation.defaultGateLevel', label: 'Default gate level (L1|L2)' },
    ],
  },
  {
    group: 'Cross-model review',
    fields: [
      { path: 'crossModelReview.enabled', label: 'Cross-model review enabled' },
      { path: 'crossModelReview.diffEgressConsent', label: 'Diff egress consent' },
      { path: 'crossModelReview.providers', label: 'Review providers' },
      { path: 'crossModelReview.slots.codeReview', label: 'Code-review slots' },
      { path: 'crossModelReview.slots.redTeamReview', label: 'Red-team-review slots' },
      { path: 'crossModelReview.timeoutMs', label: 'Review timeout (ms)' },
      { path: 'crossModelReview.onUnavailable', label: 'Unavailable-provider policy' },
    ],
  },
  {
    group: 'Thresholds',
    fields: [
      { path: 'thresholds.lineCoverage', label: 'Line coverage %' },
      { path: 'thresholds.branchCoverage', label: 'Branch coverage %' },
      { path: 'thresholds.mutationScore', label: 'Mutation score %' },
      { path: 'thresholds.cyclomaticComplexity', label: 'Cyclomatic complexity' },
      { path: 'thresholds.methodLength', label: 'Method length' },
      { path: 'thresholds.maxParams', label: 'Max parameters' },
    ],
  },
]

/** Every path the settings catalog surfaces (used by the coverage gate + tests). */
export const SETTINGS_PATHS: ReadonlySet<string> = new Set(
  SETTINGS_CATALOG.flatMap((g) => g.fields.map((f) => f.path)),
)

/** Resolve a dotted path against a loaded config object. */
export function resolveSettingValue(config: unknown, path: string): unknown {
  let cursor: unknown = config
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(unset)'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  // Objects and null → JSON (never relies on default toString). Config values
  // are JSON-derived, so this branch only sees objects/null in practice.
  return JSON.stringify(value)
}

export interface SettingsOptions {
  dir?: string
  json?: boolean
}

/** Print the grouped discovery listing of all settable paths + current values. */
export function runSettings(opts: SettingsOptions = {}): void {
  const dir = opts.dir ?? process.cwd()
  const config = loadConfig(dir)

  if (config == null) {
    process.stderr.write('arbiter: no arbiter.json found. Run `arbiter init` first.\n')
    process.exit(1)
  }

  if (opts.json) {
    const out = SETTINGS_CATALOG.map((g) => ({
      group: g.group,
      fields: g.fields.map((f) => ({
        path: f.path,
        label: f.label,
        value: resolveSettingValue(config, f.path) ?? null,
      })),
    }))
    jsonOutput('settings', 'ok', { groups: out })
    return
  }

  process.stdout.write('\narbiter settings — current configuration\n')
  for (const group of SETTINGS_CATALOG) {
    process.stdout.write(`\n${group.group}\n`)
    for (const field of group.fields) {
      const value = formatValue(resolveSettingValue(config, field.path))
      process.stdout.write(`  ${field.path.padEnd(34)} ${value}\n`)
    }
  }
  process.stdout.write(
    '\nEdit with `arbiter configure` (interactive) or `arbiter configure --set <path>=<value>`.\n',
  )
}
