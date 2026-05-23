// SPDX-License-Identifier: Apache-2.0
import type { BrownfieldClass } from './thresholds.js'

export type AssessStatus = 'Y' | 'P' | 'N' | 'NA'

export interface DimAssessment {
  dimId: string
  status: AssessStatus
  category: string
}

export interface WaveEntry {
  dimId: string
  status: AssessStatus
  category: string
}

export interface Wave {
  label: 'W0' | 'W1' | 'W2' | 'W3'
  goal: string
  dimensions: WaveEntry[]
}

export interface WavePlan {
  brownfieldClass: BrownfieldClass
  waves: [Wave, Wave, Wave, Wave]
  summary: {
    totalDims: number
    byWave: Record<string, number>
  }
}

const WAVE_GOALS: Record<'W0' | 'W1' | 'W2' | 'W3', (cls: BrownfieldClass) => string> = {
  W0: (cls) => `Bootstrap — confirm existing coverage (brownfield: ${cls})`,
  W1: (cls) => `Enforcement — close partial gaps (brownfield: ${cls})`,
  W2: () => 'Advanced — implement missing tooling',
  W3: () => 'Gold — achieve full quality-gate parity',
}

export function buildWavePlan(
  assessments: DimAssessment[],
  brownfieldClass: BrownfieldClass,
): WavePlan {
  const byStatus: Record<AssessStatus, DimAssessment[]> = { Y: [], P: [], N: [], NA: [] }
  for (const a of assessments) {
    byStatus[a.status].push(a)
  }

  const toEntries = (list: DimAssessment[]): WaveEntry[] =>
    list.map(({ dimId, status, category }) => ({ dimId, status, category }))

  const waves: [Wave, Wave, Wave, Wave] = [
    { label: 'W0', goal: WAVE_GOALS.W0(brownfieldClass), dimensions: toEntries(byStatus.Y) },
    { label: 'W1', goal: WAVE_GOALS.W1(brownfieldClass), dimensions: toEntries(byStatus.P) },
    { label: 'W2', goal: WAVE_GOALS.W2(brownfieldClass), dimensions: toEntries(byStatus.N) },
    { label: 'W3', goal: WAVE_GOALS.W3(brownfieldClass), dimensions: [] },
  ]

  const totalDims = waves.reduce((s, w) => s + w.dimensions.length, 0)
  const byWave: Record<string, number> = {}
  for (const w of waves) byWave[w.label] = w.dimensions.length

  return { brownfieldClass, waves, summary: { totalDims, byWave } }
}
