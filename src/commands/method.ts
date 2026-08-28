// SPDX-License-Identifier: Apache-2.0
// #2039: `arbiter method` — a FEATURE lens over the FIELD-oriented `configure` surface.
//
// `configure` answers "what can I set?". Nothing answered "is feature X wired end-to-end,
// or half on?" — and a solo dev thinks in features, not in dotted paths. `method status`
// answers exactly that question and writes nothing; the interactive lens re-groups the
// existing `configure` fields by cluster and delegates every write back to `configure`.
// It is NOT a parallel config engine: there is no saveConfig call anywhere in this module
// or in method-interactive.ts.
//
// MVP scope, per the issue's own §9 phasing. Shipped: the catalog, its parity gate, the
// two-facet read-only probe, and the cluster lens. Deliberately NOT here, because each
// needs machinery this tree does not have or a decision not yet taken:
//   * `policy: 'pinned'` + `--assert-pinned` (v1) — a pinned row is only honest with a
//     real cited invariant per row, and that citation work is the guardrail's actual cost.
//     Shipping the field with every row set to 'tunable' would be scaffolding, not a
//     guardrail, so the field does not exist yet.
//   * `method set` / `method preset` / `method adopt` (v1).
//   * `method invariants` (v2, and only if #2034 ever ships a registry here).
//
// The two facets are the only ones a real primitive can observe (design §3.2). "Gate
// strength" is not a queryable property in this tree — there is no gate registry — and
// rendering a strength we cannot verify would be the fake-green this repo gates against.

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../utils/config.js'
import { jsonOutput } from '../utils/json-output.js'
import { GENERATED_MANIFEST_FILE, loadGeneratedManifest } from '../state/generated-manifest.js'
import { resolveSettingValue } from './settings.js'

/** The 7 top-level clusters the lens groups by (design §3.1). */
export type Cluster =
  | 'process-core'
  | 'testing'
  | 'gates-cli'
  | 'engineering'
  | 'agentic-harness'
  | 'ssot-traceability'
  | 'audit-evidence'

export const CLUSTERS: readonly Cluster[] = [
  'process-core',
  'testing',
  'gates-cli',
  'engineering',
  'agentic-harness',
  'ssot-traceability',
  'audit-evidence',
]

export interface MethodologyFeature {
  /** Stable id, cited by `method status --json` consumers. */
  id: string
  cluster: Cluster
  name: string
  /**
   * Dotted config paths this feature is bound to. MUST be a subset of configure.ts's
   * ALLOWED_PATHS — scripts/check-methodology-coverage.mjs fails the build otherwise, so
   * a row can never claim a path `configure --set` would reject.
   */
  configPaths: string[]
  /**
   * targetDir-relative manifest keys this feature emits when it is ON. Present ONLY where the
   * path was read out of the generator source AND passes both traps below; every other row
   * probes as Emit-n/a rather than inventing a file to look for. An honest `n/a` is worth
   * more than a facet that is wrong a third of the time.
   *
   * TRAP 1 — `skipIfExists`. src/utils/fs.ts records a manifest hash only when the on-disk
   * content matches arbiter's render. A `skipIfExists: true` file that already existed with
   * different content (brownfield, or the user edited it) is skipped and NEVER enters the
   * manifest — the feature is correctly on, yet the probe would report it missing. Only
   * `skipIfExists: false` paths are bound here.
   *
   * TRAP 2 — conditional emission. Most generators branch on archetype / language / buildTool
   * / governanceLevel after their feature guard, and several emit nothing at all for a valid
   * config (contract-testing has four such early returns). A path that is absent for a
   * legitimate reason is indistinguishable from one that was never generated, so those rows
   * stay unbound. Two more are unbindable in principle: features.taxonomy25d switches the
   * TEMPLATE but writes the same path either way, and the three *Mapping flags share one
   * OR-gated output file, so its presence attributes to none of them individually.
   *
   * ponytail: hardcoded per row — src/generators/registry.ts declares `run` as an opaque
   * closure with no output list, so no generator→artifact SSOT exists to derive this from.
   * If these go stale twice, add declared outputs to GeneratorSpec instead of re-auditing.
   */
  emits?: string[]
}

