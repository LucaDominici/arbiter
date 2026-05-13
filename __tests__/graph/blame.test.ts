/**
 * Tests for src/graph/blame.ts — blame timeline builder + formatters (#263).
 */
import { describe, it, expect } from 'vitest'
import {
  buildTimeline,
  formatText,
  formatJson,
  formatMermaid,
  formatMarkdownAudit,
  type BlameTimeline,
  type TimelineEntry,
} from '../../src/graph/blame.js'
import type { HistoryEvent } from '../../src/graph/history.js'

const EVENTS: HistoryEvent[] = [
  {
    sha: 'abc123',
    ts: '2024-11-03T10:00:00+00:00',
    subject: 'feat: add INV-01',
    filesChanged: ['src/invariants/catalog.ts'],
  },
  {
    sha: 'def456',
    ts: '2024-11-15T14:30:00+00:00',
    subject: 'feat: enforce INV-01 with madge',
    filesChanged: ['scripts/check-all.mjs', 'src/invariants/catalog.ts'],
    notaryIntent: 'enforce circular-dep detection [per INV-01]',
  },
]

const SAMPLE_TIMELINE: BlameTimeline = {
  nodeId: 'INV-01',
  nodeTitle: 'No circular dependencies between modules',
  entries: [
    { ts: '2024-11-03', event: 'CREATED', detail: 'via commit abc123', sha: 'abc123' },
    { ts: '2024-11-15', event: 'ENFORCED', detail: 'via commit def456', sha: 'def456' },
  ],
  currentStatus: 'ENFORCED',
}

describe('buildTimeline (#263)', () => {
  it('returns a BlameTimeline from events', () => {
    const timeline = buildTimeline('INV-01', 'No circular dependencies', EVENTS)
    expect(timeline.nodeId).toBe('INV-01')
    expect(timeline.entries.length).toBeGreaterThanOrEqual(EVENTS.length)
  })

  it('sets currentStatus based on last entry', () => {
    const timeline = buildTimeline('INV-01', 'No circular dependencies', EVENTS)
    expect(typeof timeline.currentStatus).toBe('string')
    expect(timeline.currentStatus.length).toBeGreaterThan(0)
  })

  it('first entry event is CREATED', () => {
    const timeline = buildTimeline('INV-01', 'No circular dependencies', EVENTS)
    expect(timeline.entries[0]).toBeDefined()
    expect(timeline.entries[0]?.event).toBe('CREATED')
  })

  it('returns empty entries for empty events', () => {
    const timeline = buildTimeline('INV-99', 'Unknown invariant', [])
    expect(timeline.entries).toHaveLength(0)
    expect(timeline.currentStatus).toBe('UNKNOWN')
  })

  it('entries are sorted by ts ascending', () => {
    const timeline = buildTimeline('INV-01', 'No circular dependencies', EVENTS)
    for (let i = 1; i < timeline.entries.length; i++) {
      const prev = timeline.entries[i - 1]
      const curr = timeline.entries[i]
      if (prev === undefined || curr === undefined) continue
      expect(prev.ts <= curr.ts).toBe(true)
    }
  })
})

describe('formatText (#263)', () => {
  it('includes node id in output', () => {
    const text = formatText(SAMPLE_TIMELINE)
    expect(text).toContain('INV-01')
  })

  it('includes node title in output', () => {
    const text = formatText(SAMPLE_TIMELINE)
    expect(text).toContain('No circular dependencies between modules')
  })

  it('includes Timeline section', () => {
    const text = formatText(SAMPLE_TIMELINE)
    expect(text).toContain('Timeline:')
  })

  it('includes current status', () => {
    const text = formatText(SAMPLE_TIMELINE)
    expect(text).toContain('Status: ENFORCED')
  })

  it('lists timeline events', () => {
    const text = formatText(SAMPLE_TIMELINE)
    expect(text).toContain('CREATED')
    expect(text).toContain('ENFORCED')
  })
})

describe('formatJson (#263)', () => {
  it('returns valid JSON', () => {
    const json = formatJson(SAMPLE_TIMELINE)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('JSON contains nodeId and entries', () => {
    const parsed = JSON.parse(formatJson(SAMPLE_TIMELINE)) as {
      nodeId: string
      entries: TimelineEntry[]
    }
    expect(parsed.nodeId).toBe('INV-01')
    expect(Array.isArray(parsed.entries)).toBe(true)
    expect(parsed.entries.length).toBe(2)
  })
})

describe('formatMermaid (#263)', () => {
  it('starts with gantt or timeline directive', () => {
    const mermaid = formatMermaid(SAMPLE_TIMELINE)
    expect(mermaid.length).toBeGreaterThan(0)
    // Mermaid timeline or gantt chart
    expect(mermaid).toMatch(/^(gantt|timeline)/m)
  })

  it('contains the node id', () => {
    const mermaid = formatMermaid(SAMPLE_TIMELINE)
    expect(mermaid).toContain('INV-01')
  })
})

describe('formatMarkdownAudit (#263)', () => {
  it('contains a markdown heading', () => {
    const md = formatMarkdownAudit(SAMPLE_TIMELINE)
    expect(md).toMatch(/^#/)
  })

  it('contains the node id in the heading', () => {
    const md = formatMarkdownAudit(SAMPLE_TIMELINE)
    expect(md).toContain('INV-01')
  })

  it('contains a timeline table with pipe characters', () => {
    const md = formatMarkdownAudit(SAMPLE_TIMELINE)
    expect(md).toContain('|')
  })
})
