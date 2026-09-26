// SPDX-License-Identifier: Apache-2.0
/**
 * #2928 — `checkBakeAfterTemplates` (#2863 AC-4, src/commands/task.ts) refuses a review freeze
 * whenever a `src/templates` commit is newer than the last bake-snapshot commit — by COMMIT
 * ORDER, never by content. A template change whose bake produces no snapshot diff (#2903 shape:
 * only the TypeScript evidence-collector branch changed, no bake lane renders it) has nothing
 * to commit under `__tests__/integration/e2e/bake/__snapshots__`, so the order check refuses
 * forever — there is no snapshot commit that could ever be "newer".
 *
 * AC-2: that template change reaches review freeze without a synthetic commit, once the bake
 * suite's own drift check has proven HEAD's content still matches every snapshot
 * (`bakeVerifiedSha`, recorded by `fixture-bake.test.ts`'s `afterAll`).
 * AC-3: a template change that DOES alter a bake lane's output, with stale snapshots and no
 * recorded verification, is still refused with the existing remedy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTaskShip } from '../../src/commands/task-ship'
import { readUnifiedState, writeUnifiedState, reviewStateOf } from '../../src/commands/task-state'
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

const BAKE_GATE = {
  name: 'integration suite (INV-25)',
  kind: 'artifact-regenerate',
  command: 'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake',
}

describe('checkBakeAfterTemplates — content over commit order (#2928)', () => {
  let dir: string

  const ship = (opts: Record<string, unknown> = {}) =>
    runTaskShip({ dir, profileOverride: TEST_PROFILE, ...opts })
  const review = () => reviewStateOf(readUnifiedState(dir))
  const commit = (files: string[], message: string) => {
    for (const file of files) {
      mkdirSync(join(dir, file, '..'), { recursive: true })
      writeFileSync(join(dir, file), `${message}\n`)
    }
    execFileSync('git', ['add', ...files], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir })
  }
  const headSha = () =>
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-bake-content-'))
    execFileSync('git', ['init', '-q', '-b', 'task/#2928-review'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'fixture@arbiter.dev'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\n')
    writeFileSync(
      join(dir, 'plan.md'),
      '---\nfiles:\n  - review.test.ts\n---\n\n# Plan\n\n## Acceptance Criteria\n- AC-1: ships\n',
    )
    writeFileSync(join(dir, 'review.test.ts'), 'throw new Error("RED") // frozen candidate\n')
    writeFileSync(join(dir, 'green-output.mjs'), "process.stdout.write('1 passed\\n')\n")
    execFileSync('git', ['add', '.gitignore', 'plan.md', 'review.test.ts', 'green-output.mjs'], {
      cwd: dir,
    })
    execFileSync('git', ['commit', '-q', '-m', 'test: seed plan'], { cwd: dir })
    const redSha = headSha()
    runTaskShip({ dir, taskId: '#2928', profileOverride: TEST_PROFILE })
    const evidenceDir = join(dir, '.arbiter', 'evidence', 'tdd')
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(
      join(evidenceDir, '#2928.json'),
      JSON.stringify({
        $schemaVersion: 1,
        task_id: '#2928',
        test_path: 'review.test.ts',
        test_commit_sha: redSha,
        test_run_log: 'FAIL review.test.ts\n1 test failed',
        observed_failure: 'FAIL review.test.ts',
        recorded_at: '2026-09-26T00:00:00.000Z',
        test_command: ['node', 'green-output.mjs'],
      }),
    )
    writeUnifiedState(dir, { phase: 'green', plan: 'plan.md' })
    ship({ advance: true, headSha: headSha() })
    writeUnifiedState(dir, { derivedGates: [BAKE_GATE] })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2: a template change with no snapshot diff reaches freeze once bake verified HEAD content, no synthetic commit', () => {
    const template = 'src/templates/scripts/evidence-collect.mjs.ejs'
    commit([template], 'fix(evidence): request json-summary coverage in the TS collector (#2903)')
    const head = headSha()

    // RED today: no snapshot commit exists after the template commit (there is nothing to
    // commit — the #2903 change touches no bake lane), so the commit-order check refuses
    // forever. This is exactly what #2928 reports.
    expect(() => ship({ reviewRound: true, headSha: head })).toThrow(
      /BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake/,
    )

    // GREEN: the bake suite ran at this exact HEAD (clean tree) and every fixture's rendered
    // content still matched its committed snapshot — recorded by fixture-bake.test.ts's
    // afterAll, exactly as it would for the real #2903 change.
    writeUnifiedState(dir, { bakeVerifiedSha: head })
    ship({ reviewRound: true, headSha: head })
    expect(review()).toEqual({ rounds: 1, lastReviewedSha: head })
  })

  it('AC-3: a template change that alters bake output, with stale snapshots and no verification, is still refused', () => {
    const template = 'src/templates/AGENTS.md.ejs'
    commit([template], 'fix: template before any rebake')
    const head = headSha()

    // No bakeVerifiedSha recorded (the bake run for this HEAD either never happened or would
    // fail on content drift) — refused exactly as #2863 AC-4 already guarantees.
    expect(() => ship({ reviewRound: true, headSha: head })).toThrow(
      /BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake/,
    )
    // A stale recorded SHA (an earlier, no-longer-HEAD verification) must not launder a later,
    // unverified template edit through the freeze.
    writeUnifiedState(dir, { bakeVerifiedSha: 'f'.repeat(40) })
    expect(() => ship({ reviewRound: true, headSha: head })).toThrow(
      /BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake/,
    )
  })
})
