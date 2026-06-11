// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runShipFixOnRed, formatDecisionLines } from '../../src/commands/ship-fix-on-red.js'
import type { Decision } from '../../src/ship/fix-on-red.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ship-on-red-cmd-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function redLog(body: string): string {
  const f = join(dir, 'red.log')
  writeFileSync(f, body, 'utf-8')
  return f
}

describe('runShipFixOnRed', () => {
  it('first red → fix decision with the reproduce-before-push action', () => {
    const r = runShipFixOnRed({
      check: 'unit-test',
      logFile: redLog('TypeError: x\n'),
      id: '#1289',
      dir,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.decision.kind).toBe('fix')
      expect(r.lines.join('\n')).toContain('Decision: fix')
      expect(r.lines.join('\n').toLowerCase()).toContain('reproduce')
    }
  })

  it('same signature twice → escalate (2-strike, persisted across calls)', () => {
    const log = redLog('TypeError: x\n')
    expect(runShipFixOnRed({ check: 'unit-test', logFile: log, id: '#1289', dir }).ok).toBe(true)
    const r2 = runShipFixOnRed({ check: 'unit-test', logFile: log, id: '#1289', dir })
    expect(r2.ok && r2.decision.kind === 'escalate').toBe(true)
  })

  it('uncertain parse → escalate-uncertain, exit-0 (a valid decision, not an error)', () => {
    const r = runShipFixOnRed({
      check: 'unit-test',
      logFile: redLog('nothing useful\n'),
      id: '#1289',
      dir,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.decision.kind).toBe('escalate-uncertain')
  })

  it('missing --log-file → usage failure (exit 1)', () => {
    const r = runShipFixOnRed({
      check: 'unit-test',
      logFile: join(dir, 'nope.log'),
      id: '#1289',
      dir,
    })
    expect(r.ok).toBe(false)
  })

  it('no task id and no active task → usage failure', () => {
    const r = runShipFixOnRed({ check: 'unit-test', logFile: redLog('TypeError: x\n'), dir })
    expect(r.ok).toBe(false)
  })

  it('accepts a bare numeric id and normalizes it', () => {
    const r = runShipFixOnRed({
      check: 'unit-test',
      logFile: redLog('TypeError: x\n'),
      id: '1289',
      dir,
    })
    expect(r.ok).toBe(true)
  })
})

describe('formatDecisionLines — null-safe (RT-03)', () => {
  it('prints unknown for absent signature/attempt on escalate-uncertain', () => {
    const d: Decision = { kind: 'escalate-uncertain', reason: 'no class', nextAction: 'STOP.' }
    const out = formatDecisionLines(d).join('\n')
    expect(out).toContain('Signature: unknown')
    expect(out).toContain('Attempt: unknown')
    expect(out).toContain('Reason: no class')
  })
})
