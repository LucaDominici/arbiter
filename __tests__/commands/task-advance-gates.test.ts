// SPDX-License-Identifier: Apache-2.0
// #2435 AC-1 — behavioural half of the phase-gate contract.
//
// `src/commands/task.ts` gated five of the ten reachable phases. Advancing into or out of
// `preflight`, `plan`, `red-team-review`, `refactor` and `red-team-rework` asserted nothing,
// so a ship could reach `verification` with no plan reviewed and no red team ever dispatched.
// The static ship.md-derived check lives in `__tests__/docs/ship-phase-gates-2435.test.ts`;
// this file proves the new entries actually refuse.
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({ modelSwitch: false, transcriptPath: null }),
}))
vi.mock('../../src/evidence/git-checks.js', () => ({
  pathExistsInCommit: vi.fn().mockReturnValue(true),
  resolveEvidenceCommit: vi.fn((evidence: { test_commit_sha: string }) => ({
    sha: evidence.test_commit_sha,
    healed: false,
  })),
  tddEvidenceProducedOnBranch: vi.fn().mockReturnValue(true),
}))

import { runTaskAdvance, runTaskInit } from '../../src/commands/task.js'
import { writeUnifiedState, readUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'
import { resolveShipTreatment } from '../../src/commands/ship-tier.js'
import { deriveGatesForFiles } from '../../scripts/lib/gate-derivation.mjs'

const dirs: string[] = []

function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'task-advance-gates-'))
  dirs.push(d)
  mkdirSync(join(d, '.claude'), { recursive: true })
  return d
}

function seed(dir: string, phase: TaskPhase, taskId = '#2435'): void {
  writeUnifiedState(dir, { phase, taskId })
}

function writeHarnessConfig(dir: string, over: Record<string, unknown> = {}): void {
  const { features: featureOverrides, ...configOverrides } = over
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({
      version: '0.2',
      governanceLevel: 'L2',
      tools: ['claude'],
      permitGitHub: true,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: false,
        evidenceHarness: true,
        debtGates: true,
        suppressions: true,
        ...(featureOverrides as Record<string, unknown> | undefined),
      },
      thresholds: {
        lineCoverage: 80,
        branchCoverage: 70,
        mutationScore: 80,
        cyclomaticComplexity: 15,
        methodLength: 65,
        maxParams: 7,
      },
      ...configOverrides,
    }),
    'utf-8',
  )
}

function enablePlanReview(dir: string): void {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  writeFileSync(join(dir, '.arbiter', 'plan-review.enabled'), '', 'utf-8')
}

function recordTdd(dir: string, taskId = '#2435'): void {
  const evDir = join(dir, '.arbiter', 'evidence', 'tdd')
  mkdirSync(evDir, { recursive: true })
  writeFileSync(
    join(evDir, `${taskId}.json`),
    JSON.stringify({
      $schemaVersion: 1,
      task_id: taskId,
      test_path: '__tests__/x.test.ts',
      test_commit_sha: 'a'.repeat(40),
      test_run_log: 'FAIL __tests__/x.test.ts\n✗ 1 test failed',
      observed_failure: 'FAIL __tests__/x.test.ts',
      recorded_at: '2026-09-15T00:00:00.000Z',
    }),
  )
}

