/**
 * Tests for src/graph/history.ts — temporal event harvester (#263).
 */
import { describe, it, expect } from 'vitest'
import {
  parseHistoryEvents,
  filterEventsForNode,
  type HistoryEvent,
  type GitLogEntry,
} from '../../src/graph/history.js'

const SAMPLE_LOG_ENTRIES: GitLogEntry[] = [
  {
    sha: 'abc123',
    ts: '2024-11-03T10:00:00+00:00',
    subject: 'feat(#001): add INV-05 cyclomatic complexity invariant',
    body: '',
  },
  {
    sha: 'def456',
    ts: '2024-11-15T14:30:00+00:00',
    subject: 'feat(#002): enforce INV-05 with ESLint rule',
    body: 'Notary:\n- Delta: src/invariants/catalog.ts §Complexity (modify, +5 -0)\n- Intent: adds INV-05 enforcement [per INV-05]\n- Patch: src/invariants/catalog.ts (update)',
  },
  {
    sha: 'ghi789',
    ts: '2024-12-01T09:00:00+00:00',
    subject: 'chore: update dependencies',
    body: '',
  },
]

describe('parseHistoryEvents (#263)', () => {
  it('returns an array of HistoryEvent from git log entries', () => {
    const events = parseHistoryEvents(SAMPLE_LOG_ENTRIES)
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBe(SAMPLE_LOG_ENTRIES.length)
  })

  it('maps each entry to a HistoryEvent with required fields', () => {
    const events = parseHistoryEvents(SAMPLE_LOG_ENTRIES)
    const first = events[0]
    expect(first).toBeDefined()
    if (first === undefined) throw new Error()
    expect(first.sha).toBe('abc123')
    expect(first.ts).toBe('2024-11-03T10:00:00+00:00')
    expect(typeof first.subject).toBe('string')
  })

  it('extracts notary intent when present', () => {
    const events = parseHistoryEvents(SAMPLE_LOG_ENTRIES)
    const second = events[1]
    expect(second).toBeDefined()
    if (second === undefined) throw new Error()
    expect(second.notaryIntent).toBe('adds INV-05 enforcement [per INV-05]')
  })

  it('leaves notaryIntent undefined when no Notary block', () => {
    const events = parseHistoryEvents(SAMPLE_LOG_ENTRIES)
    const first = events[0]
    expect(first).toBeDefined()
    if (first === undefined) throw new Error()
    expect(first.notaryIntent).toBeUndefined()
  })

  it('returns events sorted by ts ascending', () => {
    const reversed: GitLogEntry[] = [...SAMPLE_LOG_ENTRIES].reverse()
    const events = parseHistoryEvents(reversed)
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]
      const curr = events[i]
      if (prev === undefined || curr === undefined) continue
      expect(prev.ts <= curr.ts).toBe(true)
    }
  })
})

describe('filterEventsForNode (#263)', () => {
  const events: HistoryEvent[] = [
    {
      sha: 'abc123',
      ts: '2024-11-03T10:00:00+00:00',
      subject: 'feat: add INV-05',
      filesChanged: ['src/invariants/catalog.ts'],
    },
    {
      sha: 'def456',
      ts: '2024-11-15T14:30:00+00:00',
      subject: 'feat: enforce INV-05',
      filesChanged: ['src/invariants/catalog.ts', 'scripts/check-all.mjs'],
      notaryIntent: 'adds INV-05 enforcement [per INV-05]',
    },
    {
      sha: 'ghi789',
      ts: '2024-12-01T09:00:00+00:00',
      subject: 'chore: update deps',
      filesChanged: ['package.json'],
    },
  ]

  it('returns events that reference the node id in subject or intent', () => {
    const filtered = filterEventsForNode(events, 'INV-05')
    expect(filtered.length).toBe(2)
    expect(filtered.map((e) => e.sha)).toContain('abc123')
    expect(filtered.map((e) => e.sha)).toContain('def456')
  })

  it('excludes events with no mention of the node id', () => {
    const filtered = filterEventsForNode(events, 'INV-05')
    expect(filtered.map((e) => e.sha)).not.toContain('ghi789')
  })

  it('returns all events when nodeId matches a FILE: prefix path', () => {
    // FILE: nodes match by filesChanged
    const filtered = filterEventsForNode(events, 'FILE:src/invariants/catalog.ts')
    expect(filtered.length).toBe(2)
  })

  it('returns empty array when no matches', () => {
    const filtered = filterEventsForNode(events, 'INV-99')
    expect(filtered).toHaveLength(0)
  })
})