/**
 * Paths whose ABSENCE means ON. Three generators are gated with `!== false`
 * (src/generators/registry.ts:499/537/542), so an arbiter.json that never mentions them is a
 * project where they are running. Treating "absent" as off — the intuitive rule, and the rule
 * every other path follows — would report three live features as disabled on a default config,
 * which is the probe lying in the direction that matters most.
 */
const DEFAULT_ON_PATHS: ReadonlySet<string> = new Set([
  'features.contractTesting',
  'features.mutationTesting',
  'features.evidenceHarness',
])

/**
 * Paths that are settable but are NOT methodology — project SHAPE and access, which
 * describe what the project IS rather than how it is built. Listed explicitly with a
 * reason, because the parity gate requires every ALLOWED_PATH to be either lensed or
 * deliberately excluded: a new settable path cannot slip past the lens unnoticed.
 */
export const NON_METHODOLOGY_PATHS: ReadonlyMap<string, string> = new Map([
  ['archetype', 'project shape — what the project is, not how it is built'],
  ['architectureStyle', 'project shape'],
  ['isMultiTenant', 'project shape'],
  ['hasDatabase', 'project shape'],
  ['hasPublicApi', 'project shape'],
  ['contractType', 'project shape — the contract flavour, not whether contracts are tested'],
  ['permitGitHub', 'access/integration switch, not a methodology dial'],
])

/**
 * The lens. One row per methodology feature. Adding a row whose configPaths are not in
 * ALLOWED_PATHS, or leaving an ALLOWED_PATH neither lensed nor excluded above, fails
 * scripts/check-methodology-coverage.mjs.
 */
