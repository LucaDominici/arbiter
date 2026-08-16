// SPDX-License-Identifier: Apache-2.0
// __tests__/scripts/lib/waiter-count.test.ts
//
// #2098: shared fd-count helper — the SAME implementation is consumed by
// scripts/capacity-probe.mjs (direct import) and by gate-exec.ts's queue-depth
// advisory (subprocess invocation via the isMain CLI guard below — gate-exec.ts
// ships compiled into dist/ without scripts/, so it cannot statically import
// this file; both consumers still run the one canonical implementation).
//
// Real `fuser` + real `flock` holder processes (no mocking) — same style as
// __tests__/commands/gate-exec.test.ts (runGateExec real-flock tests).
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countLockWaiters } from '../../../scripts/lib/waiter-count.mjs'
import {
  spawnLockHolder,
  killLockHolder,
  isAlive,
  pollUntil,
  OBSERVE_BUDGET_MS,
} from '../../helpers/lock-holder.js'

describe('countLockWaiters (#2098)', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('returns 0 for a lock file nobody holds', () => {
    dir = mkdtempSync(join(tmpdir(), 'waiter-count-'))
    const lockPath = join(dir, 'gate.lock')
    // File exists but is never opened by anyone.
    spawnSync('touch', [lockPath])
    expect(countLockWaiters(lockPath)).toBe(0)
  })

  it('returns 0 for a lock path that does not exist at all', () => {
    dir = mkdtempSync(join(tmpdir(), 'waiter-count-'))
    expect(countLockWaiters(join(dir, 'never-created.lock'))).toBe(0)
  })

  it('returns > 0 while a real flock holder has the file open', async () => {
    dir = mkdtempSync(join(tmpdir(), 'waiter-count-'))
    const lockPath = join(dir, 'gate.lock')
    spawnSync('touch', [lockPath])
    // Background holder: `flock -o -- <lock> sleep <HOLDER_SECONDS>` — the exact argv
    // shape gate-exec.ts's gateExecArgv() composes. The shared fixture gives the holder
    // a lifetime well beyond the observation budget (#2282); the old inline `sleep 2`
    // matched the 2000 ms budget exactly and went red whenever the runner was loaded.
    const holder = spawnLockHolder(lockPath)
    try {
      const count = await pollUntil(
        () => countLockWaiters(lockPath),
        (c) => c > 0,
        OBSERVE_BUDGET_MS,
      )
      expect(count).toBeGreaterThan(0)
      // The margin is the point: the holder must still be running when the budget is
      // spent, otherwise a count of 0 would be ambiguous between "not observed yet" and
      // "already gone".
      expect(isAlive(holder)).toBe(true)
    } finally {
      killLockHolder(holder)
    }
  })
})

describe('waiter-count.mjs CLI (isMain guard, #2098)', () => {
  it('prints the count for a given lock path and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'waiter-count-cli-'))
    try {
      const lockPath = join(dir, 'gate.lock')
      spawnSync('touch', [lockPath])
      const r = spawnSync('node', ['scripts/lib/waiter-count.mjs', lockPath], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      expect(r.stdout.trim()).toBe('0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 with a usage message when no lock path is given', () => {
    const r = spawnSync('node', ['scripts/lib/waiter-count.mjs'], { encoding: 'utf-8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('usage')
  })
})
