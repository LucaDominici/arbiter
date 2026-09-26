// SPDX-License-Identifier: Apache-2.0
// #2875 — the review round must refuse to open on a stale base.
//
// `ship --review-round` never checked whether HEAD had actually merged the latest `origin/main`.
// A reviewer's verdict on a stale candidate is worthless: the diff it sees isn't the diff that
// lands. This proves the round refuses (no state write, no dispatch) when HEAD is behind, skips
// cleanly when there's nothing to compare against, and that the merge-not-rebase guidance and the
// task-scoped plan default are wired everywhere the writer actually reads them.
import { describe, it, expect, afterEach } from 'vitest'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runTaskShip, shipStepFor } from '../../src/commands/task-ship.js'
import { runTaskInit, runTaskResume } from '../../src/commands/task.js'
import {
  readUnifiedState,
  writeUnifiedState,
  reviewStateOf,
} from '../../src/commands/task-state.js'
import { renderTemplate } from '../../src/utils/render.js'
import type { ShipProfile } from '../../src/commands/ship-profile'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

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
const profile = (over: Partial<ShipProfile> = {}): ShipProfile => ({ ...TEST_PROFILE, ...over })

const PHRASE = 'integrate main with a merge commit, never rebase (TDD evidence pins commit SHAs)'
const SHA_A = 'a'.repeat(40)

// Copied from __tests__/commands/task-advance-gates.test.ts
function installGateContractAuthority(dir: string): void {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(
    join(dir, 'scripts', 'check-all.mjs'),
    [
      '#!/usr/bin/env node',
      '// @arbiter-gate-contract arbiter-gate-contract-v1',
      "import { createHash } from 'node:crypto'",
      "import { readFileSync } from 'node:fs'",
      "import { fileURLToPath } from 'node:url'",
      'const path = fileURLToPath(import.meta.url)',
      "const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')",
      "console.log(JSON.stringify({ schema: 'arbiter-gate-contract-v1', authority: [{ path: 'scripts/check-all.mjs', sha256 }], gates: [], external: [], unresolved: [] }))",
      '',
    ].join('\n'),
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
    'exact-sha-policy.mjs',
    'gate-affects-registry.mjs',
    'gate-contract.mjs',
    'gate-derivation.mjs',
  ]) {
    copyFileSync(resolve(__dirname, `../../scripts/lib/${file}`), join(dir, `scripts/lib/${file}`))
  }
  copyFileSync(
    resolve(__dirname, '../../scripts/derive-plan-gates.mjs'),
    join(dir, 'scripts/derive-plan-gates.mjs'),
  )
  installGateContractAuthority(dir)
}

function installAcceptanceGh(dir: string): void {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const gh = join(bin, 'gh')
  writeFileSync(
    gh,
    '#!/bin/sh\nprintf \'%s\' \'{"number":2875,"url":"https://example.invalid/issues/2875","body":"## Acceptance Criteria\\n- AC-1: behavior","updatedAt":"2026-09-20T00:00:00Z"}\'\n',
  )
  chmodSync(gh, 0o755)
}

