// SPDX-License-Identifier: Apache-2.0
//
// `/ship` orchestrator sequencing (#1206): step computation + auto-advance over the existing engine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createTestProject, cleanupTestProject, writeGatePassEvidence } from '../helpers.js'
import {
  runTaskShip,
  shipStepFor,
  nextPhase,
  buildShipStepLines,
  type ShipResult,
} from '../../src/commands/task-ship.js'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state.js'
import type { TaskPhase } from '../../src/commands/task-state.js'
import type { ShipProfile } from '../../src/commands/ship-profile.js'
import { resolveShipTreatment, widenTier } from '../../src/commands/ship-tier.js'
import { SKILLS_MATRIX } from '../../src/integrations/skills-matrix.js'
import { writeExternalReviewSidecar } from '../../src/commands/cross-model-review.js'

// Gates that would otherwise require a real repo / model switch
vi.mock('../../src/capabilities/host-probe.js', () => ({
  detectHostCapabilities: vi.fn().mockReturnValue({ modelSwitch: false, transcriptPath: null }),
}))
vi.mock('../../src/evidence/git-checks.js', () => ({
  shaExistsOnBranch: vi.fn().mockReturnValue(true),
  resolveEvidenceCommit: vi.fn((ev: { test_commit_sha: string }) => ({
    sha: ev.test_commit_sha,
    healed: false,
  })),
  pathExistsInCommit: vi.fn().mockReturnValue(true),
  tddEvidenceProducedOnBranch: vi.fn().mockReturnValue(true),
  currentBranch: vi.fn().mockReturnValue('task/1206-gate-marker'),
  headSha: vi.fn().mockReturnValue('b'.repeat(40)),
}))

function writeTddEvidence(dir: string, taskId: string): void {
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
      recorded_at: '2026-06-04T00:00:00.000Z',
    }),
    'utf-8',
  )
}

/**
 * #2328: the marker gate verifies tree, checkout, toolchain, level and age
 * against a REAL checkout, so the fixture becomes a real repo and the marker is
 * stamped by the writer rather than hand-written.
 */
function initGitRepo(dir: string): void {
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git(['init', '-q', '-b', 'task/1206-gate-marker'])
  git(['config', 'user.email', 'test@arbiter.dev'])
  git(['config', 'user.name', 'test-user'])
  // Mirrors arbiter's own .gitignore: task/gate runtime state is not tree content.
  writeFileSync(join(dir, '.gitignore'), '.arbiter/\n.claude/.task/\n.claude/.task-*\n', 'utf-8')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'fixture', '--no-gpg-sign'])
}

function writeGatePassMarker(dir: string, taskId: string): void {
  writeGatePassEvidence(dir, { taskId })
}

function companionEvidencePath(taskId: string, dir: string): string {
  return join(dir, '.arbiter', 'evidence', 'companions', `${taskId}.json`)
}

