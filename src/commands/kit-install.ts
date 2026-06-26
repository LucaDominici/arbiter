// SPDX-License-Identifier: Apache-2.0
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadConfig, saveConfig, type ArbiterConfig } from '../utils/config.js'
import type { BrownfieldClass } from '../kit/thresholds.js'
import { buildWavePlan, type DimAssessment, type WavePlan } from '../kit/wave-engine.js'
import { loadCatalog } from '../kit/catalog.js'
import { evaluateApplicability } from '../kit/applicability.js'
import { measureDim, getMeasureDiagnosticErrors, type MeasureResult } from '../kit/measure.js'
import { renderAuditMarkdown } from '../kit/audit-report.js'
import { emitWaveIssues } from '../kit/emit-issues.js'
import { buildRegistry, runGeneratorsFromRegistry } from '../generators/registry.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework } from '../detectors/framework.js'
import { detectExisting } from '../detectors/existing.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { detectGitInfo } from '../detectors/git.js'
import { detectLanguageWithSource } from '../detectors/language.js'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import type { ProjectConfig, Language, GovernanceLevel } from '../wizard/types.js'

export interface KitInstallOptions {
  targetDir: string
  /** Project language. When omitted, auto-detected from the target repo (#1095). */
  language?: string
  brownfieldClass: BrownfieldClass
  dryRun?: boolean
  emitIssues?: boolean
  reportPath?: string
}

interface PhaseResult {
  phase: 'DETECT' | 'MEASURE' | 'SCAFFOLD' | 'ASSESS' | 'PLAN' | 'VERIFY'
  output: string
}

export interface KitInstallResult {
  ok: boolean
  phases: PhaseResult[]
  wavePlan?: WavePlan
  generatorErrors?: string[]
  error?: string
}

function storedDefaults(stored: ArbiterConfig, level: GovernanceLevel): Partial<ProjectConfig> {
  return {
    archetype: stored.archetype ?? 'library',
    architectureStyle: stored.architectureStyle ?? 'none',
    isMultiTenant: stored.isMultiTenant ?? false,
    hasDatabase: stored.hasDatabase ?? false,
    hasPublicApi: stored.hasPublicApi ?? false,
    tools: stored.tools,
    governanceLevel: stored.governanceLevel,
    useGitHub: stored.permitGitHub ?? stored.useGitHub ?? false,
    enableDebtGates: stored.features.debtGates,
    enableSuppressions: stored.features.suppressions,
    enableSecurityScanning: stored.features.securityScanning,
    enableMutationTesting: stored.features.mutationTesting,
    enableContractTesting: stored.features.contractTesting,
    enableEvidenceHarness: stored.features.evidenceHarness,
    enableSelfValidationHarness: stored.features.selfValidationHarness ?? true,
    invariantTiers: stored.invariantTiers ?? presetToTiers(defaultPresetForLevel(level)),
    contractType: stored.contractType ?? 'none',
    lanes: stored.lanes ?? [],
    ...(stored.acceptBetaTools !== undefined ? { acceptBetaTools: stored.acceptBetaTools } : {}),
    ...(stored.observability !== undefined ? { observability: stored.observability } : {}),
    ...(stored.auth !== undefined ? { auth: stored.auth } : {}),
  }
}

function buildProjectConfig(
  arbiterConfig: ArbiterConfig | null,
  opts: KitInstallOptions,
): ProjectConfig {
  const language = opts.language as Language
  const level: GovernanceLevel = arbiterConfig?.governanceLevel ?? 'L2'
  const buildCmds = detectBuildCommands(opts.targetDir, language)
  const gitInfo = detectGitInfo(opts.targetDir)

  return {
    targetDir: opts.targetDir,
    projectName: gitInfo.projectName ?? 'arbiter-project',
    description: '',
    language,
    framework: detectFramework(opts.targetDir, language),
    archetype: 'library',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    tools: ['claude'],
    governanceLevel: level,
    useGitHub: gitInfo.githubOwner !== null,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing: detectExisting(opts.targetDir),
    languageHooks: getLanguageHooks(language),
    enableDebtGates: level !== 'L1',
    enableSuppressions: true,
    enableSecurityScanning: level !== 'L1',
    invariantTiers: presetToTiers(defaultPresetForLevel(level)),
    contractType: 'none',
    // Optional boolean fields default to false so EJS templates can reference
    // them without ReferenceError — templates use bare `enableX`, not `config.enableX`.
    enableSoloDevMode: false,
    enableMcpFallback: false,
    enableNoSkippedTests: true,
    enableTaxonomy25d: false,
    enableOperationsHandbook: false,
    enableRiskRegister: false,
    enableIso27001Mapping: false,
    enableNis2Mapping: false,
    enableGdprMapping: false,
    enablePerfTesting: false,
    enableMutationTesting: false,
    enableContractTesting: false,
    enableEvidenceHarness: false,
    enableSelfValidationHarness: true,
    lanes: [],
    ...(arbiterConfig ? storedDefaults(arbiterConfig, level) : {}),
  }
}