describe('AC-2875.1 stale base', () => {
  const VALID_PLAN = [
    '---',
    "title: '#2875'",
    'files:',
    '  - plan.md',
    '---',
    '## Acceptance Criteria',
    '- [ ] AC-2875.1: behavior',
    '## Non-Goals',
    '- x',
  ].join('\n')

  // Bare origin; main gains a commit HEAD lacks; tracking ref deleted so only a fetch reveals it.
  function repoBehindOrigin(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ship-stale-'))
    dirs.push(dir)
    const bare = join(dir, 'origin.git')
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('git', ['init', '-q', '--bare', bare])
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@arbiter.dev')
    git('config', 'user.name', 'F')
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\norigin.git/\n')
    writeFileSync(join(dir, 'plan.md'), VALID_PLAN)
    git('add', '-A')
    git('commit', '-q', '-m', 'seed')
    git('remote', 'add', 'origin', bare)
    git('push', '-q', 'origin', 'main')
    git('checkout', '-q', '-b', 'task/#2875-stale')
    writeFileSync(join(dir, 'landed.txt'), 'x\n')
    git('add', 'landed.txt')
    git('commit', '-q', '-m', 'landed on main')
    git('push', '-q', 'origin', 'HEAD:main')
    git('reset', '-q', '--hard', 'HEAD~1')
    git('update-ref', '-d', 'refs/remotes/origin/main')
    return dir
  }

  function seedRefactor(dir: string, extra: Record<string, unknown> = {}): void {
    writeUnifiedState(dir, {
      phase: 'refactor',
      plan: 'plan.md',
      branch: 'task/#2875-stale',
      taskId: '#2875',
      ...extra,
    })
  }

  const ship = (dir: string, opts: Record<string, unknown> = {}) =>
    runTaskShip({ dir, profileOverride: TEST_PROFILE, reviewRound: true, ...opts })

  it('refuses with merge and re-anchor commands; rounds 0; no dispatch', () => {
    const dir = repoBehindOrigin()
    seedRefactor(dir)
    expect(() => ship(dir, { headSha: SHA_A })).toThrow(/git merge --no-edit origin\/main/)
    expect(() => ship(dir, { headSha: SHA_A })).toThrow(/lifecycle start --id '#2875'/)
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 0, lastReviewedSha: null })
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'cross-model'))).toBe(false)
  })

  it('refuses on the incomplete-panel retry path too', () => {
    const dir = repoBehindOrigin()
    seedRefactor(dir)
    expect(() => ship(dir, { headSha: SHA_A, retryIncomplete: true })).toThrow(
      /git merge --no-edit origin\/main/,
    )
    expect(() => ship(dir, { headSha: SHA_A, retryIncomplete: true })).toThrow(
      /lifecycle start --id '#2875'/,
    )
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 0, lastReviewedSha: null })
    expect(readUnifiedState(dir)?.phase).toBe('refactor')
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'cross-model'))).toBe(false)
  })

  it('no origin/main ref but an origin remote → refuses NO DATA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-stale-nodata-'))
    dirs.push(dir)
    const bare = join(dir, 'origin.git')
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    execFileSync('git', ['init', '-q', '--bare', bare])
    git('init', '-q', '-b', 'task/#2875-stale')
    git('config', 'user.email', 'test@arbiter.dev')
    git('config', 'user.name', 'F')
    writeFileSync(join(dir, '.gitignore'), '.claude/.task/\n.arbiter/\norigin.git/\n')
    writeFileSync(join(dir, 'plan.md'), VALID_PLAN)
    git('add', '-A')
    git('commit', '-q', '-m', 'seed')
    git('remote', 'add', 'origin', bare) // remote configured, nothing ever pushed
    seedRefactor(dir)
    expect(() => ship(dir, { headSha: SHA_A })).toThrow(/origin\/main/)
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 0, lastReviewedSha: null })
  })

  it('no origin remote → skips', () => {
    const dir = repoBehindOrigin()
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    git('remote', 'remove', 'origin')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    seedRefactor(dir)
    const result = ship(dir, { headSha: SHA_A })
    // #2910 F4 — the no-seat round opens (rounds: 1) but dispatches nobody.
    expect(result.reviewDispatched).toBe(false)
    expect(result.reviewNote).toMatch(/no reviewer dispatched/)
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 1, lastReviewedSha: SHA_A })
  })

  it('opens the round after git merge --no-edit origin/main', () => {
    const dir = repoBehindOrigin()
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    git('fetch', '--quiet', 'origin', 'main')
    git('merge', '--no-edit', 'origin/main')
    const headSha = git('rev-parse', 'HEAD')
    seedRefactor(dir)
    const result = ship(dir, { headSha })
    // #2910 F4 — the no-seat round opens (rounds: 1) but dispatches nobody.
    expect(result.reviewDispatched).toBe(false)
    expect(result.reviewNote).toMatch(/no reviewer dispatched/)
    expect(reviewStateOf(readUnifiedState(dir))).toEqual({ rounds: 1, lastReviewedSha: headSha })
  })
})

