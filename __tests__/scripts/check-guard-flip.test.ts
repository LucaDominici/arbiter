// SPDX-License-Identifier: Apache-2.0
// A6 guard-flip self-test (#1497): a guard that always passes (vacuous) is itself a fake-green.
// The guard-flip harness proves every anti-fake-green guard DISCRIMINATES — it rejects a planted
// BAD fixture (exit 1) and accepts a CLEAN one (exit 0) — and fails CI when a roster guard has no
// such proof. This test exercises (a) the live harness on the real roster (must be green), (b)
// completeness of the registry over the GUARDS SSOT, and (c) the harness's own discrimination:
// a synthetic VACUOUS guard (always exit 0) must be reported, a synthetic discriminating guard
// must not.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { flipGuard } from '../../scripts/check-guard-flip.mjs'
import { GUARDS } from '../../scripts/lib/anti-fake-green-guards.mjs'
import { FLIP_REGISTRY } from '../../scripts/lib/guard-flip-registry.mjs'

const HARNESS = resolve('scripts/check-guard-flip.mjs')

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'guard-flip-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-guard-flip — live harness on the real roster', () => {
  it('every anti-fake-green guard discriminates → exit 0', () => {
    const r = spawnSync('node', [HARNESS], { encoding: 'utf-8' })
    expect(r.stdout).toMatch(/proven=\d+ vacuous=0 uncovered=0/)
    expect(r.status).toBe(0)
  })

  it('--help exits 0', () => {
    const r = spawnSync('node', [HARNESS, '--help'], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })
})

describe('check-guard-flip — completeness over the GUARDS SSOT', () => {
  it('every guard in the roster has a flip-proof registered (no vacuous gap)', () => {
    const missing = GUARDS.filter((g) => !FLIP_REGISTRY[g.name]).map((g) => g.name)
    expect(missing).toEqual([])
  })
})

describe('check-guard-flip — the harness itself discriminates', () => {
  // A file-scan "guard" that ALWAYS exits 0 — the vacuous fake-green the harness must catch.
  const VACUOUS = 'process.exit(0)\n'
  // A real guard: exits 1 when a sentinel file is present (bad), 0 otherwise (clean).
  const REAL =
    "import { existsSync } from 'node:fs'\n" +
    "import { resolve } from 'node:path'\n" +
    "const i = process.argv.indexOf('--dir')\n" +
    'const dir = i >= 0 ? process.argv[i + 1] : process.cwd()\n' +
    "process.exit(existsSync(resolve(dir, 'BAD')) ? 1 : 0)\n"

  const entry = {
    kind: 'file-scan' as const,
    inject: 'dir' as const,
    plantBad: (d: string) => writeFileSync(join(d, 'BAD'), 'x'),
    plantClean: () => {},
  }

  it('flags a vacuous (always-exit-0) guard as VACUOUS', () => {
    withTmp((dir) => {
      const script = join(dir, 'vacuous.mjs')
      writeFileSync(script, VACUOUS)
      const failures = flipGuard({ name: 'vacuous', script }, entry)
      expect(failures.length).toBeGreaterThan(0)
      expect(failures.join(' ')).toMatch(/accepted a planted BAD fixture/)
    })
  })

  it('passes a guard that genuinely discriminates', () => {
    withTmp((dir) => {
      const script = join(dir, 'real.mjs')
      writeFileSync(script, REAL)
      const failures = flipGuard({ name: 'real', script }, entry)
      expect(failures).toEqual([])
    })
  })

  it('flags an over-eager guard that rejects even a clean fixture', () => {
    withTmp((dir) => {
      // A guard that ALWAYS exits 1 — it "detects" everything, including the clean fixture.
      const script = join(dir, 'overeager.mjs')
      writeFileSync(script, 'process.exit(1)\n')
      const failures = flipGuard({ name: 'overeager', script }, entry)
      expect(failures.join(' ')).toMatch(/rejected a CLEAN fixture/)
    })
  })
})
