// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/pr-merge-watch.test.ts
//
// #2098: merge-on-green PR watcher. Pure predicate unit tests (direct import,
// no `gh` calls) + a real spawn of --self-test (CANON-07: generated scripts
// must be executed in tests, not just string-matched).
//
// The `classify()` fixtures below include the EXACT case that stalled
// tonight's hand-rolled watchers for 7+ minutes: a check-conclusion set of
// {SKIPPED, SUCCESS} must evaluate as green. This is the permanent regression
// test for that bug (#2098 acceptance criteria).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { classify, pickMergeMethod } from '../../scripts/pr-merge-watch.mjs'

// PATH scoped to node's OWN directory only — `gh` (and everything else) is
// unreachable, so if --self-test ever shells out to `gh` the spawn throws
// instead of silently succeeding against a real network call.
const NODE_ONLY_PATH = dirname(process.execPath)

describe('classify (#2098) — green/hard-fail/pending predicate', () => {
  const rollup = (conclusions: string[]) => conclusions.map((conclusion) => ({ conclusion }))

  it("{SKIPPED, SUCCESS} is green — the exact set that stalled tonight's watchers", () => {
    expect(classify(rollup(['SKIPPED', 'SUCCESS']))).toBe('green')
  })

  it('all-SKIPPED is green (edge case)', () => {
    expect(classify(rollup(['SKIPPED', 'SKIPPED', 'SKIPPED']))).toBe('green')
  })

  it('SUCCESS + NEUTRAL + SKIPPED is green', () => {
    expect(classify(rollup(['SUCCESS', 'NEUTRAL', 'SKIPPED']))).toBe('green')
  })

  it('one FAILURE among otherwise-green checks is hard-fail', () => {
    expect(classify(rollup(['SUCCESS', 'FAILURE', 'SKIPPED']))).toBe('hard-fail')
  })

  it.each(['TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])(
    '%s is hard-fail',
    (conclusion) => {
      expect(classify(rollup(['SUCCESS', conclusion]))).toBe('hard-fail')
    },
  )

  it('an empty-string (pending/in-progress) conclusion is not-yet-green — keep polling', () => {
    expect(classify(rollup(['SUCCESS', '']))).toBe('pending')
  })

  it('an empty rollup (no checks reported yet) is pending, not green', () => {
    expect(classify([])).toBe('pending')
  })

  it('hard-fail wins over a simultaneous pending check', () => {
    expect(classify(rollup(['FAILURE', '']))).toBe('hard-fail')
  })
})

describe('pickMergeMethod (#2098) — squash > rebase > merge-commit', () => {
  it('prefers squash when allowed', () => {
    expect(pickMergeMethod({ squash: true, rebase: true, merge: true })).toBe('squash')
  })

  it('falls back to rebase when squash is disallowed', () => {
    expect(pickMergeMethod({ squash: false, rebase: true, merge: true })).toBe('rebase')
  })

  it('falls back to merge-commit when only merge-commit is allowed', () => {
    expect(pickMergeMethod({ squash: false, rebase: false, merge: true })).toBe('merge')
  })

  it('returns null when no merge method is allowed', () => {
    expect(pickMergeMethod({ squash: false, rebase: false, merge: false })).toBeNull()
  })
})

describe('pr-merge-watch.mjs --self-test (#2098, CANON-07 real execution)', () => {
  it('exits 0 and makes no `gh` calls', () => {
    const r = spawnSync('node', ['scripts/pr-merge-watch.mjs', '--self-test'], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: NODE_ONLY_PATH }, // gh unreachable — self-test must never invoke it
    })
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0)
    expect(r.stdout).toContain('SKIPPED')
  })

  it('prints usage and exits 2 when required args are missing', () => {
    const r = spawnSync('node', ['scripts/pr-merge-watch.mjs'], { encoding: 'utf-8' })
    expect(r.status).toBe(2)
    expect(r.stderr.toLowerCase()).toContain('usage')
  })
})