describe('AC-2875.2 merge-not-rebase phrase', () => {
  it('is in the refactor and verification ship steps', () => {
    expect(shipStepFor('refactor', 'Standard', profile(), '#2875').action).toContain(PHRASE)
    expect(shipStepFor('verification', 'Standard', profile(), '#2875').action).toContain(PHRASE)
  })

  it('is in the runTaskResume recovery text for refactor and verification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-stale-resume-'))
    dirs.push(dir)
    let captured = ''
    const write = (t: string): void => {
      captured += t
    }
    writeUnifiedState(dir, { phase: 'refactor' })
    runTaskResume({ dir, write })
    expect(captured).toContain(PHRASE)

    captured = ''
    writeUnifiedState(dir, { phase: 'verification' })
    runTaskResume({ dir, write })
    expect(captured).toContain(PHRASE)
  })

  it('is in both ship.md copies, after the Gate economy heading', () => {
    const md = readFileSync(resolve(__dirname, '../../.claude/commands/ship.md'), 'utf-8')
    const ejs = readFileSync(
      resolve(__dirname, '../../src/templates/claude/commands/ship.md.ejs'),
      'utf-8',
    )
    expect(md.split('## Gate economy')[1]).toContain(PHRASE)
    expect(ejs.split('## Gate economy')[1]).toContain(PHRASE)
  })

  it('is in the rendered ship.md.ejs', () => {
    const rendered = renderTemplate('claude/commands/ship.md.ejs', {
      shipLabel: 'ship',
      harnessCmd: 'claude',
    })
    expect(rendered).toContain(PHRASE)
  })
})