describe('ship sequencing — pure plan', () => {
  it('does not dispatch pre-code reviewers at any treatment', () => {
    expect(shipStepFor('plan', 'XS').reviewAgents).toBe(0)
    expect(shipStepFor('plan', 'S').reviewAgents).toBe(0)
    expect(shipStepFor('plan', 'Standard').reviewAgents).toBe(0)
  })

  it('uses mechanical plan checks with no pre-code dispatch', () => {
    const step = shipStepFor('plan', 'Standard', profile({ collaborationMode: 'trunk-solo' }))
    expect(step.reviewAgents).toBe(0)
    expect(step.action).toMatch(/acceptance/i)
  })

  it('dispatches tier-N code-review agents at refactor', () => {
    expect(shipStepFor('refactor', 'XS').reviewAgents).toBe(1)
    expect(shipStepFor('refactor', 'S').reviewAgents).toBe(1)
    expect(shipStepFor('refactor', 'Standard').reviewAgents).toBe(1)
  })

  it('adds an external reviewer seat without changing the total reviewAgents count (AC-2357.8)', () => {
    const profileWithCrossModel = profile({
      crossModelReview: {
        enabled: true,
        diffEgressConsent: true,
        providers: ['codex'],
        slots: { codeReview: 1, redTeamReview: 0 },
        timeoutMs: 300_000,
        onUnavailable: 'degrade',
      },
    })
    const step = shipStepFor('refactor', 'Standard', profileWithCrossModel, undefined, {
      chainIds: [],
      externalModelAccess: {
        provider: 'codex',
        vendor: 'openai',
        available: true,
        authenticated: true,
        version: '1.2.3',
        error: null,
      },
    })
    expect(step.reviewAgents).toBe(1)
    expect(step.externalReviewers).toBe(1)
    expect(step.action).toContain('dispatch 0 Anthropic code-review agent(s) + 1 Codex reviewer(s)')
    expect(step.action).toContain('panel total: 1')
  })

  it('keeps one Standard final reviewer in trunk-solo', () => {
    const step = shipStepFor(
      'refactor',
      'Standard',
      profile({
        collaborationMode: 'trunk-solo',
        crossModelReview: {
          enabled: true,
          diffEgressConsent: true,
          providers: ['codex'],
          slots: { codeReview: 1, redTeamReview: 0 },
          timeoutMs: 300_000,
          onUnavailable: 'degrade',
        },
      }),
      undefined,
      {
        chainIds: [],
        externalModelAccess: {
          provider: 'codex',
          vendor: 'openai',
          available: true,
          authenticated: true,
          version: '1.2.3',
          error: null,
        },
      },
    )
    expect(step).toMatchObject({ reviewAgents: 1, externalReviewers: 1 })
    expect(step.action).toContain('panel total: 1')
  })

  it('records expected Codex provenance for a Codex reviewer sidecar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-codex-sidecar-'))
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeExternalReviewSidecar({
        repoRoot: dir,
        taskId: '#2802',
        result: {
          provider: 'codex',
          status: 'fulfilled',
          diffBytes: 1,
          diffTruncated: false,
          degradationReasons: [],
          recorded: true,
          envelope: { verdict: 'PASS', confidence: 1, findings: [], refutations: [] },
        },
      })

      expect(
        JSON.parse(readFileSync(join(dir, '.arbiter', 'agents-dispatched.json'), 'utf8')),
      ).toMatchObject({
        expectedProvenance: {
          'codex-reviewer': { vendor: 'openai', dispatch: 'external-cli', cli: 'codex' },
        },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('derives code-review count from the final, post-widening tier (AC-3)', () => {
    expect(
      shipStepFor(
        'refactor',
        widenTier('XS', { blastRadius: 75, labels: [], milestoneBundled: false }),
      ).reviewAgents,
    ).toBe(1)
    expect(
      shipStepFor(
        'refactor',
        widenTier('XS', { blastRadius: 25, labels: [], milestoneBundled: false }),
      ).reviewAgents,
    ).toBe(1)
  })

  it('assigns only the treatment seats that the tier earned', () => {
    const xs = shipStepFor('refactor', 'XS')
    const s = shipStepFor('refactor', 'S')
    const std = shipStepFor('refactor', 'Standard')

    expect(xs.verticals).toEqual(['domain'])
    expect(s.verticals).toEqual(['domain'])
    expect(std.verticals).toEqual(['domain'])
    expect(std.reviewAgents).toBe(xs.reviewAgents)
  })

  it('plan carries the treatment vertical without dispatching it', () => {
    expect(shipStepFor('plan', 'Standard').verticals).toEqual(['domain'])
    expect(shipStepFor('plan', 'XS').verticals).toEqual(['domain'])
  })

  it('nextPhase walks forward and stops at complete', () => {
    expect(nextPhase('plan')).toBe('red')
    expect(nextPhase('complete')).toBeNull()
  })
})

describe('self /ship documentation coherence (#2178)', () => {
  const shipCommand = readFileSync(join(process.cwd(), '.claude', 'commands', 'ship.md'), 'utf-8')

  it('states the adaptive treatment table', () => {
    const flat = shipCommand.replace(/\s+/g, ' ')
    expect(flat).toMatch(/\| XS\s+\| minimal \|\s+0 \|\s+1 pertinent vertical/)
    expect(flat).toMatch(/\| Standard\s+\| full\s+\|\s+0 \|\s+1 pertinent vertical/)
  })

  it('caps specialist review through the persisted treatment', () => {
    expect(shipCommand).toContain('relevant specialists, maximum 3')
    expect(shipCommand).toContain('persists one `ShipTreatment`')
  })

  it('names review completion and its blocking severity floor', () => {
    expect(shipCommand.includes('scripts/check-review-completion.mjs')).toBe(true)
    expect(shipCommand).toContain('MED/HIGH/CRITICAL')
  })

  it('documents CI as the verification authority', () => {
    expect(shipCommand).toContain('CI runs the full gate on that SHA')
    expect(shipCommand).toContain('node scripts/ci-receipt.mjs')
  })
})

// #1280 — the bare positional id (`ship 1280 ...`) must be normalized to the canonical
// `#NNN` form ONCE at parse: the TDD-evidence schema requires `^#\d+$` and the gate's
// identity check compares against the persisted taskId, so an un-sanitized bare id makes
// the gate unsatisfiable via `ship --advance`.
describe('ship id normalization (#1280)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('normalizes a bare positional id to #NNN at parse', () => {
    runTaskShip({ dir, taskId: '1280', tier: 'XS' })
    expect(readUnifiedState(dir)?.taskId).toBe('#1280')
  })

  it('keeps an already-canonical #NNN id unchanged', () => {
    runTaskShip({ dir, taskId: '#1280', tier: 'XS' })
    expect(readUnifiedState(dir)?.taskId).toBe('#1280')
  })

  it('persists override-only resume state across the next ship invocation', () => {
    runTaskShip({ dir, taskId: '#1280', tier: 'XS' })
    runTaskShip({ dir, overrides: { 'automation.autonomy': 'L3' } })
    expect(readUnifiedState(dir)?.overrides).toEqual({ 'automation.autonomy': 'L3' })
  })

  it('rejects a non-numeric id loudly instead of silently coercing', () => {
    expect(() => runTaskShip({ dir, taskId: 'abc' })).toThrow(/[Ii]nvalid.*task id/)
  })

  it('TDD-evidence gate is satisfiable end-to-end when seeded with a bare id', () => {
    // Seed with the BARE id — exactly what `ship 1280 ...` passes through the CLI.
    runTaskShip({ dir, taskId: '1280', tier: 'XS' })
    // Evidence on disk uses the canonical schema form (`^#\d+$`), as the schema requires.
    writeTddEvidence(dir, '#1280')
    writeUnifiedState(dir, { phase: 'red' })
    // red → green runs checkTddEvidenceGate: path lookup + identity check both need '#1280'.
    const result = runTaskShip({ dir, advance: true })
    expect(result.step.action).toContain(
      'advanced to verification; next gate (close) not yet satisfied: gate-pass marker missing',
    )
    expect(readUnifiedState(dir)?.phase).toBe('verification')
  })

  it('AC-7 a new ship id cannot inherit a prior task complete phase or plan', () => {
    writeUnifiedState(dir, {
      taskId: '#2120',
      phase: 'complete',
      tier: 'Standard',
      plan: '.claude/plans/old.md',
      branch: 'tmp-red',
    })
    const result = runTaskShip({ dir, taskId: '2135', tier: 'S' })
    expect(result.phase).toBe('preflight')
    expect(result.done).toBe(false)
    expect(readUnifiedState(dir)).toMatchObject({
      taskId: '#2135',
      phase: 'preflight',
      tier: 'Standard',
      plan: '',
    })
  })
})

