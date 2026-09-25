// SPDX-License-Identifier: Apache-2.0
// #2890 — deterministic premortem decision at `ship` plan. RED skeleton: rules over the plan
// manifest + ship treatment, no file contents read; printed and stored in status.json.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTestProject, createTestProject } from '../helpers.js'
import { buildShipStepLines, runTaskShip } from '../../src/commands/task-ship.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import { evaluatePremortem, resolveShipTreatment } from '../../src/commands/ship-tier.js'
import type { ShipTier, TierSignals } from '../../src/commands/ship-tier.js'

const signals = (
  changedFiles: readonly string[],
  over: Partial<TierSignals> = {},
): TierSignals => ({
  blastRadius: 0,
  callerCount: 0,
  changedFiles,
  complete: true,
  labels: [],
  milestoneBundled: false,
  ...over,
})
const treatmentFor = (tier: ShipTier, files: readonly string[], over: Partial<TierSignals> = {}) =>
  resolveShipTreatment(tier, signals(files, over))

// Manifest fixtures named by the deliveries in #2890 AC-4.
const M_4601_CONSUMER_XS = ['docs/runbooks/rollout.md', 'README.md']
const M_2861_HOOKS = ['src/templates/hooks/pre-push.sh.ejs', 'src/generators/hooks.ts']
const M_2887_TEMPLATES = ['src/templates/claude/commands/ship.md.ejs']
const M_4588_STANDARD_MULTI = ['src/commands/task-ship.ts', 'src/utils/error-catalog.ts']
const M_CI_INFRA = ['.github/workflows/ci.yml', 'docs/ci.md']
const M_SINGLE_AREA = ['src/commands/task-ship.ts', 'src/commands/ship-tier.ts']
// Rule-3 fixture: `sensitive` is derived from SENSITIVE_PATHS (ship-tier.ts:160), not labels.
const M_SENSITIVE_XS = ['src/auth/login.ts']

describe('evaluatePremortem — six ordered rules over manifest + treatment (#2890 AC-2)', () => {
  it('(1) XS/S with no src/hooks/templates/workflows file → skip-llm', () => {
    expect(
      evaluatePremortem(M_4601_CONSUMER_XS, treatmentFor('XS', M_4601_CONSUMER_XS)),
    ).toMatchObject({
      decision: 'skip-llm',
      areas: 2,
      hooks: false,
      templates: false,
      workflows: false,
      tier: 'XS',
    })
  })

  it('(2) hooks or .ejs → required, even at XS', () => {
    expect(evaluatePremortem(M_2861_HOOKS, treatmentFor('XS', M_2861_HOOKS))).toMatchObject({
      decision: 'required',
      hooks: true,
    })
    expect(evaluatePremortem(M_2887_TEMPLATES, treatmentFor('S', M_2887_TEMPLATES))).toMatchObject({
      decision: 'required',
      templates: true,
    })
  })

  it('(3) treatment.sensitive → required', () => {
    const treatment = treatmentFor('XS', M_SENSITIVE_XS)
    expect(treatment.sensitive).toBe(true)
    expect(evaluatePremortem(M_SENSITIVE_XS, treatment)).toMatchObject({
      decision: 'required',
      sensitive: true,
    })
  })

  it('(4) Standard with ≥2 manifest areas → required', () => {
    expect(
      evaluatePremortem(M_4588_STANDARD_MULTI, treatmentFor('Standard', M_4588_STANDARD_MULTI)),
    ).toMatchObject({
      decision: 'required',
      areas: 2,
      tier: 'Standard',
    })
  })

  it('(5) .github/workflows → deterministic with the CI-infra checklist', () => {
    expect(evaluatePremortem(M_CI_INFRA, treatmentFor('Standard', M_CI_INFRA))).toMatchObject({
      decision: 'deterministic',
      workflows: true,
    })
  })

  it('(6) otherwise → deterministic', () => {
    expect(evaluatePremortem(M_SINGLE_AREA, treatmentFor('Standard', M_SINGLE_AREA))).toMatchObject(
      {
        decision: 'deterministic',
        areas: 1,
      },
    )
  })

  it('--premortem forces required regardless of every rule (#2890 AC-3)', () => {
    expect(
      evaluatePremortem(M_4601_CONSUMER_XS, treatmentFor('XS', M_4601_CONSUMER_XS), {
        force: true,
      }),
    ).toMatchObject({ decision: 'required' })
  })
})

describe('ship plan prints and stores the premortem decision (#2890 AC-1)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude', 'plans'), { recursive: true })
    writeFileSync(
      join(dir, '.claude/plans/task-2890.md'),
      `---\nfiles:\n${M_SINGLE_AREA.map((f) => `  - ${f}`).join('\n')}\n---\n\n# plan\n`,
      'utf-8',
    )
    writeUnifiedState(dir, { taskId: '#2890', phase: 'plan', plan: '.claude/plans/task-2890.md' })
  })
  afterEach(() => cleanupTestProject(dir))

  it('prints one premortem line and persists the decision in status.json', () => {
    const result = runTaskShip({
      dir,
      tier: 'Standard',
      gatherTierSignals: () => signals(M_SINGLE_AREA),
    })
    expect(buildShipStepLines(result).join('\n')).toMatch(
      /^premortem: deterministic reason=\S+ areas=1 hooks=false templates=false workflows=false sensitive=false tier=Standard$/m,
    )
    expect(readUnifiedState(dir)?.premortem).toMatchObject({ decision: 'deterministic' })
  })
})
