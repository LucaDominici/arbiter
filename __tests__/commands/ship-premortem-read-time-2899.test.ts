// SPDX-License-Identifier: Apache-2.0
/**
 * #2899 — the premortem decision must be computed at read time from the CURRENT plan manifest,
 * never persisted in status.json. RED: today `premortemFor` (task-ship.ts:1743-1761) persists
 * whatever it computes at the `plan` step, and `checkPremortemRequired` (task.ts:1660-1669)
 * trusts `state.premortem.decision`/`.reason` verbatim. A decision captured on an earlier `plan`
 * step (e.g. before the real manifest existed, or before the plan changed shape) survives into
 * the review freeze even after the CURRENT manifest resolves differently.
 *
 * Harness mirrors __tests__/commands/ship-review.test.ts's "review rounds through arbiter ship"
 * describe block verbatim (git init → seed plan/RED fixture/TDD evidence → force phase 'green' →
 * `ship({ advance: true })` into refactor → `ship({ reviewRound: true })` to hit
 * `assertReviewSubjectFrozen` → `checkPremortemRequired`). No CLI; `runTaskShip` called directly.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTaskShip } from '../../src/commands/task-ship'
import { readUnifiedState, writeUnifiedState } from '../../src/commands/task-state'
import type { ShipProfile } from '../../src/commands/ship-profile'

const TEST_PROFILE: ShipProfile = {
  isArbiterSelf: false,
  collaborationMode: 'peer-review',
  mergeMode: 'pr-ff',
  governanceLevel: 'L2',
  autonomy: 'L0',
  evidenceHarness: false,
  defaultGateLevel: 'L1',
  companions: [],
}

const SHA_A = 'a'.repeat(40)

// A stale decision as if persisted by an earlier `plan`-step `ship` call (e.g. #2899's
// reproduction: the first `ship` call ran before any plan/manifest existed).
const STALE_REQUIRED_R7 = {
  decision: 'required' as const,
  reason: 'R7-empty-manifest',
  areas: 0,
  hooks: false,
  templates: false,
  workflows: false,
  sensitive: false,
  tier: 'Standard' as const,
}

describe('premortem decision computed at read time, not persisted (#2899)', () => {
  let dir: string

  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({ dir, profileOverride: TEST_PROFILE, ...opts })

  /**
   * Seeds a repo whose plan.md carries the given `files:` manifest, reaches phase `green` with
   * valid TDD evidence (the exact fixture from ship-review.test.ts), then persists a STALE
   * `required/R7-empty-manifest` premortem decision directly — standing in for a first `ship`
   * call that ran while the manifest was still empty
   * (#2899's reproduction path).
   */
  const seedToGreenWithStalePremortem = (manifestFiles: string[]) => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-premortem-2899-'))
    execFileSync('git', ['init', '-q', '-b', 'task/#4612-review'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
    writeFileSync(
      join(dir, 'plan.md'),
      `---\nfiles:\n${manifestFiles.map((f) => `  - ${f}`).join('\n')}\n---\n\n` +
        '# Plan\n\n## Acceptance Criteria\n- AC-1: ships\n',
    )
    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED") // frozen candidate\n')
    writeFileSync(join(dir, 'green-output.mjs'), "process.stdout.write('1 passed\\n')\n")
    execFileSync('git', ['add', '.gitignore', 'plan.md', 'review.test.ts', 'green-output.mjs'], {
      cwd: dir,
    })
    execFileSync('git', ['commit', '-q', '-m', 'test: seed plan'], { cwd: dir })
    const redSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    runTaskShip({ dir, taskId: '#4612', profileOverride: TEST_PROFILE })
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '#4612.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#4612',
        test_path: 'review.test.ts',
        test_commit_sha: redSha,
        test_run_log: 'FAIL review.test.ts\n1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-20T00:00:00.000Z',
        test_command: ['node', 'green-output.mjs'],
      }),
    )
    writeUnifiedState(dir, { phase: 'green', plan: 'plan.md' })
    // The stale persisted decision AC-1/AC-2/AC-3 exercise (see #2899 reproduction: it comes
    // from a plan-step ship call whose manifest was empty at the time).
    writeUnifiedState(dir, { premortem: STALE_REQUIRED_R7 })
  }

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it(
    'AC-1: a stale persisted required/R7-empty-manifest decision does not block the review ' +
      'freeze once the CURRENT plan manifest resolves deterministic',
    () => {
      // Single-area Standard-tier manifest → evaluatePremortem resolves `deterministic /
      // R6-default` (ship-tier.ts rule 6), never `required`.
      seedToGreenWithStalePremortem(['src/commands/task-ship.ts', 'src/commands/ship-tier.ts'])
      ship({ advance: true, headSha: SHA_A })
      expect(readUnifiedState(dir)?.phase).toBe('refactor')

      // EXPECTED (post-fix): checkPremortemRequired recomputes from the CURRENT manifest
      // (deterministic) and does not demand a `premortem:` reference.
      // CURRENT (buggy): it trusts the stale persisted `required/R7-empty-manifest` and throws
      // E_PREMORTEM_REQUIRED — this is exactly arbiter#2899's reproduction.
      expect(() => ship({ reviewRound: true, headSha: SHA_A })).not.toThrow()
    },
  )

  it(
    'AC-2: the E_PREMORTEM_REQUIRED refusal names the rule computed from the CURRENT ' +
      'manifest, not the persisted stale one',
    () => {
      // A hooks/ path manifest → evaluatePremortem resolves `required / R1-hooks-templates`, a
      // DIFFERENT reason than the persisted stale R7-empty-manifest.
      seedToGreenWithStalePremortem(['src/templates/hooks/pre-push.sh.ejs'])
      ship({ advance: true, headSha: SHA_A })

      // EXPECTED (post-fix): refusal names R1-hooks-templates (the CURRENT manifest's rule).
      // CURRENT (buggy): checkPremortemRequired reads `state.premortem.reason`, i.e. the stale
      // R7-empty-manifest persisted in seedToGreenWithStalePremortem, and names THAT instead —
      // confirmed by direct run: throws
      // "PREMORTEM REQUIRED (R7-empty-manifest) — declare a `premortem:` reference in plan.md...".
      let thrown: unknown
      try {
        ship({ reviewRound: true, headSha: SHA_A })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).toMatch(/R1-hooks-templates/)
    },
  )

  it(
    'AC-3: status.json no longer carries `premortem` after a plan-step ship call, and a ' +
      'pre-existing premortem key on disk is ignored (never trusted) by the review freeze',
    () => {
      dir = mkdtempSync(join(tmpdir(), 'arbiter-premortem-2899-ac3-'))
      execFileSync('git', ['init', '-q', '-b', 'task/#4612-ac3'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir })
      writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
      execFileSync('git', ['add', '.gitignore'], { cwd: dir })
      execFileSync('git', ['commit', '-q', '-m', 'test: seed repo'], { cwd: dir })

      // `tier` marks the call as a lifecycle/profile mutation so it is not short-circuited as a
      // read-only status query (isReadOnlyShipRequest, task-ship.ts:1640-1651).
      runTaskShip({ dir, taskId: '#4612', tier: 'Standard', profileOverride: TEST_PROFILE })
      writeUnifiedState(dir, { plan: 'plan.md', phase: 'plan' })

      // EXPECTED (post-fix): a plan-step call with an empty manifest (plan.md does not exist on
      // disk yet) must NOT write `premortem` into status.json — the decision is derived, not
      // stored.
      // CURRENT (buggy): premortemFor (task-ship.ts:1757-1758) persists
      // { decision: 'required', reason: 'R7-empty-manifest', ... } on this call .
      ship({ tier: 'Standard' })
      expect(readUnifiedState(dir)?.premortem).toBeUndefined()

      // A file that still carries a stale premortem key (e.g. written by a pre-#2899 arbiter
      // version) must be ignored, not trusted as ground truth, by the review freeze.
      rmSync(dir, { recursive: true, force: true })
      seedToGreenWithStalePremortem(['src/commands/task-ship.ts', 'src/commands/ship-tier.ts'])
      ship({ advance: true, headSha: SHA_A })
      expect(() => ship({ reviewRound: true, headSha: SHA_A })).not.toThrow()
    },
  )
})
