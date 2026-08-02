// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  GATE_AFFECTS_REGISTRY,
  GATE_SKIP_BLACKLIST,
} from '../../scripts/lib/gate-affects-registry.mjs'

// Unit tests for selective gating logic (ADR-053)
// Tests the computeSkipped() pure function exported from scripts/check-all.mjs.
// Isolation comes from the cache-busted dynamic import (no module-level state).

let computeSkipped: (
  changedFiles: string[],
  registry: Array<{ name: string; affects: string[] }>,
  blacklist: string[],
) => Set<string>

beforeEach(async () => {
  // Cache-busted dynamic import for test isolation.
  const mod = await import('../../scripts/check-all.mjs?t=' + Date.now())
  computeSkipped = (mod as { computeSkipped: typeof computeSkipped }).computeSkipped
})

describe('computeSkipped — blacklist forces full gate', () => {
  const registry = [
    { name: 'typecheck', affects: ['src/**/*.ts'] },
    { name: 'unit tests', affects: ['src/**', '__tests__/**'] },
    { name: 'lint', affects: ['src/**', '__tests__/**'] },
  ]
  const blacklist = ['tsconfig*.json', 'package.json', 'pnpm-lock.yaml', 'src/utils/**']

  it('tsconfig.json change → full gate (empty skipped set)', () => {
    const skipped = computeSkipped(['tsconfig.json'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('package.json change → full gate', () => {
    const skipped = computeSkipped(['package.json'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('src/utils/run-cli.ts change → full gate (blacklisted path)', () => {
    const skipped = computeSkipped(['src/utils/run-cli.ts'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('pnpm-lock.yaml change → full gate', () => {
    const skipped = computeSkipped(['pnpm-lock.yaml'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })
})

describe('computeSkipped — unrelated file skips checks', () => {
  const registry = [
    { name: 'typecheck', affects: ['src/**/*.ts'] },
    { name: 'docs', affects: ['docs/**'] },
  ]
  const blacklist = ['tsconfig*.json']

  it('docs-only change → typecheck skipped', () => {
    const skipped = computeSkipped(['docs/ADR/053.md'], registry, blacklist)
    expect(skipped.has('typecheck')).toBe(true)
  })

  it('docs-only change → docs NOT skipped (affects docs/**)', () => {
    const skipped = computeSkipped(['docs/ADR/053.md'], registry, blacklist)
    expect(skipped.has('docs')).toBe(false)
  })

  it('src change → typecheck NOT skipped', () => {
    const skipped = computeSkipped(['src/foo.ts'], registry, blacklist)
    expect(skipped.has('typecheck')).toBe(false)
  })
})

describe('computeSkipped — checks not in registry always run', () => {
  const registry = [{ name: 'typecheck', affects: ['src/**/*.ts'] }]
  const blacklist = ['tsconfig*.json']

  it('check not in registry is never skipped', () => {
    const skipped = computeSkipped(['docs/foo.md'], registry, blacklist)
    expect(skipped.has('lint')).toBe(false)
    expect(skipped.has('unit tests')).toBe(false)
  })
})

describe('computeSkipped — mixed changes', () => {
  const registry = [
    { name: 'typecheck', affects: ['src/**/*.ts'] },
    { name: 'docs', affects: ['docs/**'] },
  ]
  const blacklist = ['tsconfig*.json', 'package.json']

  it('mixed TS + docs change → typecheck NOT skipped', () => {
    const skipped = computeSkipped(['src/foo.ts', 'docs/ADR/053.md'], registry, blacklist)
    expect(skipped.has('typecheck')).toBe(false)
  })

  it('docs-only + blacklist change → full gate (empty skipped set)', () => {
    const skipped = computeSkipped(['docs/ADR/053.md', 'package.json'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })
})

describe('computeSkipped — input validation', () => {
  const registry: Array<{ name: string; affects: string[] }> = []
  const blacklist: string[] = []

  it('absolute paths are rejected → full gate', () => {
    const skipped = computeSkipped(['/etc/passwd'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('../ escape paths are rejected → full gate', () => {
    const skipped = computeSkipped(['../other-repo/secret.ts'], registry, blacklist)
    expect(skipped.size).toBe(0)
  })

  it('list over 500 files → full gate', () => {
    const files = Array.from({ length: 501 }, (_, i) => `src/file${i}.ts`)
    const skipped = computeSkipped(files, registry, blacklist)
    expect(skipped.size).toBe(0)
  })
})

// #2094: the REAL registry, not synthetic fixtures. Coverage assertion is the
// load-bearing one — a check renamed in check-all.mjs without a matching
// registry update must fail here, not silently fall through to ALWAYS
// (ALWAYS is safe, but an untracked rename is still a registry bug).
describe('GATE_AFFECTS_REGISTRY — real registry coverage + representative samples', () => {
  it('covers every check name declared in check-all.mjs (runCheck/runWarnCheck/runToolCheck)', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../scripts/check-all.mjs'),
      'utf-8',
    )
    const declared = new Set(
      [...source.matchAll(/run(?:Check|WarnCheck|ToolCheck)\(\s*'([^']+)'/g)].map((m) => m[1]),
    )
    const registered = new Set(GATE_AFFECTS_REGISTRY.map((e) => e.name))
    const missing = [...declared].filter((n) => !registered.has(n))
    const stale = [...registered].filter((n) => !declared.has(n))
    expect(
      missing,
      `check(s) in check-all.mjs missing from registry: ${missing.join(', ')}`,
    ).toEqual([])
    expect(
      stale,
      `registry entries no longer declared in check-all.mjs: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('registry has no duplicate names', () => {
    const names = GATE_AFFECTS_REGISTRY.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('docs-only change: wiki lint runs (affected), actionlint + template tests skip (unaffected)', () => {
    const skipped = computeSkipped(
      ['docs/technical-debt.md'],
      GATE_AFFECTS_REGISTRY,
      GATE_SKIP_BLACKLIST,
    )
    expect(skipped.has('wiki lint (INV-116)')).toBe(false)
    expect(skipped.has('actionlint')).toBe(true)
    expect(skipped.has('template tests')).toBe(true)
    expect(skipped.has('typecheck')).toBe(false) // ALWAYS bucket
  })

  it('workflow-only change: actionlint runs (affected), wiki lint + template tests skip (unaffected)', () => {
    const skipped = computeSkipped(
      ['.github/workflows/01-pr-fast.yml'],
      GATE_AFFECTS_REGISTRY,
      GATE_SKIP_BLACKLIST,
    )
    expect(skipped.has('actionlint')).toBe(false)
    expect(skipped.has('wiki lint (INV-116)')).toBe(true)
    expect(skipped.has('template tests')).toBe(true)
    expect(skipped.has('typecheck')).toBe(false) // ALWAYS bucket
  })

  it('template-only change: template tests run (affected), wiki lint + actionlint skip (unaffected)', () => {
    const skipped = computeSkipped(
      ['src/templates/scripts/check-all.mjs.ejs'],
      GATE_AFFECTS_REGISTRY,
      GATE_SKIP_BLACKLIST,
    )
    expect(skipped.has('template tests')).toBe(false)
    expect(skipped.has('wiki lint (INV-116)')).toBe(true)
    expect(skipped.has('actionlint')).toBe(true)
    expect(skipped.has('typecheck')).toBe(false) // ALWAYS bucket
  })

  it('review-completion contract changes select its advisory gate (#2177)', () => {
    for (const changedFile of [
      'scripts/check-review-completion.mjs',
      'schemas/agent-return.schema.json',
      '.claude/commands/ship.md',
    ]) {
      const skipped = computeSkipped([changedFile], GATE_AFFECTS_REGISTRY, GATE_SKIP_BLACKLIST)
      expect(skipped.has('review completion (#2177)')).toBe(false)
    }
  })

  it('ALWAYS-bucket checks are never skipped by any single-category change', () => {
    for (const files of [['docs/foo.md'], ['.github/workflows/x.yml'], ['src/templates/y.ejs']]) {
      const skipped = computeSkipped(files, GATE_AFFECTS_REGISTRY, GATE_SKIP_BLACKLIST)
      expect(skipped.has('gitleaks')).toBe(false)
      expect(skipped.has('unit tests')).toBe(false)
      expect(skipped.has('typecheck')).toBe(false)
    }
  })

  it('blacklist paths (package.json, scripts/lib/**) force the full real gate', () => {
    const skipped = computeSkipped(['package.json'], GATE_AFFECTS_REGISTRY, GATE_SKIP_BLACKLIST)
    expect(skipped.size).toBe(0)
  })

  it('src change alongside docs change does not skip src-affecting checks', () => {
    const skipped = computeSkipped(
      ['src/generators/foo.ts', 'docs/bar.md'],
      GATE_AFFECTS_REGISTRY,
      GATE_SKIP_BLACKLIST,
    )
    expect(skipped.has('typecheck')).toBe(false)
    expect(skipped.has('unit tests')).toBe(false)
  })
})

describe('run-helpers.mjs — setSkippedChecks wiring', () => {
  it('a check in the skip set is recorded SKIP without spawning', async () => {
    const helpers = await import('../../scripts/lib/run-helpers.mjs?t=' + Date.now())
    helpers.resetState()
    helpers.setSkippedChecks(new Set(['docs']))
    helpers.runCheck('docs', 'node', ['-e', 'process.exit(1)'])
    const results = helpers.getResults()
    expect(results).toEqual([{ name: 'docs', status: 'SKIP', elapsed: 0 }])
    expect(helpers.getFailed()).toBe(0)
  })

  it('a check NOT in the skip set spawns and runs normally', async () => {
    const helpers = await import('../../scripts/lib/run-helpers.mjs?t=' + Date.now())
    helpers.resetState()
    helpers.setSkippedChecks(new Set(['docs']))
    helpers.runCheck('typecheck', 'node', ['-e', 'process.exit(0)'])
    const results = helpers.getResults()
    expect(results).toEqual([{ name: 'typecheck', status: 'PASS', elapsed: expect.any(Number) }])
  })

  it('empty skip set (default) never skips', async () => {
    const helpers = await import('../../scripts/lib/run-helpers.mjs?t=' + Date.now())
    helpers.resetState()
    helpers.runCheck('docs', 'node', ['-e', 'process.exit(0)'])
    expect(helpers.getResults()[0].status).toBe('PASS')
  })
})

describe('check-all.mjs ARBITER_SELECTIVE_GATE integration — real git diff', () => {
  it('is opt-in: unset ARBITER_SELECTIVE_GATE runs the full gate (smoke, via computeSkipped default path)', () => {
    // Guards the contract without spawning the real ~10min gate: absence of the
    // env var must never install a skip set. See scripts/check-all.mjs's isMain
    // block — the whole selective-gate branch is behind `ARBITER_SELECTIVE_GATE === '1'`.
    const source = readFileSync(
      resolve(import.meta.dirname, '../../scripts/check-all.mjs'),
      'utf-8',
    )
    expect(source).toMatch(/ARBITER_SELECTIVE_GATE === '1'/)
    expect(source).toMatch(/!_isCI/)
  })

  it('git diff --name-only against origin/main resolves in this checkout (sanity)', () => {
    // Not asserting on content (branch-dependent) — just that the exact command
    // check-all.mjs relies on doesn't throw in a normal checkout. Some CI job
    // checkouts (e.g. a PR merge-ref checkout without an explicit `origin/main`
    // fetch) legitimately have no merge base between HEAD and origin/main —
    // the same reason the real selective-gate path is gated behind `!_isCI`
    // (see the test above): this command is never actually invoked from CI.
    // Skip rather than fail when that precondition doesn't hold in this
    // checkout, instead of asserting an environment guarantee this file
    // doesn't control.
    let hasMergeBase = true
    try {
      execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], {
        encoding: 'utf-8',
        timeout: 6000,
      })
    } catch {
      hasMergeBase = false
    }
    if (!hasMergeBase) {
      return
    }
    expect(() =>
      execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
        encoding: 'utf-8',
        timeout: 6000,
      }),
    ).not.toThrow()
  })
})
