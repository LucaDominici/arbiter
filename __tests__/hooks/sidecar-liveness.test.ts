// #2588: pruneStaleSidecarEntries drops entries whose recorded pid is dead, not only
// entries older than SIDECAR_TTL_MS. Behavioural import of arbiter's own materialized
// hook library (the twins are held equal by the self-dogfood / kernel / examples parity gates).
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { pruneStaleSidecarEntries, SIDECAR_TTL_MS } from '../../.claude/hooks/lib.mjs'

/** A pid that existed and has been reaped — dead without depending on pid_max. */
function reapedPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''])
  return child.pid as number
}

function throwing(code: string): (pid: number, signal: number) => true {
  return () => {
    throw Object.assign(new Error(code), { code })
  }
}

describe('#2588 pruneStaleSidecarEntries pid liveness', () => {
  const now = Date.now()

  it('prunes a fresh entry whose pid is dead (AC-1)', () => {
    const entries = [{ agent: 'general-purpose', ts: now, pid: reapedPid(), cwd: '/x' }]
    expect(pruneStaleSidecarEntries(entries, now)).toEqual([])
  })

  it('prunes a fresh entry when the kill probe reports ESRCH (AC-1)', () => {
    const entries = [{ agent: 'general-purpose', ts: now, pid: 4242, cwd: '/x' }]
    expect(pruneStaleSidecarEntries(entries, now, throwing('ESRCH'))).toEqual([])
  })

  it('keeps a fresh entry whose pid is alive (AC-2)', () => {
    const entries = [{ agent: 'general-purpose', ts: now, pid: process.pid, cwd: '/x' }]
    expect(pruneStaleSidecarEntries(entries, now)).toEqual(entries)
  })

  it('keeps a fresh entry when the kill probe reports EPERM — alive, owned by another user (AC-2)', () => {
    const entries = [{ agent: 'general-purpose', ts: now, pid: 4242, cwd: '/x' }]
    expect(pruneStaleSidecarEntries(entries, now, throwing('EPERM'))).toEqual(entries)
  })

  it('still prunes a live-pid entry older than the TTL (AC-2)', () => {
    const entries = [{ agent: 'general-purpose', ts: now - SIDECAR_TTL_MS, pid: process.pid }]
    expect(pruneStaleSidecarEntries(entries, now)).toEqual([])
  })

  it('an entry without a pid follows the TTL only and never probes (AC-3)', () => {
    const probe = throwing('ESRCH')
    const fresh = { agent: 'general-purpose', ts: now - SIDECAR_TTL_MS + 1000, cwd: '/x' }
    const stale = { agent: 'general-purpose', ts: now - SIDECAR_TTL_MS, cwd: '/x' }
    expect(pruneStaleSidecarEntries([fresh, stale], now, probe)).toEqual([fresh])
  })

  it.each([0, -1, 1.5, '123', Number.NaN, null])(
    'a malformed pid (%s) is treated as no pid: age-only, never probed (AC-3)',
    (pid) => {
      const entries = [{ agent: 'general-purpose', ts: now, pid, cwd: '/x' }]
      expect(pruneStaleSidecarEntries(entries, now, throwing('ESRCH'))).toEqual(entries)
    },
  )
})