function phaseDetect(opts: KitInstallOptions): PhaseResult {
  return {
    phase: 'DETECT',
    output: `Detected stack: ${opts.language}, brownfield class: ${opts.brownfieldClass}, targetDir: ${opts.targetDir}`,
  }
}

async function phaseMeasure(
  opts: KitInstallOptions,
  arbiterConfig: ArbiterConfig | null,
  config: ProjectConfig,
): Promise<[PhaseResult, Record<string, MeasureResult>, Record<string, string>]> {
  const catalog = loadCatalog()
  const measurements: Record<string, MeasureResult> = {}
  const applicabilityReasons: Record<string, string> = {}

  for (const dim of catalog) {
    const appl = evaluateApplicability(dim, config)
    if (appl.applicability === 'na') {
      if (appl.reason) applicabilityReasons[dim.id] = appl.reason
      continue
    }
    measurements[dim.id] = measureDim(dim, opts.targetDir)
  }

  // C1: only persist when NOT in dry-run mode
  if (!opts.dryRun && arbiterConfig) {
    const updated: ArbiterConfig = {
      ...arbiterConfig,
      kit: {
        measure: Object.fromEntries(
          Object.entries(measurements).map(([id, r]) => [
            id,
            { status: r.status, evidence: r.evidence },
          ]),
        ),
      },
    }
    await saveConfig(opts.targetDir, updated)
  }

  const present = Object.values(measurements).filter((r) => r.status === 'present').length
  const partial = Object.values(measurements).filter((r) => r.status === 'partial').length
  const missing = Object.values(measurements).filter((r) => r.status === 'missing').length
  const naCount = catalog.length - Object.keys(measurements).length

  return [
    {
      phase: 'MEASURE',
      output: `MEASURE: ${Object.keys(measurements).length} dims measured — present:${present} partial:${partial} missing:${missing} na:${naCount} errors:${getMeasureDiagnosticErrors()}`,
    },
    measurements,
    applicabilityReasons,
  ]
}

function phaseScaffold(
  opts: KitInstallOptions,
  config: ProjectConfig,
): [PhaseResult, import('../generators/registry.js').GeneratorFailure[]] {
  const errors: import('../generators/registry.js').GeneratorFailure[] = []
  const specs = buildRegistry(config, [])
  // No generatorLink on catalog dims (catalog.json field is empty for all dims).
  // Run all enabled generators — equivalent to union over all applicable generator-keys (H6).
  const results = runGeneratorsFromRegistry(specs, errors, { dryRun: opts.dryRun ?? false })
  const written = results.filter(
    (r) =>
      r.action === 'created' || r.action === 'replaced' || r.action === 'backed-up-and-replaced',
  ).length
  const dryRunCount = results.filter((r) => r.action === 'dry-run').length
  const skipped = results.filter((r) => r.action === 'skipped').length
  const genCount = new Set(specs.filter((s) => s.enabled).map((s) => s.key)).size

  const suffix = errors.length > 0 ? ` (${errors.length} generator(s) failed)` : ''
  if (opts.dryRun) {
    return [
      {
        phase: 'SCAFFOLD',
        output: `SCAFFOLD: ${results.length} files (${dryRunCount} dry-run, ${skipped} skipped) across ${genCount} generators${suffix}`,
      },
      errors,
    ]
  }
  return [
    {
      phase: 'SCAFFOLD',
      output: `SCAFFOLD: ${results.length} files (${written} written, ${skipped} skipped) across ${genCount} generators${suffix}`,
    },
    errors,
  ]
}

function phaseAssess(config: ProjectConfig): [PhaseResult, DimAssessment[]] {
  const catalog = loadCatalog()
  if (catalog.length === 0) {
    throw new Error(
      '[arbiter kit install] ASSESS: catalog contains no dimensions — src/kit/catalog.json may be missing or corrupt.',
    )
  }
  const assessments: DimAssessment[] = catalog.map((dim) => {
    const appl = evaluateApplicability(dim, config)
    return {
      dimId: dim.id,
      status:
        dim.status === 'covered'
          ? ('Y' as const)
          : dim.status === 'partial'
            ? ('P' as const)
            : ('N' as const),
      category: dim.categoryRef,
      applicability: appl.applicability,
    }
  })
  const counts = { Y: 0, P: 0, N: 0, NA: 0 }
  for (const a of assessments) {
    if (a.applicability === 'na') counts.NA++
    else counts[a.status]++
  }
  return [
    {
      phase: 'ASSESS',
      output: `ASSESS: ${assessments.length} dims — Y:${counts.Y} P:${counts.P} N:${counts.N} NA:${counts.NA}`,
    },
    assessments,
  ]
}