describe('AC-2875.3 auto re-derive', () => {
  const FILES = ['src/templates/claude/commands/ship.md.ejs']
  const VALID_PLAN = [
    '---',
    "title: '#2875'",
    'files:',
    ...FILES.map((file) => `  - ${file}`),
    '---',
    '## Acceptance Criteria',
    '- [ ] AC-2875.3: behavior',
    '## Non-Goals',
    '- x',
  ].join('\n')

  function acceptanceRepo(plan: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'ship-stale-rederive-'))
    dirs.push(dir)
    mkdirSync(join(dir, '.claude'), { recursive: true })
    installAcceptanceChecker(dir)
    installAcceptanceGh(dir)
    writeFileSync(join(dir, 'plan.md'), plan, 'utf-8')
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        collaborationMode: 'trunk-solo',
        solo: { mergeMode: 'pr-ff' },
        features: { acceptanceAnchor: true },
      }),
      'utf-8',
    )
    return dir
  }

  // Rewrites a derived-artifact command in place; touches no contract authority.
  function bumpDerivedCommand(dir: string): void {
    const path = join(dir, 'scripts', 'lib', 'gate-derivation.mjs')
    const src = readFileSync(path, 'utf-8')
    if (!src.includes('BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake')) {
      throw new Error('fixture gate-derivation.mjs missing the expected bake literal')
    }
    writeFileSync(
      path,
      src.replace(
        'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake',
        'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake -- --v2',
      ),
      'utf-8',
    )
  }

  it('re-derives when only a derived-artifact command changed', () => {
    const dir = acceptanceRepo(VALID_PLAN)
    runTaskInit({ dir, id: '#2875', plan: 'plan.md' })
    writeUnifiedState(dir, {
      phase: 'refactor',
      review: { rounds: 1, lastReviewedSha: SHA_A },
    })
    const before = readUnifiedState(dir)?.derivedGates
    const beforePlan = readUnifiedState(dir)?.derivedGatesPlan
    bumpDerivedCommand(dir)

    expect(() => runTaskResume({ dir })).not.toThrow()

    const state = readUnifiedState(dir)
    expect(JSON.stringify(state?.derivedGates)).toContain(
      'BAKE_UPDATE_SNAPSHOTS=1 npm run test:e2e:bake -- --v2',
    )
    expect(state?.derivedGates).not.toEqual(before)
    expect(state?.review).toEqual({ rounds: 1, lastReviewedSha: SHA_A })
    expect(state?.derivedGatesPlan).toEqual(beforePlan)
  })

  it('still refuses when the authority changed, record untouched', () => {
    const dir = acceptanceRepo(VALID_PLAN)
    runTaskInit({ dir, id: '#2875', plan: 'plan.md' })
    writeUnifiedState(dir, { phase: 'refactor' })
    const before = readUnifiedState(dir)?.derivedGates
    bumpDerivedCommand(dir)
    const authority = join(dir, 'scripts', 'check-all.mjs')
    writeFileSync(authority, `${readFileSync(authority, 'utf-8')}\n// changed authority\n`)

    expect(() => runTaskResume({ dir })).toThrow(/derived gates are missing or stale/i)
    expect(readUnifiedState(dir)?.derivedGates).toEqual(before)
  })

  it('still refuses when the plan was edited', () => {
    const dir = acceptanceRepo(VALID_PLAN)
    runTaskInit({ dir, id: '#2875', plan: 'plan.md' })
    writeUnifiedState(dir, { phase: 'refactor' })
    bumpDerivedCommand(dir)
    writeFileSync(
      join(dir, 'plan.md'),
      `${readFileSync(join(dir, 'plan.md'), 'utf-8')}\n- [ ] AC-2875.99: added later\n`,
    )

    expect(() => runTaskResume({ dir })).toThrow(/derived gates are missing or stale/i)
  })

  it('re-derives at most once per call', () => {
    const dir = acceptanceRepo(VALID_PLAN)
    runTaskInit({ dir, id: '#2875', plan: 'plan.md' })
    writeUnifiedState(dir, { phase: 'refactor' })
    const script = join(dir, 'scripts', 'derive-plan-gates.mjs')
    const countFile = join(dir, 'derive-count.txt')
    writeFileSync(countFile, '')
    const scriptLines = readFileSync(script, 'utf-8').split('\n')
    scriptLines.splice(
      1,
      0,
      `import { appendFileSync } from 'node:fs'; try { appendFileSync(${JSON.stringify(countFile)}, 'x') } catch {}`,
    )
    writeFileSync(script, scriptLines.join('\n'))
    bumpDerivedCommand(dir)
    bumpDerivedCommand(dir) // stack a second derived-only change between calls

    runTaskResume({ dir })

    expect(readFileSync(countFile, 'utf-8').length).toBeLessThanOrEqual(1)
  })
})

describe('AC-2875.4 task-scoped plan', () => {
  it('preflight defaults to the task-scoped plan path', () => {
    expect(shipStepFor('preflight', 'Standard', profile(), '#2875').command).toBe(
      "arbiter lifecycle start --id '#2875' --tier Standard --plan .claude/plans/task-2875.md",
    )
  })

  it('honours an anchored root PLAN.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-stale-plan-'))
    dirs.push(dir)
    writeUnifiedState(dir, { plan: 'PLAN.md' })
    const context = readUnifiedState(dir)
    const step = shipStepFor('preflight', 'Standard', profile(), '#2875', {
      ...(context?.plan !== undefined ? { plan: context.plan } : {}),
    })
    expect(step.command).toContain('--plan PLAN.md')
  })

  it('both ship.md copies name the task-scoped default', () => {
    const md = readFileSync(resolve(__dirname, '../../.claude/commands/ship.md'), 'utf-8')
    const ejs = readFileSync(
      resolve(__dirname, '../../src/templates/claude/commands/ship.md.ejs'),
      'utf-8',
    )
    expect(md).toMatch(/\.claude\/plans\/task-<N>\.md/)
    expect(ejs).toMatch(/\.claude\/plans\/task-<N>\.md/)
  })
})
