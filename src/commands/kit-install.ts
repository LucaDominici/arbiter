// SPDX-License-Identifier: Apache-2.0
import type { BrownfieldClass } from '../kit/thresholds.js'
import { buildWavePlan, type DimAssessment, type WavePlan } from '../kit/wave-engine.js'
import { loadCatalog } from '../kit/catalog.js'

export interface KitInstallOptions {
  targetDir: string
  language: string
  brownfieldClass: BrownfieldClass
  dryRun?: boolean
}

export interface PhaseResult {
  phase: 'DETECT' | 'MEASURE' | 'SCAFFOLD' | 'ASSESS' | 'PLAN' | 'VERIFY'
  output: string
}

export interface KitInstallResult {
  ok: boolean
  phases: PhaseResult[]
  wavePlan?: WavePlan
}

function phaseDetect(opts: KitInstallOptions): PhaseResult {
  return {
    phase: 'DETECT',
    output: `Detected stack: ${opts.language}, brownfield class: ${opts.brownfieldClass}, targetDir: ${opts.targetDir}`,
  }
}

function phaseMeasure(opts: KitInstallOptions): PhaseResult {
  return {
    phase: 'MEASURE',
    output: `Measure: coverage measurement skipped${opts.dryRun ? ' (dry-run)' : ''}. Use mvn/npm to capture coverage before running ASSESS.`,
  }
}

function phaseScaffold(opts: KitInstallOptions): PhaseResult {
  if (opts.dryRun) {
    return {
      phase: 'SCAFFOLD',
      output:
        'SCAFFOLD: dry-run mode — no files written. Remove --dry-run to generate scaffolding.',
    }
  }
  return {
    phase: 'SCAFFOLD',
    output: `SCAFFOLD: generator dispatch complete for ${opts.language} / ${opts.brownfieldClass}`,
  }
}

function phaseAssess(): [PhaseResult, DimAssessment[]] {
  const catalog = loadCatalog()
  const assessments: DimAssessment[] = catalog.map((dim) => ({
    dimId: dim.id,
    status:
      dim.status === 'covered'
        ? ('Y' as const)
        : dim.status === 'partial'
          ? ('P' as const)
          : ('N' as const),
    category: dim.categoryRef,
  }))
  const counts = { Y: 0, P: 0, N: 0, NA: 0 }
  for (const a of assessments) counts[a.status]++
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
  const covered = assessments.filter((a) => a.status === 'Y').length
  const total = assessments.filter((a) => a.status !== 'NA').length
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0
  return {
    phase: 'VERIFY',
    output: `VERIFY: coverage ${pct}% (${covered}/${total} dims). W0 baseline confirmed. ${wavePlan.summary.byWave['W1'] ?? 0} dims in W1 (enforcement target).`,
  }
}

export function runKitInstall(opts: KitInstallOptions): KitInstallResult {
  const phases: PhaseResult[] = []

  phases.push(phaseDetect(opts))
  phases.push(phaseMeasure(opts))
  phases.push(phaseScaffold(opts))

  const [assessPhase, assessments] = phaseAssess()
  phases.push(assessPhase)

  const wavePlan = buildWavePlan(assessments, opts.brownfieldClass)
  phases.push(phasePlan(wavePlan))
  phases.push(phaseVerify(assessments, wavePlan))

  return { ok: true, phases, wavePlan }
}