describe('ship orchestrator — drives a fixture end-to-end', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('seeds id/tier on first invocation and reports the preflight step', () => {
    const r = runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    expect(r.phase).toBe('preflight')
    expect(r.done).toBe(false)
    expect(readUnifiedState(dir)?.taskId).toBe('#1206')
    expect(readUnifiedState(dir)?.tier).toBe('Standard')
  })

  it('--advance crosses plan and stops when the TDD evidence gate is red', () => {
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeUnifiedState(dir, { phase: 'plan' })
    const result = runTaskShip({ dir, advance: true })
    expect(result.step.action).toContain(
      'advanced to red; next gate (green) not yet satisfied: TDD evidence gate:',
    )
    expect(result.step.action).toContain('arbiter lifecycle record-red --test-path <path>')
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('keeps the first transition gate failure throwing', () => {
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeUnifiedState(dir, { phase: 'red' })

    expect(() => runTaskShip({ dir, advance: true })).toThrow(/TDD evidence gate/)
    expect(readUnifiedState(dir)?.phase).toBe('red')
  })

  it('AC-1 fast-forwards through every passing gate in one call', () => {
    initGitRepo(dir)
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ permitGitHub: true, collaborationMode: 'peer-review' }),
    )
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeUnifiedState(dir, { branch: 'task/1206-gate-marker' })
    writeTddEvidence(dir, '#1206')
    // The verification/close/complete phase gates require a real-shape marker correlated to
    // this fixture's mocked branch and HEAD, just as a successful check-all run would write.
    writeGatePassMarker(dir, '#1206')

    // This sandbox refuses Git subprocesses inside the verifier. The explicit engine bypass still
    // runs both marker gates; AC-4 below proves the normal failing verdict remains blocking.
    vi.stubEnv('ARBITER_SKIP_GATE_MARKER', '1')
    let result: ShipResult
    try {
      result = runTaskShip({
        dir,
        advance: true,
        // #2402 — `complete` now verifies the branch's PR actually merged; this fixture has no
        // remote, so the reader is seamed to a merged PR rather than the gate being disarmed.
        advanceOpts: {
          readPrs: () => [{ number: 1206, state: 'MERGED' }],
        },
      })
    } finally {
      vi.unstubAllEnvs()
    }

    expect(result.done).toBe(true)
    expect(result.phase).toBe('complete')
    expect(readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')).toMatch(
      /preflight → plan[\s\S]*plan → red[\s\S]*red → green[\s\S]*green → refactor[\s\S]*refactor → verification[\s\S]*verification → close[\s\S]*close → complete/,
    )
    expect(readUnifiedState(dir)?.phase).toBe('complete')
  })

  it('AC-1/AC-4 returns at the first failing intermediate gate with its reason and command', () => {
    initGitRepo(dir)
    runTaskShip({ dir, taskId: '#1206', tier: 'Standard' })
    writeTddEvidence(dir, '#1206')
    writeUnifiedState(dir, { phase: 'red' })

    const result = runTaskShip({ dir, advance: true })
    expect(result.phase).toBe('verification')
    expect(result.step.action).toContain(
      `advanced to verification; next gate (close) not yet satisfied: ` +
        `gate-pass marker missing at ${join(dir, '.arbiter', 'gate-pass.json')}`,
    )
    expect(result.step.action).toContain('node scripts/check-all.mjs preflight')
    expect(result.step.action).toContain('node scripts/ci-receipt.mjs')
    expect(readUnifiedState(dir)?.phase).toBe('verification')
    const log = readFileSync(join(dir, '.claude', '.task', 'log.md'), 'utf-8')
    expect(log).toMatch(/red → green[\s\S]*green → refactor[\s\S]*refactor → verification/)
    expect(log).toContain('ship → advanced to verification')
  })
})