export const METHODOLOGY_CATALOG: readonly MethodologyFeature[] = [
  // ── process-core ───────────────────────────────────────────────────────────
  {
    id: 'M-PROC-01',
    cluster: 'process-core',
    name: 'Governance level',
    configPaths: ['governanceLevel'],
  },
  {
    id: 'M-PROC-02',
    cluster: 'process-core',
    name: 'Collaboration mode',
    configPaths: ['collaborationMode'],
  },
  {
    id: 'M-PROC-03',
    cluster: 'process-core',
    name: 'Branching strategy',
    configPaths: ['branchingStrategy'],
  },
  {
    id: 'M-PROC-04',
    cluster: 'process-core',
    name: 'Solo merge mode',
    configPaths: ['solo.mergeMode'],
  },
  {
    id: 'M-PROC-05',
    cluster: 'process-core',
    name: 'Solo-dev mode',
    configPaths: ['features.soloDevMode'],
  },

  // ── testing ────────────────────────────────────────────────────────────────
  {
    id: 'M-TEST-01',
    cluster: 'testing',
    name: 'Contract testing',
    configPaths: ['features.contractTesting'],
  },
  {
    id: 'M-TEST-02',
    cluster: 'testing',
    name: 'Mutation testing',
    configPaths: ['features.mutationTesting', 'thresholds.mutationScore'],
  },
  {
    id: 'M-TEST-03',
    cluster: 'testing',
    name: 'Performance testing',
    configPaths: ['features.perfTesting'],
  },
  {
    id: 'M-TEST-04',
    cluster: 'testing',
    name: 'Coverage floors',
    configPaths: ['thresholds.lineCoverage', 'thresholds.branchCoverage'],
  },

  // ── gates-cli ──────────────────────────────────────────────────────────────
  {
    id: 'M-GATE-01',
    cluster: 'gates-cli',
    name: 'Debt ratchet gates',
    configPaths: ['features.debtGates'],
    emits: ['scripts/debt-lib.mjs', 'scripts/capture-debt-baseline.mjs', 'scripts/debt-report.mjs'],
  },
  {
    id: 'M-GATE-02',
    cluster: 'gates-cli',
    name: 'Suppression ledger',
    configPaths: ['features.suppressions'],
    emits: ['suppressions/suppressions-schema.json', 'scripts/check-suppressions.mjs'],
  },
  {
    id: 'M-GATE-03',
    cluster: 'gates-cli',
    name: 'Acceptance-criteria anchor',
    configPaths: ['features.acceptanceAnchor'],
  },
  {
    id: 'M-GATE-04',
    cluster: 'gates-cli',
    name: 'Default gate level',
    configPaths: ['automation.defaultGateLevel'],
  },

  // ── engineering ────────────────────────────────────────────────────────────
  {
    id: 'M-ENG-01',
    cluster: 'engineering',
    name: 'Complexity ceiling',
    configPaths: ['thresholds.cyclomaticComplexity'],
  },
  {
    id: 'M-ENG-02',
    cluster: 'engineering',
    name: 'Method size limits',
    configPaths: ['thresholds.methodLength', 'thresholds.maxParams'],
  },

  // ── agentic-harness ────────────────────────────────────────────────────────
  {
    id: 'M-AGENT-01',
    cluster: 'agentic-harness',
    name: 'AI tool harness',
    configPaths: ['tools'],
  },
  {
    id: 'M-AGENT-02',
    cluster: 'agentic-harness',
    name: 'Ship autonomy level',
    configPaths: ['automation.autonomy'],
  },
  {
    id: 'M-AGENT-03',
    cluster: 'agentic-harness',
    name: 'Parallel worktree cap',
    configPaths: ['automation.maxParallelWorktrees'],
  },
  {
    id: 'M-AGENT-04',
    cluster: 'agentic-harness',
    name: 'Cross-model review consent',
    configPaths: [
      'crossModelReview.enabled',
      'crossModelReview.diffEgressConsent',
      'crossModelReview.providers',
      'crossModelReview.slots.codeReview',
      'crossModelReview.slots.redTeamReview',
      'crossModelReview.timeoutMs',
      'crossModelReview.onUnavailable',
    ],
  },

  // ── ssot-traceability ──────────────────────────────────────────────────────
  {
    id: 'M-SSOT-01',
    cluster: 'ssot-traceability',
    name: '25-dimension taxonomy',
    configPaths: ['features.taxonomy25d'],
  },
  {
    id: 'M-SSOT-02',
    cluster: 'ssot-traceability',
    name: 'CODEOWNERS notification',
    configPaths: ['features.codeownersNotify'],
  },

  // ── audit-evidence ─────────────────────────────────────────────────────────
  {
    id: 'M-AUDIT-01',
    cluster: 'audit-evidence',
    name: 'Evidence harness',
    configPaths: ['features.evidenceHarness'],
    // evidence-rotate.mjs is emitted ABOVE the flag guard (evidence-retention.ts:27) and so
    // proves nothing about the flag. done-evidence.mjs is inside it (:60).
    emits: ['scripts/done-evidence.mjs'],
  },
  {
    id: 'M-AUDIT-02',
    cluster: 'audit-evidence',
    name: 'Security scanning',
    configPaths: ['features.securityScanning'],
  },
  {
    id: 'M-AUDIT-03',
    cluster: 'audit-evidence',
    name: 'Risk register',
    configPaths: ['features.riskRegister'],
  },
  {
    id: 'M-AUDIT-04',
    cluster: 'audit-evidence',
    name: 'Operations handbook',
    configPaths: ['features.operationsHandbook'],
  },
  {
    id: 'M-AUDIT-05',
    cluster: 'audit-evidence',
    name: 'ISO 27001 mapping',
    configPaths: ['features.iso27001Mapping'],
  },
  {
    id: 'M-AUDIT-06',
    cluster: 'audit-evidence',
    name: 'NIS2 mapping',
    configPaths: ['features.nis2Mapping'],
  },
  {
    id: 'M-AUDIT-07',
    cluster: 'audit-evidence',
    name: 'GDPR mapping',
    configPaths: ['features.gdprMapping'],
  },
]

/** Config facet: is this path set to an ACTIVE value? */
export type ConfigFacet = 'active' | 'inactive'
/**
 * Emit facet.
 *   n/a       the row declares no artifact — never a fake green
 *   unknown   the project has no generated manifest at all, so emission is UNCHECKABLE.
 *             Distinct from `missing` on purpose: a repo that has never run `arbiter init` /
 *             `update` — and arbiter's own tree, which generates rather than consumes — has
 *             nothing to compare against, and calling that "the file was not emitted" would
 *             make every bound row look broken on a perfectly healthy project.
 */
