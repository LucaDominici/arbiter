// SPDX-License-Identifier: Apache-2.0
// A4 (#1497) test-scope ↔ tier integrity guard. A test category declared `required`
// in test-pyramid.json that NO gate (a check-all step or a workflow) executes is a
// silent false-green — "we run contract tests" with no CI tier that ever does. The
// flip-test proves the guard BLOCKS the planted defect and PASSES when clean/deferred.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

function guardExit(dir: string): number {
  const r = spawnSync('node', [resolve('scripts', 'check-test-scope-tier.mjs'), '--dir', dir], {
    encoding: 'utf-8',
  })
  return r.status ?? 1
}
function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'a4-scope-tier-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
function manifest(dir: string, levels: unknown[]): void {
  writeFileSync(
    join(dir, 'test-pyramid.json'),
    JSON.stringify({ archetype: 'backend-web-db', levels }, null, 2),
  )
}
function gate(dir: string, body: string): void {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'check-all.mjs'), body)
}

const UNIT = { id: 'L1', name: 'L1 Unit', globs: ['__tests__/**/*.test.ts'], status: 'required' }
// Performance lives outside the default test roots and no broad suite runs it — the
// canonical "declared category, no tier" defect.
const PERF = { id: 'L5', name: 'L5 Performance', globs: ['perf/**/*.perf.ts'], status: 'required' }
const CONTRACT = {
  id: 'L4',
  name: 'L4 Contract',
  globs: ['contract/**/*.contract.ts'],
  status: 'required',
}

describe('check-test-scope-tier (A4 #1497)', () => {
  it('liveness: a required category no gate runs BLOCKS (exit 1)', () => {
    withTmp((dir) => {
      manifest(dir, [UNIT, PERF])
      gate(dir, "runCheck('unit tests', 'npm', ['run', 'test:unit'])\n")
      expect(guardExit(dir)).toBe(1)
    })
  })

  it('a required category wired into a gate step PASSES (exit 0)', () => {
    withTmp((dir) => {
      manifest(dir, [UNIT, PERF])
      gate(
        dir,
        "runCheck('unit tests','npm',['run','test:unit'])\n" +
          "runCheck('perf','npm',['run','test:perf'])\n",
      )
      expect(guardExit(dir)).toBe(0)
    })
  })

  it('a required `contract` level is NOT wired by the always-present exit-code-contract ref → FAIL (#1499)', () => {
    withTmp((dir) => {
      manifest(dir, [UNIT, CONTRACT])
      // The only "contract" on the gate surface is the unrelated exit-code-contract checker — no
      // actual contract test runs. The bare-word `\bcontract\b` signal used to match this falsely.
      gate(
        dir,
        "runCheck('unit tests','npm',['run','test:unit'])\n" +
          "runCheck('exit-code contract (INV-53)','node',['scripts/check-exit-code-contract.mjs'])\n",
      )
      expect(guardExit(dir)).toBe(1)
    })
  })

  it('a required `contract` level wired via a real contract-test command PASSES (exit 0)', () => {
    withTmp((dir) => {
      manifest(dir, [UNIT, CONTRACT])
      gate(
        dir,
        "runCheck('unit tests','npm',['run','test:unit'])\n" +
          "runCheck('contract tests','npm',['run','test:contract'])\n",
      )
      expect(guardExit(dir)).toBe(0)
    })
  })

  it('a category marked deferred (n/a) PASSES (exit 0)', () => {
    withTmp((dir) => {
      manifest(dir, [
        UNIT,
        { ...PERF, status: 'n/a', rationale: 'deferred until a load environment exists in CI' },
      ])
      gate(dir, "runCheck('unit tests','npm',['run','test:unit'])\n")
      expect(guardExit(dir)).toBe(0)
    })
  })

  it('a required category covered by a broad suite over a default root PASSES (exit 0)', () => {
    withTmp((dir) => {
      manifest(dir, [
        {
          id: 'L2',
          name: 'L2 Property-Based',
          globs: ['__tests__/property/**/*.property.test.ts'],
          status: 'required',
        },
      ])
      gate(dir, "runCheck('unit tests', 'npm', ['test'])\n")
      expect(guardExit(dir)).toBe(0)
    })
  })

  it('a required category wired only via a workflow PASSES (exit 0)', () => {
    withTmp((dir) => {
      manifest(dir, [UNIT, PERF])
      gate(dir, "runCheck('unit tests','npm',['run','test:unit'])\n")
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', '06-nightly.yml'),
        'name: nightly\non: [schedule]\njobs:\n  perf:\n    steps:\n      - run: npm run test:perf\n',
      )
      expect(guardExit(dir)).toBe(0)
    })
  })

  it('no manifest → NO-DATA SKIP at exit 0', () => {
    withTmp((dir) => {
      gate(dir, "runCheck('unit tests','npm',['test'])\n")
      expect(guardExit(dir)).toBe(0)
    })
  })
})