describe('ship host binding preflight (#2753)', () => {
  it('AC-2 reports the exact prepare and preflight command before writing task state', () => {
    const worktree = createTestProject()
    const command =
      `arbiter worktree prepare "#2753" "${worktree}" && ` +
      `arbiter lifecycle preflight --id "#2753" --worktree "${worktree}"`
    try {
      expect(() =>
        runTaskShip({ dir: worktree, taskId: '#2753', isLinkedCheckout: () => true }),
      ).toThrow(`native host binding is missing. Run \`${command}\`.`)
      expect(readUnifiedState(worktree)).toBeNull()
    } finally {
      cleanupTestProject(worktree)
    }
  })
})

// #1288 — de-self-only: steps are config-aware (target repo arbiter.json), and self-only
// authoring gates are SKIPPED (not faked) for consumer repos (INV-115 / ADR-093 §5).
const profile = (over: Partial<ShipProfile> = {}): ShipProfile => ({
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  evidenceHarness: false,
  // #1306 — orchestration pref (defaults to the resolver floor).
  defaultGateLevel: 'L1',
  // #1730 — no companion by default; individual tests inject one.
  companions: [],
  ...over,
})
const SELF_ONLY_GATES = ['template-authoring', 'selfOnly-invariants', 'matrix-fixtures']

describe('ship complete next commands (#2753)', () => {
  function outputFor(phase: TaskPhase): string {
    const shipProfile = profile()
    const step = shipStepFor(phase, 'Standard', shipProfile, '#2753')
    return buildShipStepLines({
      phase,
      step,
      advanced: false,
      done: false,
      tier: 'Standard',
      profile: shipProfile,
    }).join('\n')
  }

  it('AC-3 plan names the accepted plan path and complete lifecycle start command', () => {
    expect(outputFor('plan')).toContain(
      "Command: arbiter lifecycle start --id '#2753' --tier Standard --plan .claude/plans/task-2753.md",
    )
  })

  it('AC-3 red names the complete task-bound record-red command', () => {
    expect(outputFor('red')).toContain(
      "Command: arbiter lifecycle record-red --task '#2753' --test-path <test-path>",
    )
  })

  it('AC-3 refactor names the complete task-bound review-round command', () => {
    const output = outputFor('refactor')
    expect(output).toContain('git push -u origin "$branch"')
    expect(output).toContain('gh pr create --draft')
    expect(output).toContain("arbiter ship '#2753' --review-round")
    expect(output.indexOf('git push')).toBeLessThan(output.indexOf('gh pr create --draft'))
    expect(output.indexOf('gh pr create --draft')).toBeLessThan(
      output.indexOf("arbiter ship '#2753' --review-round"),
    )
    expect(output).toContain('test "$(git rev-parse HEAD)" = "$candidate"')
  })

  it('prints the plan-time commands, conditions, thresholds and unresolved obligations (#2773)', () => {
    const shipProfile = profile()
    const lines = buildShipStepLines({
      phase: 'plan',
      step: shipStepFor('plan', 'Standard', shipProfile, '#2773'),
      advanced: false,
      done: false,
      tier: 'Standard',
      profile: shipProfile,
      derivedGates: [
        {
          name: 'coverage ratchet (#1483)',
          command: 'node scripts/check-coverage-ratchet.mjs --require-data',
          verificationCommand: 'npm test -- --coverage',
          condition: 'coverage passed',
          thresholds: [
            {
              name: 'branches',
              value: 90.41,
              source: '.coverage-baseline.json#branches',
              measurement: 'npx vitest run --coverage',
            },
          ],
        },
        {
          name: 'verification authority',
          status: 'unresolved',
          reason: 'unsupported custom gate authority',
        },
      ],
    }).join('\n')

    expect(lines).toContain('Gates awaiting this change:')
    expect(lines).toContain('node scripts/check-coverage-ratchet.mjs --require-data')
    expect(lines).toContain('verification: npm test -- --coverage')
    expect(lines).toContain('branches=90.41 (.coverage-baseline.json#branches)')
    expect(lines).toContain('via npx vitest run --coverage')
    expect(lines).toContain('UNRESOLVED: unsupported custom gate authority')
  })
})