export type EmitFacet = 'satisfied' | 'missing' | 'n/a' | 'unknown'
/**
 * Derived verdict (design §3.2). `wired` = on and its files are there; `partial` = on but
 * the files are not (generators never run, or the artifact was deleted); `off` = the user
 * turned it off. There is no verdict for a wiring the probes did not check.
 */
export type Verdict = 'wired' | 'partial' | 'unverified' | 'off'

export interface FeatureStatus {
  id: string
  cluster: Cluster
  name: string
  verdict: Verdict
  config: ConfigFacet
  emit: EmitFacet
  /** Per-path current values, so `--json` consumers never have to re-read arbiter.json. */
  values: Record<string, unknown>
  /** Declared artifacts that are absent from the manifest or from disk. */
  missingEmits: string[]
}

/**
 * A path counts as ACTIVE when it carries a real value: `true` for a boolean, any
 * non-empty value otherwise. `false`, `undefined` and `[]` are inactive.
 * Deliberately not "defined": a `false` feature flag is OFF, and reporting it as
 * configured would make every row green on a default config.
 */
function pathActive(config: unknown, path: string): boolean {
  const value = resolveSettingValue(config, path)
  if (value === undefined || value === null) return DEFAULT_ON_PATHS.has(path)
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value !== ''
  return true
}

/**
 * An artifact counts only when arbiter RECORDED emitting it and it is still on disk.
 * Manifest-without-file means it was deleted; file-without-manifest is someone else's.
 * Nothing is missing when there is nothing to check — that case is `unknown`, below.
 */
function resolveMissingEmits(
  declared: readonly string[],
  manifest: Record<string, string>,
  targetDir: string,
  manifestPresent: boolean,
): string[] {
  if (!manifestPresent || declared.length === 0) return []
  return declared.filter((key) => !(key in manifest) || !existsSync(join(targetDir, key)))
}

function resolveEmitFacet(
  declaredCount: number,
  manifestPresent: boolean,
  missingCount: number,
): EmitFacet {
  if (declaredCount === 0) return 'n/a'
  if (!manifestPresent) return 'unknown'
  return missingCount === 0 ? 'satisfied' : 'missing'
}

function resolveVerdict(config: ConfigFacet, emit: EmitFacet): Verdict {
  if (config === 'inactive') return 'off'
  if (emit === 'missing') return 'partial'
  if (emit === 'unknown') return 'unverified'
  return 'wired'
}

/**
 * Probe one feature. Pure: takes the already-loaded config and manifest, so `status`
 * reads arbiter.json and the manifest exactly once regardless of catalog size.
 *
 * A feature is Config-active when EVERY bound path is active. A multi-path row
 * (mutation testing = flag + threshold) is not "on" with half its binding set.
 */
export function probeFeature(
  feature: MethodologyFeature,
  config: unknown,
  manifest: Record<string, string>,
  targetDir: string,
  manifestPresent = true,
): FeatureStatus {
  const configFacet: ConfigFacet = feature.configPaths.every((p) => pathActive(config, p))
    ? 'active'
    : 'inactive'

  const values: Record<string, unknown> = {}
  for (const p of feature.configPaths) values[p] = resolveSettingValue(config, p) ?? null

  const declared = feature.emits ?? []
  // An artifact counts only when arbiter RECORDED emitting it and it is still on disk.
  // Manifest-without-file means it was deleted; file-without-manifest is someone else's.
  const missingEmits = resolveMissingEmits(declared, manifest, targetDir, manifestPresent)
  const emit = resolveEmitFacet(declared.length, manifestPresent, missingEmits.length)
  const verdict = resolveVerdict(configFacet, emit)

  return {
    id: feature.id,
    cluster: feature.cluster,
    name: feature.name,
    verdict,
    config: configFacet,
    emit,
    values,
    missingEmits,
  }
}