function installAcceptanceChecker(dir: string): void {
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
  symlinkSync(resolve(__dirname, '../../node_modules'), join(dir, 'node_modules'), 'dir')
  copyFileSync(
    resolve(__dirname, '../../scripts/check-acceptance.mjs'),
    join(dir, 'scripts/check-acceptance.mjs'),
  )
  copyFileSync(
    resolve(__dirname, '../../scripts/lib/acceptance-criteria.mjs'),
    join(dir, 'scripts/lib/acceptance-criteria.mjs'),
  )
  copyFileSync(
    resolve(__dirname, '../../scripts/lib/agent-return-validate.mjs'),
    join(dir, 'scripts/lib/agent-return-validate.mjs'),
  )
  copyFileSync(
    resolve(__dirname, '../../scripts/lib/evidence-binding.mjs'),
    join(dir, 'scripts/lib/evidence-binding.mjs'),
  )
  copyFileSync(
    resolve(__dirname, '../../scripts/lib/run-helpers.mjs'),
    join(dir, 'scripts/lib/run-helpers.mjs'),
  )
  for (const file of [
    'derived-artifacts.mjs',
    'gate-affects-registry.mjs',
    'gate-derivation.mjs',
  ]) {
    copyFileSync(resolve(__dirname, `../../scripts/lib/${file}`), join(dir, `scripts/lib/${file}`))
  }
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('advance --to plan — preflight must actually have seeded task state (AC-1)', () => {
  it('refuses when no task id was ever seeded (AC-1)', () => {
    const dir = tmpRepo()
    writeUnifiedState(dir, { phase: 'preflight' })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/task id/i)
  })

  it('advances once the task is seeded (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight')
    runTaskAdvance({ to: 'plan', dir })
    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })

  it('AC-1: refuses a harness without raw collaborationMode before advancing', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2638')
    writeHarnessConfig(dir)
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/completion policy/i)
    expect(readUnifiedState(dir)?.phase).toBe('preflight')
  })

  it('refuses a harness whose writer did not persist the delivery treatment', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2681')
    writeHarnessConfig(dir, { collaborationMode: 'peer-review' })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/delivery contract preflight/i)
    expect(readUnifiedState(dir)?.phase).toBe('preflight')
  })

  it('advances when writer and delivery guards share the supported treatment contract', () => {
    const dir = tmpRepo()
    writeHarnessConfig(dir, { collaborationMode: 'peer-review' })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'record-agent-return.mjs'), '')
    writeFileSync(join(dir, 'scripts', 'check-review-completion.mjs'), '')
    writeUnifiedState(dir, {
      phase: 'preflight',
      taskId: '#2681',
      treatment: resolveShipTreatment('Standard', {
        blastRadius: null,
        labels: [],
        milestoneBundled: false,
        complete: false,
      }),
    })

    runTaskAdvance({ to: 'plan', dir })

    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })

  it('AC-1: refuses malformed raw harness config before advancing', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2638')
    writeFileSync(join(dir, 'arbiter.json'), '{', 'utf-8')
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow()
    expect(readUnifiedState(dir)?.phase).toBe('preflight')
  })

  it('AC-1: refuses an unknown raw collaborationMode before advancing', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2638')
    writeHarnessConfig(dir, { collaborationMode: 'squad-review' })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/collaborationMode|validation/i)
    expect(readUnifiedState(dir)?.phase).toBe('preflight')
  })

  it('AC-4: rejects migrated useGitHub without raw permitGitHub before advancing', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2638')
    writeHarnessConfig(dir, {
      collaborationMode: 'peer-review',
      permitGitHub: undefined,
      useGitHub: true,
    })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('preflight')
  })

  it('AC-3: rejects raw direct mode without raw permitGitHub before advancing', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2638')
    writeHarnessConfig(dir, {
      collaborationMode: 'trunk-solo',
      solo: { mergeMode: 'direct' },
      permitGitHub: undefined,
    })
    expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/permitGitHub/i)
    expect(readUnifiedState(dir)?.phase).toBe('preflight')
  })

  it('AC-1: rejects an environment-enabled harness whose raw mode is absent', () => {
    const dir = tmpRepo()
    seed(dir, 'preflight', '#2638')
    writeHarnessConfig(dir, { features: { evidenceHarness: false } })
    const previous = process.env.ARBITER_FEATURE__EVIDENCE_HARNESS
    process.env.ARBITER_FEATURE__EVIDENCE_HARNESS = 'true'
    try {
      expect(() => runTaskAdvance({ to: 'plan', dir })).toThrow(/completion policy/i)
      expect(readUnifiedState(dir)?.phase).toBe('preflight')
    } finally {
      if (previous === undefined) delete process.env.ARBITER_FEATURE__EVIDENCE_HARNESS
      else process.env.ARBITER_FEATURE__EVIDENCE_HARNESS = previous
    }
  })
})

