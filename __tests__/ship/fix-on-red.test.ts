// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseFailureSignature,
  recordFailure,
  evaluateRed,
  loadAttempts,
  writeAttempts,
  attemptsPath,
  emptyAttempts,
  readBoundedLog,
  STRIKE_LIMIT,
  ShipAttemptsV1,
} from '../../src/ship/fix-on-red.js'

const NOW = '2026-06-11T00:00:00.000Z'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fix-on-red-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseFailureSignature — <check-name>:<error-class>', () => {
  it('builds a lowercase check:class signature for a named error', () => {
    const r = parseFailureSignature('unit-test', 'FAIL src/x.test.ts\nTypeError: cannot read foo\n')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.signature).toBe('unit-test:typeerror')
  })

  // DoD 1 / RT-07 — stable across line-number / path noise
  it('is stable across line-number and path noise', () => {
    const a = 'FAIL /repo/src/a.test.ts:12:3\nTypeError: boom at /repo/src/a.ts:99:1\n'
    const b = 'FAIL /other/src/a.test.ts:441:7\nTypeError: boom at /other/src/a.ts:3:5\n'
    const ra = parseFailureSignature('unit-test', a)
    const rb = parseFailureSignature('unit-test', b)
    expect(ra.ok && rb.ok && ra.signature === rb.signature).toBe(true)
  })

  // RT-02 — distinct error TYPES must not collapse to one signature
  it('distinguishes distinct error types in the same framework', () => {
    const t = parseFailureSignature('unit-test', 'FAIL src/x.test.ts\nTypeError: a\n')
    const r = parseFailureSignature('unit-test', 'FAIL src/x.test.ts\nReferenceError: b\n')
    expect(t.ok && r.ok && t.signature !== r.signature).toBe(true)
  })

  // RT-07 — multi-token / reordered logs collapse to one stable class
  it('is order-independent for a multi-token log', () => {
    const order1 = 'AssertionError: nope\n  caused by TypeError: x\n'
    const order2 = 'TypeError: x\nAssertionError: nope\n'
    const a = parseFailureSignature('unit-test', order1)
    const b = parseFailureSignature('unit-test', order2)
    expect(a.ok && b.ok && a.signature === b.signature).toBe(true)
  })

  // RT-04 — full volatile-token set masked in the shape fallback
  it('masks hex / timestamps / durations in the shape fallback', () => {
    const a = 'expected 0x1f3a to equal foo at 2026-06-11T00:00:00Z (1.2s)\n'
    const b = 'expected 0x9bcd to equal foo at 2020-01-02T03:04:05Z (88ms)\n'
    const ra = parseFailureSignature('jest', a)
    const rb = parseFailureSignature('jest', b)
    expect(ra.ok && rb.ok && ra.signature === rb.signature).toBe(true)
  })

  // RT-10 / RT-12 — check-name validated, never silently rewritten
  it('fail-closed on an invalid check-name (not slugged)', () => {
    expect(parseFailureSignature('Unit Test', 'TypeError: x').ok).toBe(false)
    expect(parseFailureSignature('a:b', 'TypeError: x').ok).toBe(false)
    expect(parseFailureSignature('', 'TypeError: x').ok).toBe(false)
  })

  // INV-96 — unparseable / unclassifiable log is uncertain, never guessed
  it('fail-closed when no error class can be derived', () => {
    expect(parseFailureSignature('unit-test', 'all good, nothing here\n').ok).toBe(false)
  })

  // RT-13 — a green log that merely contains "FAILED" is not classified as a fixable failure
  it('does not classify a green log line ending in FAILED', () => {
    expect(parseFailureSignature('unit-test', '0 tests FAILED, 10 passed\n').ok).toBe(false)
  })
})