describe('ship complete-action — (collaborationMode × mergeMode) matrix (#1288 RT-02)', () => {
  it('trunk-solo + direct → push to default branch, NO PR', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({
        collaborationMode: 'trunk-solo',
        mergeMode: 'direct',
      }),
    ).action
    expect(a).toMatch(/no PR/i)
    expect(a).not.toMatch(/await|review/i)
  })

  it('trunk-solo + pr-ff → open PR + fast-forward', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({
        collaborationMode: 'trunk-solo',
        mergeMode: 'pr-ff',
      }),
    ).action
    expect(a).toMatch(/PR/)
    expect(a).toMatch(/fast-forward/i)
    expect(a).not.toMatch(/await required review/i)
  })

  it('peer-review → open PR, await required review + checks', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({ collaborationMode: 'peer-review' }),
    ).action
    expect(a).toMatch(/PR/)
    expect(a).toMatch(/await required review/i)
  })

  it('gated-review + solo.mergeMode:direct → STILL PR + review (override forced safe, RT-02)', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({
        collaborationMode: 'gated-review',
        mergeMode: 'direct',
      }),
    ).action
    expect(a).toMatch(/PR/)
    expect(a).toMatch(/await required review/i)
    expect(a).not.toMatch(/no PR/i)
  })
})

// #2102 — `arbiter ship [id] --chain <id>` seeds/persists chainIds, validated the same way as
// the primary id (#1280), and a bare re-invocation (--advance without repeating --chain) must
// never clobber a chain declared on an earlier call.
describe('ship chain batching — seeding (--chain, #2102)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('persists chainIds normalized to canonical #NNN', () => {
    runTaskShip({
      dir,
      taskId: '2102',
      tier: 'XS',
      chainIds: ['2103', '#2104'],
      trainAffinity: {
        sameOutcome: true,
        ownerPathOverlap: true,
        dependencyRelated: true,
        sharedProof: true,
        orderingCompatible: true,
        sharedAcceptanceBoundary: true,
        sharedRollbackBoundary: true,
        hardConflicts: [],
      },
      gatherTierSignals: () => ({
        labels: [],
        blastRadius: 0,
        callerCount: 0,
        milestoneBundled: false,
        complete: true,
        changedFiles: ['docs/issue.md'],
      }),
    })
    expect(readUnifiedState(dir)?.chainIds).toEqual(['#2103', '#2104'])
  })

  it('rejects a non-numeric chain id loudly, same guard as the primary id', () => {
    expect(() => runTaskShip({ dir, taskId: '2102', chainIds: ['feature-x'] })).toThrow(
      /invalid chain id/i,
    )
  })

  it('omitting --chain on a later call does NOT clear a previously-declared chain', () => {
    runTaskShip({
      dir,
      taskId: '2102',
      tier: 'XS',
      chainIds: ['2103'],
      trainAffinity: {
        sameOutcome: true,
        ownerPathOverlap: true,
        dependencyRelated: true,
        sharedProof: true,
        orderingCompatible: true,
        sharedAcceptanceBoundary: true,
        sharedRollbackBoundary: true,
        hardConflicts: [],
      },
      gatherTierSignals: () => ({
        labels: [],
        blastRadius: 0,
        callerCount: 0,
        milestoneBundled: false,
        complete: true,
        changedFiles: ['docs/issue.md'],
      }),
    })
    // Simulates `arbiter ship --advance` without repeating --chain.
    const result = runTaskShip({ dir, advance: true })
    expect(result.phase).toBe('red')
    expect(readUnifiedState(dir)?.chainIds).toEqual(['#2103'])
  })
})