function phasePlan(wavePlan: WavePlan): PhaseResult {
  const lines = wavePlan.waves.map((w) => `  ${w.label}: ${w.dimensions.length} dims — ${w.goal}`)
  return {
    phase: 'PLAN',
    output: ['Wave plan:', ...lines, `W0..W3 total: ${wavePlan.summary.totalDims} dims`].join('\n'),
  }
}

function phaseVerify(assessments: DimAssessment[], wavePlan: WavePlan): PhaseResult {
  // NA dims excluded from denominator per plan precedence rule (wave-engine.ts header)
  const applicable = assessments.filter((a) => (a.applicability ?? 'applicable') !== 'na')
  const covered = applicable.filter((a) => a.status === 'Y').length
  const total = applicable.length
  if (total === 0) {
    return {
      phase: 'VERIFY',
      output: 'VERIFY: no measurable dims (all NA or empty). W0 baseline not established.',
    }
  }
  const pct = Math.round((covered / total) * 100)
  const w1Count = wavePlan.summary.byWave['W1'] ?? 0
  return {
    phase: 'VERIFY',
    output: `VERIFY: coverage ${pct}% (${covered}/${total} dims). W0 baseline confirmed. ${w1Count} dims in W1 (enforcement target).`,
  }
}

function writeAuditReport(
  reportPath: string,
  measurements: Record<string, MeasureResult>,
  wavePlan: WavePlan,
  applicabilityReasons: Record<string, string>,
): void {
  const content = renderAuditMarkdown(
    Object.fromEntries(
      Object.entries(measurements).map(([id, r]) => [
        id,
        { status: r.status, evidence: r.evidence },
      ]),
    ),
    wavePlan,
    applicabilityReasons,
  )
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, content, 'utf-8')
}

export async function runKitInstall(opts: KitInstallOptions): Promise<KitInstallResult> {
  const phases: PhaseResult[] = []
  try {
    // #1095: when --language is omitted, auto-detect from the target repo instead
    // of defaulting to a hardcoded stack. An explicit --language always wins.
    const resolvedOpts: KitInstallOptions = {
      ...opts,
      language: opts.language ?? detectLanguageWithSource(opts.targetDir).language,
    }
    const arbiterConfig = loadConfig(resolvedOpts.targetDir)
    const config = buildProjectConfig(arbiterConfig, resolvedOpts)
    if (config.hasDatabase && !config.databaseEngine) {
      // databaseEngine detection not yet implemented — requiresDbEngine dims will be marked NA (fail-closed, H4)
      process.stderr.write(
        `[kit-install] hasDatabase=true but databaseEngine unknown — dims with requiresDbEngine will be skipped (see TODO #1058)\n`,
      )
    }

    phases.push(phaseDetect(resolvedOpts))

    const [measurePhase, measurements, applicabilityReasons] = await phaseMeasure(
      resolvedOpts,
      arbiterConfig,
      config,
    )
    phases.push(measurePhase)

    let scaffoldErrors: import('../generators/registry.js').GeneratorFailure[] = []
    if (!arbiterConfig) {
      phases.push({
        phase: 'SCAFFOLD',
        output: 'SCAFFOLD: no arbiter.json found — run arbiter init to generate scaffolding.',
      })
    } else {
      const [scaffoldPhase, genErrors] = phaseScaffold(resolvedOpts, config)
      phases.push(scaffoldPhase)
      scaffoldErrors = genErrors
    }

    const [assessPhase, assessments] = phaseAssess(config)
    phases.push(assessPhase)

    const wavePlan = buildWavePlan(assessments, opts.brownfieldClass)
    phases.push(phasePlan(wavePlan))
    phases.push(phaseVerify(assessments, wavePlan))

    if (opts.reportPath) {
      writeAuditReport(opts.reportPath, measurements, wavePlan, applicabilityReasons)
    }

    if (opts.emitIssues) {
      const emitResult = emitWaveIssues(wavePlan, opts.dryRun ?? false)
      process.stderr.write(
        `[emit-issues] created:${emitResult.created} skipped:${emitResult.skipped}\n`,
      )
    }

    const result: KitInstallResult = { ok: true, phases, wavePlan }
    if (scaffoldErrors.length > 0) {
      result.generatorErrors = scaffoldErrors.map((e) => `${e.key}: ${e.message}`)
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, phases, error: message }
  }
}
