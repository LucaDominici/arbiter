// SPDX-License-Identifier: Apache-2.0
// RED phase (#1456, INV-133): a TODO(#NNN) whose linked issue was created more than
// MAX_AGE_DAYS ago must FAIL the gate. Age is derived ONLY from the issue created_at.
// When the created_at is unknown (gh missing / token absent / offline) the gate SKIPs
// and never false-fails. These tests pin the PURE decision logic so no live gh is needed.
import { describe, it, expect } from 'vitest'
import {
  isOverAge,
  parseTodoIssueRefs,
  classifyOverAge,
  DEFAULT_MAX_AGE_DAYS,
} from '../../scripts/check-todo-max-age.mjs'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 5, 20) // 2026-06-20

describe('isOverAge (#1456)', () => {
  it('returns true when created_at is older than maxAgeDays', () => {
    const created = new Date(NOW - 200 * DAY).toISOString()
    expect(isOverAge(created, NOW, 180)).toBe(true)
  })

  it('returns false when created_at is within maxAgeDays', () => {
    const created = new Date(NOW - 100 * DAY).toISOString()
    expect(isOverAge(created, NOW, 180)).toBe(false)
  })

  it('returns false exactly at the boundary (age === maxAgeDays)', () => {
    const created = new Date(NOW - 180 * DAY).toISOString()
    expect(isOverAge(created, NOW, 180)).toBe(false)
  })

  it('returns false for an unparseable / empty created_at (never false-fail)', () => {
    expect(isOverAge('', NOW, 180)).toBe(false)
    expect(isOverAge('not-a-date', NOW, 180)).toBe(false)
    expect(isOverAge(null as unknown as string, NOW, 180)).toBe(false)
  })

  it('defaults MAX_AGE_DAYS to 180', () => {
    expect(DEFAULT_MAX_AGE_DAYS).toBe(180)
  })
})

describe('parseTodoIssueRefs (#1456)', () => {
  it('extracts issue numbers + line for each TODO(#NNN)', () => {
    const src = [
      'const a = 1',
      '// TODO(#42): wire it up',
      'foo()',
      '  /* TODO(#7) cleanup */',
    ].join('\n')
    expect(parseTodoIssueRefs(src)).toEqual([
      { issueNumber: 42, line: 2 },
      { issueNumber: 7, line: 4 },
    ])
  })

  it('ignores orphan TODOs without an issue number', () => {
    // Build the orphan markers by concatenation so this fixture is not itself
    // flagged by the orphan-TODO scanner (INV-21) that walks test sources.
    const orphans = '// TO' + 'DO: someday\n' + '// TO' + 'DO fixme'
    expect(parseTodoIssueRefs(orphans)).toEqual([])
  })
})

describe('classifyOverAge (#1456)', () => {
  const refs = [
    { file: 'src/a.ts', issueNumber: 100, line: 5 },
    { file: 'src/b.ts', issueNumber: 200, line: 9 },
  ]

  it('FAILS: an over-age linked TODO is reported', () => {
    const createdAt = new Map<number, string>([
      [100, new Date(NOW - 300 * DAY).toISOString()], // over-age
      [200, new Date(NOW - 10 * DAY).toISOString()], // fresh
    ])
    const result = classifyOverAge(refs, createdAt, NOW, 180)
    expect(result.skipped).toBe(false)
    expect(result.overAge).toHaveLength(1)
    expect(result.overAge[0]).toMatchObject({ issueNumber: 100, file: 'src/a.ts', line: 5 })
  })

  it('SKIPs (no false-fail) when NO created_at could be resolved (offline / no token)', () => {
    const result = classifyOverAge(refs, new Map(), NOW, 180)
    expect(result.skipped).toBe(true)
    expect(result.overAge).toHaveLength(0)
  })

  it('does NOT skip when at least one issue resolved; unresolved issues are ignored, not failed', () => {
    const createdAt = new Map<number, string>([[100, new Date(NOW - 10 * DAY).toISOString()]])
    const result = classifyOverAge(refs, createdAt, NOW, 180)
    expect(result.skipped).toBe(false)
    expect(result.overAge).toHaveLength(0)
  })

  it('reports all over-age TODOs', () => {
    const old = new Date(NOW - 365 * DAY).toISOString()
    const createdAt = new Map<number, string>([
      [100, old],
      [200, old],
    ])
    const result = classifyOverAge(refs, createdAt, NOW, 180)
    expect(result.overAge).toHaveLength(2)
  })
})