// #2102 — `--chain <id>` (repeatable) merge-train batching: the close-step advisory text names
// every id in [taskId, ...chainIds], and composes with the (collaborationMode × mergeMode) axis
// without changing it.
describe('ship complete-action — chain batching (--chain, #2102)', () => {
  it('no chain declared → close text is unchanged (single-issue, byte-identical)', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({ collaborationMode: 'trunk-solo' }),
      '#2102',
      [],
    ).action
    expect(a).toContain('Close the issue, clean up the worktree.')
    expect(a).not.toContain('Close issues')
  })

  it('chain declared → close text names every id, primary first', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({ collaborationMode: 'peer-review' }),
      '#2102',
      ['#2103', '#2104'],
    ).action
    expect(a).toContain('Close issues #2102, #2103, #2104, clean up the worktree.')
  })

  it('normalizes a bare (no #) primary/chain id for display', () => {
    const a = shipStepFor('complete', 'Standard', profile(), '2102', ['2103']).action
    expect(a).toContain('Close issues #2102, #2103, clean up the worktree.')
  })

  it('trunk-solo + direct + chain → STILL no PR, direct push (chain never flips the axis)', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({ collaborationMode: 'trunk-solo', mergeMode: 'direct' }),
      '#2102',
      ['#2103'],
    ).action
    expect(a).toMatch(/no PR/i)
    expect(a).toContain('Close issues #2102, #2103')
  })

  it('peer-review + chain → STILL one PR, never a direct push (acceptance criterion)', () => {
    const a = shipStepFor(
      'complete',
      'Standard',
      profile({ collaborationMode: 'peer-review' }),
      '#2102',
      ['#2103', '#2104'],
    ).action
    expect(a).toMatch(/open a PR/i)
    expect(a).toMatch(/await required review/i)
    expect(a).not.toMatch(/no PR/i)
  })
})

describe('ship final-gate action ordering', () => {
  it('runs the fast preflight and leaves the full gate to CI', () => {
    const verification = shipStepFor('verification', 'Standard', profile())
    const close = shipStepFor('close', 'Standard', profile())
    expect(verification.action).toContain(
      'Run `node scripts/check-all.mjs preflight` as a local diagnostic; push the frozen candidate so CI runs the full gate on that SHA',
    )
    expect(verification.command).toBe('node scripts/check-all.mjs preflight')
    expect(close.action).not.toContain('check-all.mjs')
    expect(close.action).not.toContain('done-evidence.mjs')
  })

  it('keeps evidence-harness self-only checks separate from CI verification', () => {
    const harness = profile({
      collaborationMode: 'trunk-solo',
      mergeMode: 'pr-ff',
      evidenceHarness: true,
    })
    const verification = shipStepFor('verification', 'Standard', harness)
    const close = shipStepFor('close', 'Standard', harness)
    const sequence = `${verification.action} ${close.action}`
    expect(verification.command).toBe('node scripts/check-all.mjs preflight')
    expect(sequence).toContain('node scripts/done-evidence.mjs')
    expect(sequence.match(/check-all\.mjs/g)).toHaveLength(1)
    expect(close.action).toContain('Reuse the recorded CI verdict')
    expect(close.action).toContain('node scripts/pr-merge-watch.mjs <owner/repo> <pr>')
    expect(close.action).toMatch(
      /lifecycle, review, applicable acceptance, receipt, and local HEAD agree/,
    )
  })

  it('pins the selected final level to every delivery consumer requirement', () => {
    const taskSource = readFileSync(join(process.cwd(), 'src', 'commands', 'task.ts'), 'utf8')
    const doneSource = readFileSync(join(process.cwd(), 'scripts', 'done-evidence.mjs'), 'utf8')
    const prePushSource = readFileSync(join(process.cwd(), '.githooks', 'pre-push'), 'utf8')

    expect(taskSource).toContain("function checkGatePassMarkerGate(dir: string, minLevel = 'L2')")
    expect(taskSource).toContain("checkGatePassMarkerGate(dir, 'L1')")
    expect(doneSource).toContain("minLevel: 'L3'")
    expect(prePushSource).toContain('check-all.mjs preflight') // #2773 P7: light pre-push, CI pins L2
    expect(
      shipStepFor('verification', 'Standard', profile({ evidenceHarness: true })).command,
    ).toBe('node scripts/check-all.mjs preflight')
  })
})

describe('ship verification — self-only gates skipped, not faked (#1288 RT-06)', () => {
  it('arbiter-self → verification carries the 3 self-only authoring gates', () => {
    const step = shipStepFor('verification', 'Standard', profile({ isArbiterSelf: true }))
    expect(step.selfOnlyChecks).toEqual(SELF_ONLY_GATES)
  })

  it('consumer → verification selfOnlyChecks is empty (skipped, not faked)', () => {
    const step = shipStepFor('verification', 'Standard', profile({ isArbiterSelf: false }))
    // #2590: assert presence, not `?? []` — a deleted key must fail this.
    expect(step).toHaveProperty('selfOnlyChecks')
    expect(step.selfOnlyChecks).toEqual([])
  })
})