describe('recordFailure — 2-strike policy', () => {
  it('first strike returns fix with the reproduce-before-push next-action (DoD)', () => {
    const r = recordFailure(emptyAttempts('#1289'), 'unit-test:typeerror', NOW)
    expect(r.decision.kind).toBe('fix')
    if (r.decision.kind === 'fix') {
      expect(r.decision.attempt).toBe(1)
      expect(r.decision.nextAction.toLowerCase()).toContain('reproduce')
      expect(r.decision.nextAction.toLowerCase()).toContain('push')
    }
  })

  // DoD — 2nd strike escalates
  it('second strike of the same signature escalates to needs-human', () => {
    const s1 = recordFailure(emptyAttempts('#1289'), 'unit-test:typeerror', NOW)
    const s2 = recordFailure(s1.state, 'unit-test:typeerror', NOW)
    expect(s2.decision.kind).toBe('escalate')
    if (s2.decision.kind === 'escalate') {
      expect(s2.decision.attempt).toBe(STRIKE_LIMIT)
      expect(s2.decision.nextAction.toLowerCase()).toContain('needs-human')
    }
  })

  // DoD — no 3rd retry possible
  it('never returns fix once at/over the strike limit', () => {
    let state = emptyAttempts('#1289')
    const kinds: string[] = []
    for (let i = 0; i < 5; i++) {
      const r = recordFailure(state, 'unit-test:typeerror', NOW)
      state = r.state
      kinds.push(r.decision.kind)
    }
    expect(kinds).toEqual(['fix', 'escalate', 'escalate', 'escalate', 'escalate'])
  })

  it('counter is monotonic and per-signature', () => {
    const a = recordFailure(emptyAttempts('#1289'), 'lint:no-unused-vars', NOW)
    const b = recordFailure(a.state, 'unit-test:typeerror', NOW)
    // different signature is still first strike
    expect(b.decision.kind).toBe('fix')
    expect(b.state.attempts.find((e) => e.signature === 'lint:no-unused-vars')?.count).toBe(1)
    expect(b.state.attempts.find((e) => e.signature === 'unit-test:typeerror')?.count).toBe(1)
  })
})

describe('attempts.json — schema + atomic IO (RT-06/09)', () => {
  it('round-trips through write → load', () => {
    const state = recordFailure(emptyAttempts('#1289'), 'unit-test:typeerror', NOW).state
    const p = writeAttempts('#1289', dir, state)
    expect(p).toBe(attemptsPath('#1289', dir))
    const loaded = loadAttempts('#1289', dir)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.data).toEqual(state)
  })

  it('absent file loads as empty state, not a failure', () => {
    const loaded = loadAttempts('#1289', dir)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.absent).toBe(true)
      expect(loaded.data.attempts).toEqual([])
    }
  })

  it('corrupt JSON loads as failure (escalate driver), never empty', () => {
    const p = attemptsPath('#1289', dir)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, '{ this is not json', 'utf-8')
    expect(loadAttempts('#1289', dir).ok).toBe(false)
  })

  it('per-task path means another task sees empty state, not contamination (RT-05)', () => {
    const state = recordFailure(emptyAttempts('#1289'), 'unit-test:typeerror', NOW).state
    writeAttempts('#1289', dir, state)
    const other = loadAttempts('#1290', dir)
    expect(other.ok).toBe(true)
    if (other.ok) {
      expect(other.absent).toBe(true)
      expect(other.data.attempts).toEqual([])
    }
  })

  it('a tampered file whose task_id ≠ requested loads as failure (RT-05)', () => {
    const p = attemptsPath('#1290', dir)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(
      p,
      JSON.stringify({ $schemaVersion: 1, task_id: '#1289', attempts: [], updated_at: NOW }),
      'utf-8',
    )
    expect(loadAttempts('#1290', dir).ok).toBe(false)
  })

  it('unknown $schemaVersion loads as failure (RT-09)', () => {
    const p = attemptsPath('#1289', dir)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(
      p,
      JSON.stringify({ $schemaVersion: 99, task_id: '#1289', attempts: [], updated_at: NOW }),
      'utf-8',
    )
    expect(loadAttempts('#1289', dir).ok).toBe(false)
  })

  it('schema rejects a bad task_id shape', () => {
    expect(
      ShipAttemptsV1.safeParse({
        $schemaVersion: 1,
        task_id: 'nope',
        attempts: [],
        updated_at: NOW,
      }).success,
    ).toBe(false)
  })
})