describe('retired planning phases cannot be dispatched (#2724)', () => {
  it.each(['red-team-review', 'red-team-rework'])('rejects the retired %s target', (phase) => {
    const dir = tmpRepo()
    seed(dir, 'plan')
    expect(() => runTaskAdvance({ dir, to: phase as never })).toThrow(/Invalid --to/)
  })
  it.each(['peer-review', 'gated-review', 'trunk-solo'])(
    'keeps %s plan admission mechanical',
    (mode) => {
      const dir = tmpRepo()
      seed(dir, 'plan', '#2724')
      writeHarnessConfig(dir, { collaborationMode: mode })
      runTaskAdvance({ dir, to: 'red' })
      expect(readUnifiedState(dir)?.phase).toBe('red')
    },
  )
})

describe('red admission — the existing Markdown acceptance anchor runs before mutation (#2587)', () => {
  const FILES = ['src/templates/claude/commands/ship.md.ejs']
  const VALID_PLAN = [
    '---',
    "title: '#2587'",
    'files:',
    ...FILES.map((file) => `  - ${file}`),
    '---',
    '## Acceptance Criteria',
    '- [ ] AC-2587.1: behavior',
    '## Non-Goals',
    '- x',
  ].join('\n')

  function acceptanceRepo(plan: string, enabled = true, checker = true): string {
    const dir = tmpRepo()
    seed(dir, 'plan', '#2587')
    if (checker) installAcceptanceChecker(dir)
    writeFileSync(join(dir, 'plan.md'), plan, 'utf-8')
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ features: { acceptanceAnchor: enabled } }),
      'utf-8',
    )
    writeUnifiedState(dir, { plan: 'plan.md' })
    return dir
  }

  function storeDerivedGates(dir: string, gates: unknown): void {
    const path = join(dir, '.claude', '.task', 'status.json')
    const state = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    state.derivedGates = gates
    writeFileSync(path, JSON.stringify(state), 'utf-8')
  }

  it('rejects an invalid anchor and leaves the phase unchanged', () => {
    const dir = acceptanceRepo('# Plan\nno anchor')
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(
      /acceptance-anchor|Acceptance Criteria/i,
    )
    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })

  it('advances with a valid anchor', () => {
    const dir = acceptanceRepo(VALID_PLAN)
    storeDerivedGates(dir, deriveGatesForFiles(FILES))
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('AC-2 refuses missing or hand-written gate state and passes a fresh derivation', () => {
    const missing = acceptanceRepo(VALID_PLAN)
    expect(() => runTaskAdvance({ to: 'red', dir: missing })).toThrow(/derived gates/i)
    expect(readUnifiedState(missing)?.phase).toBe('plan')

    const wrong = acceptanceRepo(VALID_PLAN)
    storeDerivedGates(wrong, [
      { name: 'unit tests', kind: 'test-first' },
      { name: 'dogfood', kind: 'constraint' },
    ])
    expect(() => runTaskAdvance({ to: 'red', dir: wrong })).toThrow(/derived gates/i)
    expect(readUnifiedState(wrong)?.phase).toBe('plan')

    const correct = acceptanceRepo(VALID_PLAN)
    storeDerivedGates(correct, deriveGatesForFiles(FILES))
    runTaskAdvance({ to: 'red', dir: correct })
    expect(readUnifiedState(correct)?.phase).toBe('red')
  })

  it('preserves the optional profile inert when disabled', () => {
    const dir = acceptanceRepo('# Plan\nno anchor', false)
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('fails closed when the enabled profile has no checker', () => {
    const dir = acceptanceRepo(
      '## Acceptance Criteria\n- [ ] AC-2587.1: behavior\n## Non-Goals\n- x',
      true,
      false,
    )
    expect(() => runTaskAdvance({ to: 'red', dir })).toThrow(/profile is enabled|missing/i)
    expect(readUnifiedState(dir)?.phase).toBe('plan')
  })

  it('passes a valid plan reference with a fragment', () => {
    const dir = acceptanceRepo(VALID_PLAN)
    storeDerivedGates(dir, deriveGatesForFiles(FILES))
    writeUnifiedState(dir, { plan: 'plan.md#acceptance' })
    runTaskAdvance({ to: 'red', dir })
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })
})

describe('anchor-time gate derivation (#2773) — runTaskInit wires derive-plan-gates.mjs for real', () => {
  const FILES = ['src/templates/claude/commands/ship.md.ejs']
  const VALID_PLAN = [
    '---',
    "title: '#2773'",
    'files:',
    ...FILES.map((file) => `  - ${file}`),
    '---',
    '## Acceptance Criteria',
    '- [ ] AC-2773.1: behavior',
    '## Non-Goals',
    '- x',
  ].join('\n')

  function anchorRepo(): string {
    const dir = tmpRepo()
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
    symlinkSync(resolve(__dirname, '../../node_modules'), join(dir, 'node_modules'), 'dir')
    copyFileSync(
      resolve(__dirname, '../../scripts/derive-plan-gates.mjs'),
      join(dir, 'scripts/derive-plan-gates.mjs'),
    )
    for (const file of [
      'gate-affects-registry.mjs',
      'gate-derivation.mjs',
      'derived-artifacts.mjs',
      'run-helpers.mjs',
    ]) {
      copyFileSync(
        resolve(__dirname, `../../scripts/lib/${file}`),
        join(dir, `scripts/lib/${file}`),
      )
    }
    writeFileSync(join(dir, 'plan.md'), VALID_PLAN, 'utf-8')
    return dir
  }

  it('writes derivedGates into status.json when `lifecycle start --plan` anchors a manifest plan', () => {
    const dir = anchorRepo()
    runTaskInit({ dir, id: '#2773', plan: 'plan.md' })
    expect(readUnifiedState(dir)?.derivedGates).toEqual(deriveGatesForFiles(FILES))
  })

  it('leaves derivedGates unset when no plan is anchored', () => {
    const dir = anchorRepo()
    runTaskInit({ dir, id: '#2773' })
    expect(readUnifiedState(dir)?.derivedGates).toBeUndefined()
  })
})

describe('advance --to refactor — the review machinery must have an id to key on (AC-1)', () => {
  it('refuses an id-less document, which would vacuous-pass review-completion (AC-1)', () => {
    const dir = tmpRepo()
    writeUnifiedState(dir, { phase: 'green' })
    expect(() => runTaskAdvance({ to: 'refactor', dir })).toThrow(/task id/i)
  })

  it('advances once the task is seeded (AC-1)', () => {
    const dir = tmpRepo()
    seed(dir, 'green')
    runTaskAdvance({ to: 'refactor', dir })
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
  })

  it('does not spend a review round through direct phase advance', () => {
    const dir = tmpRepo()
    seed(dir, 'green')
    const headSha = 'a'.repeat(40)
    runTaskAdvance({ to: 'refactor', dir, headSha })
    expect(readUnifiedState(dir)?.review).toBeUndefined()
  })
})

describe('advance --to verification — qualified review evidence is mandatory', () => {
  it('refuses when the evidence profile has no review-completion checker', () => {
    const dir = tmpRepo()
    seed(dir, 'refactor')
    recordTdd(dir)
    writeHarnessConfig(dir, { collaborationMode: 'peer-review' })
    expect(() => runTaskAdvance({ to: 'verification', dir })).toThrow(/review-completion/i)
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
  })

  it('advances after the canonical review-completion checker passes', () => {
    const dir = tmpRepo()
    seed(dir, 'refactor')
    recordTdd(dir)
    writeHarnessConfig(dir, { collaborationMode: 'peer-review' })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-review-completion.mjs'), 'process.exit(0)\n')
    runTaskAdvance({ to: 'verification', dir })
    expect(readUnifiedState(dir)?.phase).toBe('verification')
  })
})

describe('result-first mechanical plan admission (#2724)', () => {
  it('advances directly from plan to RED without pre-code review or a forced clear', () => {
    const dir = tmpRepo()
    seed(dir, 'plan', '#2724')
    enablePlanReview(dir) // stale opt-in cannot resurrect a retired phase
    expect(() => runTaskAdvance({ dir, to: 'red' })).not.toThrow()
    expect(readUnifiedState(dir)?.phase).toBe('red')
    expect(readUnifiedState(dir)?.handoffReady).toBe(false)
  })
})