// #1306 — the orchestration prefs are CONSUMED in the ship step plan (not dead):
// refactor reads defaultGateLevel. (#2329 deleted affinityBatching; the plan
// action is now a constant — see __tests__/config/affinity-batching-removed.test.ts.)
describe('ship steps keep expensive gates out of pre-review preparation', () => {
  it('refactor uses a cheap targeted preflight at every configured gate level', () => {
    const l2 = shipStepFor('refactor', 'Standard', profile({ defaultGateLevel: 'L2' }))
    expect(l2.action).toContain('touched tests')
    expect(l2.action).not.toContain('check-all.mjs')
    const l1 = shipStepFor('refactor', 'Standard', profile({ defaultGateLevel: 'L1' }))
    expect(l1.action).toBe(l2.action)
  })

  // #2329 removed the knob that used to branch this action; #2333 removed the
  // profile field it left behind. The action is now a flat constant.
  it('plan action is a single-issue constant across every profile (#2329/#2333)', () => {
    for (const defaultGateLevel of ['L1', 'L2'] as const) {
      const step = shipStepFor('plan', 'Standard', profile({ defaultGateLevel }))
      expect(step.action).toBe(
        'Write the plan with scope and acceptance criteria; mechanical admission checks validate it before TDD.',
      )
    }
  })
})

describe('buildShipStepLines — honest self-only + governance render (#1288 RT-06/08)', () => {
  const size = 'Standard'
  const resultFor = (p: ShipProfile): ShipResult => ({
    phase: 'verification',
    step: shipStepFor('verification', 'Standard', p),
    advanced: false,
    done: false,
    profile: p,
  })

  it('self → prints a Self-only checks line naming the gates', () => {
    const lines = buildShipStepLines(resultFor(profile({ isArbiterSelf: true })), size)
    const joined = lines.join('\n')
    expect(joined).toMatch(/Self-only checks:/)
    for (const g of SELF_ONLY_GATES) expect(joined).toContain(g)
  })

  it('consumer → NO Self-only checks line and NONE of the gate names leak (INV-115)', () => {
    const lines = buildShipStepLines(resultFor(profile({ isArbiterSelf: false })), size)
    const joined = lines.join('\n')
    expect(joined).not.toMatch(/Self-only checks:/)
    for (const g of SELF_ONLY_GATES) expect(joined).not.toContain(g)
  })

  it('always prints a Governance line (governanceLevel is consumed, not dead — RT-08)', () => {
    const lines = buildShipStepLines(resultFor(profile({ governanceLevel: 'L3' })), size)
    expect(lines.join('\n')).toMatch(/Governance:\s*L3/)
  })
})

// #1730 — /ship composes with active companion plugins (green-phase instruction) and announces
// them (Companion: line). Absent ⇒ byte-identical to a companion-free ship.
describe('ship companion composition (#1730)', () => {
  const size = 'Standard'
  const testCompanion = {
    id: 'ponytail:ponytail',
    label: 'ponytail',
    mode: 'full' as const,
    policy: {
      label: 'ponytail',
      defaultMode: 'full' as const,
      greenInstruction: 'DRAFT-LAZY {mode}',
    },
  }
  const stepFor = (p: ShipProfile): ShipResult => ({
    phase: 'green',
    step: shipStepFor('green', 'Standard', p),
    advanced: false,
    done: false,
    profile: p,
  })

  it('green action appends the companion instruction (with mode substituted) when one is active', () => {
    const a = shipStepFor('green', 'Standard', profile({ companions: [testCompanion] })).action
    expect(a).toMatch(/Implement the minimum/)
    expect(a).toContain('DRAFT-LAZY full')
  })

  it('substitutes {mode} in the REAL registry ponytail instruction (no token survives)', () => {
    const ponytail = SKILLS_MATRIX.find((e) => e.id === 'ponytail:ponytail')?.companion
    if (!ponytail) throw new Error('ponytail companion policy missing from SKILLS_MATRIX')
    const real = {
      id: 'ponytail:ponytail',
      label: ponytail.label,
      mode: 'lite' as const,
      policy: ponytail,
    }
    const a = shipStepFor('green', 'Standard', profile({ companions: [real] })).action
    expect(a).toContain('lite mode')
    expect(a).not.toContain('{mode}')
    expect(a).toMatch(/gates remain the safety net/i)
  })

  it('green action is byte-identical to the base string when no companion is active', () => {
    expect(shipStepFor('green', 'Standard', profile({ companions: [] })).action).toBe(
      'Implement the minimum to make the tests pass.',
    )
  })

  it('prints a Companion: line naming the active companion and mode', () => {
    const lines = buildShipStepLines(stepFor(profile({ companions: [testCompanion] })), size)
    expect(lines.join('\n')).toMatch(/Companion:\s*ponytail \(full\)/)
  })

  it('prints NO Companion: line for a companion-free ship (surfaced, not faked)', () => {
    const lines = buildShipStepLines(stepFor(profile({ companions: [] })), size)
    expect(lines.join('\n')).not.toMatch(/Companion:/)
  })
})