describe('evaluateRed — end-to-end driver decision', () => {
  it('first red emits fix + reproduce-before-push and persists the attempt', () => {
    const d = evaluateRed({
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'TypeError: x\n',
      repoDir: dir,
      now: NOW,
    })
    expect(d.kind).toBe('fix')
    expect(existsSync(attemptsPath('#1289', dir))).toBe(true)
  })

  it('same signature twice escalates (2-strike across persisted state)', () => {
    const opts = {
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'TypeError: x\n',
      repoDir: dir,
      now: NOW,
    }
    expect(evaluateRed(opts).kind).toBe('fix')
    expect(evaluateRed(opts).kind).toBe('escalate')
  })

  // RT-02 — a different real failure after a fix is still fix, not a false escalation
  it('a distinct error type after the first fix is still fix', () => {
    evaluateRed({
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'TypeError: x\n',
      repoDir: dir,
      now: NOW,
    })
    const d = evaluateRed({
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'ReferenceError: y\n',
      repoDir: dir,
      now: NOW,
    })
    expect(d.kind).toBe('fix')
  })

  // INV-96 — uncertain parse never fixes
  it('uncertain parse escalates-uncertain, never fix', () => {
    const d = evaluateRed({
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'nothing useful\n',
      repoDir: dir,
      now: NOW,
    })
    expect(d.kind).toBe('escalate-uncertain')
  })

  // RT-09 — corrupt persisted state escalates, never silently retries
  it('corrupt attempts.json escalates-uncertain (no silent retry)', () => {
    const p = attemptsPath('#1289', dir)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, 'garbage', 'utf-8')
    const d = evaluateRed({
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'TypeError: x\n',
      repoDir: dir,
      now: NOW,
    })
    expect(d.kind).toBe('escalate-uncertain')
  })

  // RT-01 — when the new count cannot be persisted, escalate (no silent 3rd retry)
  it('persist failure escalates-uncertain (RT-01)', () => {
    // make the per-task dir a FILE so mkdir/write fails
    const taskDir = join(p_dir(dir), '#1289')
    mkdirSync(join(dir, '.arbiter', 'ship'), { recursive: true })
    writeFileSync(taskDir, 'x', 'utf-8')
    const d = evaluateRed({
      taskId: '#1289',
      checkName: 'unit-test',
      log: 'TypeError: x\n',
      repoDir: dir,
      now: NOW,
    })
    expect(d.kind).toBe('escalate-uncertain')
  })
})

function p_dir(repoDir: string): string {
  return join(repoDir, '.arbiter', 'ship')
}

describe('readBoundedLog — RT-06b/11', () => {
  it('reads a normal log file', () => {
    const f = join(dir, 'red.log')
    writeFileSync(f, 'TypeError: x\n', 'utf-8')
    expect(readBoundedLog(f)).toContain('TypeError')
  })

  it('rejects a binary (NUL-byte) file', () => {
    const f = join(dir, 'bin.log')
    writeFileSync(f, Buffer.from([0x54, 0x00, 0x59]))
    expect(() => readBoundedLog(f)).toThrow()
  })

  it('keeps the tail of an oversize log within the byte budget', () => {
    const f = join(dir, 'big.log')
    const filler = 'x'.repeat(2 * 1024 * 1024)
    writeFileSync(f, filler + '\nTypeError: tail-wins\n', 'utf-8')
    const out = readBoundedLog(f, 64 * 1024)
    expect(out.length).toBeLessThanOrEqual(64 * 1024)
    expect(out).toContain('tail-wins')
  })
})
