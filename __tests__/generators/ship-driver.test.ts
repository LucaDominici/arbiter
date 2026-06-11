// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateShipDriver, type ShipDriverOptions } from '../../src/generators/ship-driver.js'
import { makeConfig } from '../helpers.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ship-driver-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function gen(opts: ShipDriverOptions = {}) {
  return generateShipDriver(makeConfig(dir), opts)
}

describe('generateShipDriver — emission', () => {
  it('emits supervisor.sh and TICK_PROMPT.md under .arbiter/ship/', () => {
    const r = gen()
    const paths = r.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('.arbiter/ship/supervisor.sh'))).toBe(true)
    expect(paths.some((p) => p.endsWith('.arbiter/ship/TICK_PROMPT.md'))).toBe(true)
  })

  it('supervisor.sh is executable (0o755)', () => {
    gen()
    const mode = statSync(join(dir, '.arbiter/ship/supervisor.sh')).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  it('is idempotent — re-run skips pre-existing files (CANON-11 brownfield)', () => {
    gen()
    const p = join(dir, '.arbiter/ship/supervisor.sh')
    writeFileSync(p, '# user-edited\n', 'utf-8')
    const r2 = gen()
    expect(readFileSync(p, 'utf-8')).toBe('# user-edited\n')
    const sup = r2.files.find((f) => f.path.endsWith('supervisor.sh'))
    expect(sup?.action).toBe('skipped')
  })

  it('pre-existing .claude/commands/ship.md is untouched (brownfield)', () => {
    mkdirSync(join(dir, '.claude/commands'), { recursive: true })
    const shipMd = join(dir, '.claude/commands/ship.md')
    writeFileSync(shipMd, '# my custom ship\n', 'utf-8')
    gen()
    expect(readFileSync(shipMd, 'utf-8')).toBe('# my custom ship\n')
  })

  // RT1-H3 — injection guard
  it('rejects a shipLabel with shell metacharacters (fail-closed)', () => {
    expect(() => gen({ shipLabel: "ship'; rm -rf /" })).toThrow()
  })

  it('rejects a harnessCmd with shell metacharacters (fail-closed)', () => {
    expect(() => gen({ harnessCmd: 'claude; curl evil' })).toThrow()
  })
})

describe('generated supervisor.sh — executable semantics (CANON-07)', () => {
  function renderedSupervisor(): string {
    gen()
    return join(dir, '.arbiter/ship/supervisor.sh')
  }

  it('passes bash -n (syntax)', () => {
    const r = spawnSync('bash', ['-n', renderedSupervisor()], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
  })

  it('MAX_TICKS=0 exits 0 without running a tick', () => {
    const sup = renderedSupervisor()
    const r = spawnSync('bash', [sup, dir], {
      encoding: 'utf-8',
      env: { ...process.env, MAX_TICKS: '0' },
      timeout: 10_000,
    })
    expect(r.status).toBe(0)
  })

  it('missing repo-dir arg exits non-zero (usage)', () => {
    const sup = renderedSupervisor()
    const r = spawnSync('bash', [sup], { encoding: 'utf-8', timeout: 10_000 })
    expect(r.status).not.toBe(0)
  })

  // RB-03 + RT1-H1 — failing tick body AND failing gh never abort the loop
  it('a failing harness and a failing gh do not abort the loop', () => {
    const sup = renderedSupervisor()
    const stubDir = join(dir, 'stubs')
    mkdirSync(stubDir, { recursive: true })
    // harness stub exits 1; gh stub exits 1 — loop must complete both ticks and exit 0
    writeFileSync(join(stubDir, 'claude'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(stubDir, 'gh'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(stubDir, 'timeout'), '#!/usr/bin/env bash\nshift\n"$@"\n', { mode: 0o755 })
    const r = spawnSync('bash', [sup, dir], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        MAX_TICKS: '2',
        SHIP_TICK_SLEEP: '0',
      },
      timeout: 30_000,
    })
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).toContain('tick')
  })

  it('HALT marker stops the loop', () => {
    const sup = renderedSupervisor()
    const stubDir = join(dir, 'stubs2')
    mkdirSync(stubDir, { recursive: true })
    writeFileSync(join(stubDir, 'claude'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
    writeFileSync(join(stubDir, 'gh'), '#!/usr/bin/env bash\necho 5\n', { mode: 0o755 })
    writeFileSync(join(dir, '.arbiter/ship/HALT'), 'test halt', 'utf-8')
    const r = spawnSync('bash', [sup, dir], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        MAX_TICKS: '5',
        SHIP_TICK_SLEEP: '0',
      },
      timeout: 30_000,
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('HALT')
  })
})

describe('generated supervisor.sh — exit conditions', () => {
  function setupStubs(name: string, ghBody: string): string {
    const stubDir = join(dir, name)
    mkdirSync(stubDir, { recursive: true })
    writeFileSync(join(stubDir, 'claude'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
    writeFileSync(join(stubDir, 'gh'), `#!/usr/bin/env bash\n${ghBody}\n`, { mode: 0o755 })
    return stubDir
  }

  function runSupervisor(stubDir: string, maxTicks: string) {
    gen()
    return spawnSync('bash', [join(dir, '.arbiter/ship/supervisor.sh'), dir], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        MAX_TICKS: maxTicks,
        SHIP_TICK_SLEEP: '0',
      },
      timeout: 30_000,
    })
  }

  it('breaks with "Backlog drained" when gh reports zero open issues', () => {
    const stubDir = setupStubs('stubs-drained', 'echo 0')
    const r = runSupervisor(stubDir, '5')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Backlog drained')
    expect(r.stdout).not.toContain('tick 2/')
  })

  it('does not break the loop when gh returns a non-numeric count', () => {
    const stubDir = setupStubs('stubs-garbage', 'echo " 0 maybe"')
    const r = runSupervisor(stubDir, '2')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('backlog count unreadable')
    expect(r.stdout).toContain('tick 2/')
    expect(r.stdout).not.toContain('Backlog drained')
  })
})