/** Probe the whole catalog against a project. Pure read — no write path exists. */
export function probeAll(targetDir: string, config: unknown): FeatureStatus[] {
  // loadGeneratedManifest returns {} on a first run and THROWS on a corrupt one
  // (fail-closed, INV-96). Both are correct here: a corrupt manifest must surface, not be
  // coerced into "nothing is emitted", which would render every row partial.
  // A MISSING manifest and an EMPTY one both load as {}, so presence is probed separately:
  // "arbiter never generated here" is not "arbiter generated nothing".
  const manifestPresent = existsSync(join(targetDir, GENERATED_MANIFEST_FILE))
  const manifest = loadGeneratedManifest(targetDir)
  return METHODOLOGY_CATALOG.map((f) =>
    probeFeature(f, config, manifest, targetDir, manifestPresent),
  )
}

interface MethodStatusOptions {
  dir?: string | undefined
  json?: boolean | undefined
}

const GLYPH: Record<Verdict, string> = {
  wired: 'OK  ',
  partial: 'WARN',
  unverified: '?   ',
  off: 'off ',
}
const EMIT_LABEL: Record<EmitFacet, string> = {
  satisfied: 'Emit ✓',
  missing: 'Emit ✗',
  'n/a': 'Emit n/a',
  unknown: 'Emit ?',
}

function facets(s: FeatureStatus): string {
  return `Config ${s.config === 'active' ? '✓' : '✗'} / ${EMIT_LABEL[s.emit]}`
}

/**
 * `arbiter method status` — read-only. Exit code stays 0 for a merely partial project:
 * this is a report, not a gate. A gate over the same data is the v1 `--assert-pinned`
 * work, and conflating the two would make `status` unusable in a shell pipeline.
 */
export function runMethodStatus(opts: MethodStatusOptions = {}): void {
  const targetDir = resolve(opts.dir ?? process.cwd())
  const config = loadConfig(targetDir)
  if (config == null) {
    process.stderr.write('arbiter: no arbiter.json found. Run `arbiter init` first.\n')
    process.exit(1)
    // Not dead code, despite the unreachable-code hint: process.exit is `never` only in
    // production. Tests mock it, and a mock that records and RETURNS would otherwise fall
    // through to the probe below with a null config. Same guard as configure-interactive.ts.
    return
  }

  const statuses = probeAll(targetDir, config)

  if (opts.json) {
    jsonOutput('method', 'ok', {
      clusters: CLUSTERS.map((cluster) => ({
        cluster,
        features: statuses.filter((s) => s.cluster === cluster),
      })),
      summary: {
        wired: statuses.filter((s) => s.verdict === 'wired').length,
        partial: statuses.filter((s) => s.verdict === 'partial').length,
        unverified: statuses.filter((s) => s.verdict === 'unverified').length,
        off: statuses.filter((s) => s.verdict === 'off').length,
      },
    })
    return
  }

  process.stdout.write('\narbiter method — methodology wiring status\n')
  for (const cluster of CLUSTERS) {
    const rows = statuses.filter((s) => s.cluster === cluster)
    if (rows.length === 0) continue
    process.stdout.write(`\n${cluster}\n`)
    for (const row of rows) {
      process.stdout.write(`  ${GLYPH[row.verdict]} ${row.name.padEnd(30)} ${facets(row)}\n`)
      for (const missing of row.missingEmits) {
        process.stdout.write(`         not emitted: ${missing}\n`)
      }
    }
  }
  const count = (v: Verdict): number => statuses.filter((s) => s.verdict === v).length
  const unverified = count('unverified')
  process.stdout.write(
    `\nwired ${count('wired')}  partial ${count('partial')}  ` +
      `unverified ${unverified}  off ${count('off')}\n`,
  )
  if (unverified > 0) {
    process.stdout.write(
      `No ${GENERATED_MANIFEST_FILE} here — emission is uncheckable, not missing. ` +
        `Run \`arbiter update\` to generate one.\n`,
    )
  }
  process.stdout.write(
    'Tune with `arbiter method` (interactive) — every write is delegated to `arbiter configure`.\n',
  )
}
