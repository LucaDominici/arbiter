// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/m16-handoff-tools.test.ts
//
// #2103 — bg-run.sh / pid-watch.sh (CANON-07: the generated scripts are EXECUTED, not
// string-asserted). Proves the exact failure mode from the issue: a watcher on a PID that
// outlives the caller's session emits exactly one exit line.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

/** Render + materialize both generated scripts into a temp dir (what `arbiter update` emits). */
function materializeScripts(): { dir: string; bg: string; watch: string } {
  const dir = mkdtempSync(join(tmpdir(), 'm16-tools-'))
  const cfg = makeConfig(dir) as unknown as Record<string, unknown>
  for (const name of ['bg-run.sh', 'pid-watch.sh']) {
    const script = renderTemplate(`scripts/${name}.ejs`, cfg)
    const p = join(dir, name)
    writeFileSync(p, script, { mode: 0o755 })
    chmodSync(p, 0o755)
  }
  return { dir, bg: join(dir, 'bg-run.sh'), watch: join(dir, 'pid-watch.sh') }
}

describe('bg-run.sh / pid-watch.sh (#2103) — terminal handoff helpers', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  it('bg-run.sh launches DETACHED and records pid/exit/log files', () => {
    const { dir, bg } = materializeScripts()
    dirs.push(dir)
    const r = spawnSync('/usr/bin/bash', [bg, 'demo', '--', 'sh', '-c', 'sleep 1; exit 7'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    expect(r.status).toBe(0)
    const pidFile = join(dir, '.arbiter', 'bg', 'demo.pid')
    expect(existsSync(pidFile)).toBe(true)
    // Detached: the launcher returns BEFORE the job finishes (no exit file yet, pid alive).
    expect(existsSync(join(dir, '.arbiter', 'bg', 'demo.exit'))).toBe(false)
  })

  it('the exact failure mode: watcher on a PID that outlives the caller session → exactly one exit line', () => {
    const { dir, bg, watch } = materializeScripts()
    dirs.push(dir)
    // Worker (caller session 1) launches the gate detached and ends its turn.
    const launch = spawnSync('/usr/bin/bash', [bg, 'gate', '--', 'sh', '-c', 'sleep 1; exit 42'], {
      cwd: dir,
      encoding: 'utf-8',
    })
    expect(launch.status).toBe(0)
    // Coordinator (a SEPARATE process — the worker's session is gone) watches the exit file.
    const watchRun = spawnSync('/usr/bin/bash', [watch, 'gate'], { cwd: dir, encoding: 'utf-8' })
    expect(watchRun.status).toBe(0)
    const lines = (watchRun.stdout ?? '').trim().split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('42')
  })

  it('re-watching an already-exited job emits exactly one line again (idempotent)', () => {
    const { dir, bg, watch } = materializeScripts()
    dirs.push(dir)
    spawnSync('/usr/bin/bash', [bg, 'gate2', '--', 'sh', '-c', 'exit 3'], { cwd: dir, encoding: 'utf-8' })
    // Wait for the detached job to finish writing its exit file.
    const exitFile = join(dir, '.arbiter', 'bg', 'gate2.exit')
    for (let i = 0; i < 50 && !existsSync(exitFile); i++) {
      spawnSync('sleep', ['0.1'])
    }
    const w1 = spawnSync('/usr/bin/bash', [watch, 'gate2'], { cwd: dir, encoding: 'utf-8' })
    const w2 = spawnSync('/usr/bin/bash', [watch, 'gate2'], { cwd: dir, encoding: 'utf-8' })
    expect((w1.stdout ?? '').trim().split('\n').filter(Boolean)).toHaveLength(1)
    expect((w2.stdout ?? '').trim().split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('--self-test on both helpers exits 0', () => {
    const { dir, bg, watch } = materializeScripts()
    dirs.push(dir)
    const r1 = spawnSync('/usr/bin/bash', [bg, '--self-test'], { cwd: dir, encoding: 'utf-8' })
    expect(r1.status).toBe(0)
    const r2 = spawnSync('/usr/bin/bash', [watch, '--self-test'], { cwd: dir, encoding: 'utf-8' })
    expect(r2.status).toBe(0)
  })
})
