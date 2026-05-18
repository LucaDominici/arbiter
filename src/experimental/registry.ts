// SPDX-License-Identifier: Apache-2.0

export type StabilityTarget = 'beta' | 'stable'

export interface ExperimentRecord {
  name: string
  stabilityTarget: StabilityTarget
  addedIn: string
  promotionCriteria: string
  plannedReviewDate: string
}

// Registry of all active experiments. Add new experiments here.
// Promotion criteria: ≥6 months active + ≥3 user reports + zero P0 issues.
const EXPERIMENTS: readonly ExperimentRecord[] = [
  {
    name: 'kit',
    stabilityTarget: 'beta',
    addedIn: '0.1.0',
    promotionCriteria: '≥6 months active + ≥3 user reports + zero P0 issues + Phase F complete',
    plannedReviewDate: '2026-11-18',
  },
]

const experimentMap = new Map<string, ExperimentRecord>(EXPERIMENTS.map((e) => [e.name, e]))

export function listExperiments(): ExperimentRecord[] {
  return [...EXPERIMENTS]
}

export function getExperiment(name: string): ExperimentRecord {
  const record = experimentMap.get(name)
  if (record === undefined) {
    throw new Error(
      `[arbiter] Unknown experiment: "${name}". Run \`arbiter experiments list\` to see available experiments.`,
    )
  }
  return record
}

export function isEnabled(name: string, flags: Record<string, boolean>): boolean {
  getExperiment(name) // throws if unknown
  return flags[name] === true
}
