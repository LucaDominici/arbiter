// SPDX-License-Identifier: Apache-2.0
// #1121: `arbiter settings` — discovery view of every settable arbiter.json path
// with its current value, grouped by category. Editing is delegated to
// `arbiter configure` (interactive on TTY, or --set). The SETTINGS_CATALOG is the
// single source of truth that check-settings-coverage.mjs reconciles against
// configure.ts ALLOWED_PATHS — drift is a build failure.

import { loadConfig } from '../utils/config.js'

export interface SettingField {
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
      { path: 'features.soloDevMode', label: 'Solo dev mode (deprecated)' },
    ],
  },
  {
    group: 'Automation',
    fields: [
      // #1261: ship-autonomy axis (ADR-093 §4). Absent = L0 (ask each ship step);
      // legacy configs without the block stay valid. No `arbiter init` flag by
      // design — set here, via a recipe, or per-run with `arbiter ship --autonomy`.
      { path: 'automation.autonomy', label: 'Ship autonomy level (absent = L0)' },
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
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
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