describe('ship companion evidence emission (#1745)', () => {
  const testCompanion = {
    id: 'ponytail:ponytail',
    label: 'ponytail',
    mode: 'full' as const,
    policy: {
      label: 'ponytail',
      defaultMode: 'full' as const,
      greenInstruction: 'DRAFT-LAZY {mode}',
    },
  }

  let dir: string
  beforeEach(() => {
    dir = createTestProject()
    mkdirSync(join(dir, '.claude'), { recursive: true })
  })
  afterEach(() => cleanupTestProject(dir))

  it('writes companion evidence when ship enters verification with an active companion', () => {
    runTaskShip({ dir, taskId: '#1745', tier: 'S' })
    writeUnifiedState(dir, { phase: 'verification' })

    runTaskShip({
      dir,
      executionOutcome: 'new-risk',
      profileOverride: profile({
        isArbiterSelf: false,
        companions: [testCompanion],
      }),
      gatherCompanionDiffStats: () => ({ files: 2, insertions: 5, deletions: 1 }),
      recordedAt: '2026-07-03T00:00:00.000Z',
    })

    const path = companionEvidencePath('#1745', dir)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toMatchObject({
      companions: [{ id: 'ponytail:ponytail', mode: 'full' }],
      diffStats: { files: 2, insertions: 5, deletions: 1 },
      recordedAt: '2026-07-03T00:00:00.000Z',
    })
  })

  it('does not write companion evidence without active companions', () => {
    runTaskShip({ dir, taskId: '#1745', tier: 'S' })
    writeUnifiedState(dir, { phase: 'verification' })
    runTaskShip({
      dir,
      profileOverride: profile({ isArbiterSelf: false, companions: [] }),
      gatherCompanionDiffStats: () => ({ files: 2, insertions: 5, deletions: 1 }),
    })
    expect(existsSync(companionEvidencePath('#1745', dir))).toBe(false)
  })
})

describe('result-first read-only status (#2724)', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('reads the same subject twice without remote gathering, state/log writes or round changes', () => {
    runTaskShip({ dir, taskId: '#2724', tier: 'Standard' })
    writeUnifiedState(dir, {
      phase: 'refactor',
      review: { rounds: 1, lastReviewedSha: 'a'.repeat(40) },
      cursor: { lastAction: 'targeted tests green', nextAction: 'record final reviewer' },
      derivedGates: [
        {
          name: 'integration suite (INV-25)',
          command: 'npx vitest run --config vitest.integration.config.ts',
        },
      ],
    })
    const path = join(dir, '.claude/.task/status.json')
    const before = readFileSync(path, 'utf8')
    const gather = vi.fn(() => {
      throw new Error('status must not gather remote signals')
    })
    const first = runTaskShip({ dir, taskId: '#2724', gatherTierSignals: gather })
    const second = runTaskShip({ dir, gatherTierSignals: gather })
    expect(first).toEqual(second)
    expect(gather).not.toHaveBeenCalled()
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(buildShipStepLines(first).join('\n')).toContain('record final reviewer')
    expect(buildShipStepLines(first).join('\n')).toContain('a'.repeat(40))
    expect(buildShipStepLines(first).join('\n')).toContain('Gates awaiting this change:')
    expect(buildShipStepLines(first).join('\n')).toContain('vitest.integration.config.ts')
  })

  it('derives a wider treatment without writing, then persists it on the next transition', () => {
    const persisted = resolveShipTreatment('XS', {
      blastRadius: 0,
      callerCount: 0,
      labels: [],
      milestoneBundled: false,
      changedFiles: ['docs/guide.md'],
      complete: true,
    })
    writeUnifiedState(dir, { taskId: '#2724', tier: 'XS', treatment: persisted })
    const path = join(dir, '.claude/.task/status.json')
    const before = readFileSync(path, 'utf8')

    const status = runTaskShip({ dir, taskId: '#2724' })

    expect(buildShipStepLines(status).join('\n')).toContain('Tier: Standard')
    expect(status.treatment?.tier).toBe('Standard')
    expect(readFileSync(path, 'utf8')).toBe(before)

    const result = runTaskShip({ dir, advance: true })
    expect(result.phase).toBe('red')
    expect(readUnifiedState(dir)?.treatment?.tier).toBe('Standard')
  })

  it('refreshes risk on an operational invocation', () => {
    runTaskShip({
      dir,
      taskId: '#2724',
      tier: 'XS',
      gatherTierSignals: () => ({
        blastRadius: 0,
        callerCount: 0,
        labels: [],
        milestoneBundled: false,
        changedFiles: ['src/leaf.ts'],
        complete: true,
      }),
    })
    const gather = vi.fn(() => ({
      blastRadius: 100,
      callerCount: 100,
      labels: ['security'],
      milestoneBundled: false,
      changedFiles: ['src/auth/login.ts'],
      complete: true,
    }))
    const result = runTaskShip({ dir, executionOutcome: 'new-risk', gatherTierSignals: gather })
    expect(gather).toHaveBeenCalled()
    expect(result.treatment?.sensitive).toBe(true)
    expect(result.tier).toBe('Standard')
  })
})
