// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage tests for src/graph/blame.ts (#1486).
 *
 * Pure-function module — no I/O, no DI seam needed. Drives every branch in
 * classifyEvent / deriveCurrentStatus / buildTimeline and all four formatters.
 */
import { describe, it, expect } from 'vitest'
import {
  buildTimeline,
  formatText,
  formatJson,
  formatMermaid,
  formatMarkdownAudit,
  type BlameTimeline,
  type ComplianceMapping,
} from '../../src/graph/blame.js'
import type { HistoryEvent } from '../../src/graph/history.js'

function evt(over: Partial<HistoryEvent> & { sha: string; ts: string; subject: string }): HistoryEvent {
  return {
    filesChanged: [],
    ...over,
  }
}

const MAPPINGS: ComplianceMapping[] = [
  { standard: 'ISO27001', controlId: 'A.12.1' },
  { standard: 'SOC2', controlId: 'CC7.2' },
]

// ── classifyEvent (via buildTimeline) ──────────────────────────────────────

describe('classifyEvent branches via buildTimeline (#1486)', () => {
  it('first entry is always CREATED even when subject would match a keyword', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaa1111', ts: '2024-01-01T00:00:00+00:00', subject: 'enforce gate INV-01' }),
    ]
    const tl = buildTimeline('INV-01', 'first', events)
    expect(tl.entries[0]?.event).toBe('CREATED')
  })

  it('classifies ENFORCED when an enforce keyword appears in the subject', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'c0ffee0', ts: '2024-01-01T00:00:00+00:00', subject: 'create INV-02' }),
      evt({ sha: 'b10ck00', ts: '2024-01-02T00:00:00+00:00', subject: 'block bad commits' }),
    ]
    const tl = buildTimeline('INV-02', 't', events)
    expect(tl.entries.find((e) => e.sha === 'b10ck00')?.event).toBe('ENFORCED')
  })

  it('classifies ENFORCED when keyword appears only in the notaryIntent', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa0', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({
        sha: 'bbbbbb0',
        ts: '2024-01-02T00:00:00+00:00',
        subject: 'no signal subject here',
        notaryIntent: 'add a lint rule',
      }),
    ]
    const tl = buildTimeline('NODE-X', 't', events)
    expect(tl.entries.find((e) => e.sha === 'bbbbbb0')?.event).toBe('ENFORCED')
  })

  it('classifies MODIFIED on update/modify/fix when no enforce keyword present', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa1', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({ sha: 'm0d1f00', ts: '2024-01-02T00:00:00+00:00', subject: 'update something' }),
    ]
    const tl = buildTimeline('NODE-Y', 't', events)
    expect(tl.entries.find((e) => e.sha === 'm0d1f00')?.event).toBe('MODIFIED')
  })

  it('classifies MENTIONED when subject contains the nodeId and no other signal', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa2', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({ sha: 'ment100', ts: '2024-01-02T00:00:00+00:00', subject: 'see also REF-42 nearby' }),
    ]
    const tl = buildTimeline('REF-42', 't', events)
    expect(tl.entries.find((e) => e.sha === 'ment100')?.event).toBe('MENTIONED')
  })

  it('classifies MENTIONED when notaryIntent contains the nodeId (subject does not)', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa3', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({
        sha: 'mentn00',
        ts: '2024-01-02T00:00:00+00:00',
        subject: 'plain subject',
        notaryIntent: 'touched REF-99 in passing',
      }),
    ]
    const tl = buildTimeline('REF-99', 't', events)
    expect(tl.entries.find((e) => e.sha === 'mentn00')?.event).toBe('MENTIONED')
  })

  it('classifies UNKNOWN when nothing matches and notaryIntent is undefined', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa4', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({ sha: 'unkn000', ts: '2024-01-02T00:00:00+00:00', subject: 'totally unrelated text' }),
    ]
    const tl = buildTimeline('NODE-Z', 't', events)
    expect(tl.entries.find((e) => e.sha === 'unkn000')?.event).toBe('UNKNOWN')
  })

  it('UNKNOWN path also exercised when notaryIntent is present but matches nothing', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa5', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({
        sha: 'unkn100',
        ts: '2024-01-02T00:00:00+00:00',
        subject: 'unrelated text',
        notaryIntent: 'also unrelated intent',
      }),
    ]
    const tl = buildTimeline('NODE-W', 't', events)
    expect(tl.entries.find((e) => e.sha === 'unkn100')?.event).toBe('UNKNOWN')
  })
})

// ── buildTimeline detail / mappings branches ───────────────────────────────

describe('buildTimeline detail and mappings branches (#1486)', () => {
  it('detail uses notaryIntent when present', () => {
    const events: HistoryEvent[] = [
      evt({
        sha: 'abcdef1234',
        ts: '2024-03-01T09:00:00+00:00',
        subject: 'subject text',
        notaryIntent: 'the intent line',
      }),
    ]
    const tl = buildTimeline('N', 't', events)
    expect(tl.entries[0]?.detail).toBe('the intent line (commit abcdef1)')
  })

  it('detail falls back to subject when notaryIntent is undefined', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'fedcba9876', ts: '2024-03-01T09:00:00+00:00', subject: 'just the subject' }),
    ]
    const tl = buildTimeline('N', 't', events)
    expect(tl.entries[0]?.detail).toBe('just the subject (commit fedcba9)')
  })

  it('omits complianceMappings property when undefined', () => {
    const tl = buildTimeline('N', 't', [])
    expect(Object.prototype.hasOwnProperty.call(tl, 'complianceMappings')).toBe(false)
  })

  it('includes complianceMappings property when provided', () => {
    const tl = buildTimeline('N', 't', [], MAPPINGS)
    expect(tl.complianceMappings).toEqual(MAPPINGS)
  })

  it('sort comparator handles equal, less-than and greater-than ts pairs', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'sha0001', ts: '2024-05-10T08:00:00+00:00', subject: 'b later' }),
      evt({ sha: 'sha0002', ts: '2024-05-10T20:00:00+00:00', subject: 'same date dup' }),
      evt({ sha: 'sha0003', ts: '2024-01-01T08:00:00+00:00', subject: 'earliest' }),
    ]
    const tl = buildTimeline('N', 't', events)
    const dates = tl.entries.map((e) => e.ts)
    expect(dates[0]).toBe('2024-01-01')
    expect(dates[1]).toBe('2024-05-10')
    expect(dates[2]).toBe('2024-05-10')
  })
})

// ── deriveCurrentStatus branches ───────────────────────────────────────────

describe('deriveCurrentStatus branches via buildTimeline (#1486)', () => {
  it('returns UNKNOWN for empty timeline', () => {
    expect(buildTimeline('N', 't', []).currentStatus).toBe('UNKNOWN')
  })

  it('returns ENFORCED when any entry is ENFORCED', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa6', ts: '2024-01-01T00:00:00+00:00', subject: 'create' }),
      evt({ sha: 'g4te000', ts: '2024-01-02T00:00:00+00:00', subject: 'add a gate here' }),
    ]
    expect(buildTimeline('N', 't', events).currentStatus).toBe('ENFORCED')
  })

  it('returns ACTIVE when there is a CREATED entry but no ENFORCED', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'aaaaaa7', ts: '2024-01-01T00:00:00+00:00', subject: 'create node' }),
      evt({ sha: 'modddd0', ts: '2024-01-02T00:00:00+00:00', subject: 'fix a typo' }),
    ]
    expect(buildTimeline('N', 't', events).currentStatus).toBe('ACTIVE')
  })

  it('returns ACTIVE fallback when no entry is ENFORCED and the only entry is CREATED', () => {
    const events: HistoryEvent[] = [
      evt({ sha: 'soloooo', ts: '2024-01-01T00:00:00+00:00', subject: 'create only' }),
    ]
    expect(buildTimeline('N', 't', events).currentStatus).toBe('ACTIVE')
  })
})

// ── formatText branches ────────────────────────────────────────────────────

describe('formatText branches (#1486)', () => {
  function tl(over: Partial<BlameTimeline>): BlameTimeline {
    return {
      nodeId: 'N',
      nodeTitle: 'title',
      entries: [],
      currentStatus: 'UNKNOWN',
      ...over,
    }
  }

  it('renders the empty-timeline placeholder when there are no entries', () => {
    const text = formatText(tl({}))
    expect(text).toContain('(no git history found for this node)')
  })

  it('renders timeline rows with padded event names when entries exist', () => {
    const text = formatText(
      tl({
        currentStatus: 'ENFORCED',
        entries: [{ ts: '2024-01-01', event: 'CREATED', detail: 'd', sha: 'sha0001' }],
      }),
    )
    expect(text).toContain('CREATED   ') // padEnd(10) leaves trailing spaces
    expect(text).toContain('Status: ENFORCED')
  })

  it('renders a Compliance section when mappings are present and non-empty', () => {
    const text = formatText(tl({ complianceMappings: MAPPINGS }))
    expect(text).toContain('Compliance:')
    expect(text).toContain('ISO27001: A.12.1')
  })

  it('omits Compliance section when mappings present but empty', () => {
    const text = formatText(tl({ complianceMappings: [] }))
    expect(text).not.toContain('Compliance:')
  })

  it('omits Compliance section when mappings undefined', () => {
    const text = formatText(tl({}))
    expect(text).not.toContain('Compliance:')
  })
})

// ── formatJson ─────────────────────────────────────────────────────────────

describe('formatJson (#1486)', () => {
  it('round-trips to a parseable object', () => {
    const source: BlameTimeline = {
      nodeId: 'N',
      nodeTitle: 'title',
      entries: [{ ts: '2024-01-01', event: 'CREATED', detail: 'd', sha: 'sha0001' }],
      currentStatus: 'ACTIVE',
    }
    const parsed = JSON.parse(formatJson(source)) as BlameTimeline
    expect(parsed.nodeId).toBe('N')
    expect(parsed.entries.length).toBe(1)
  })
})

// ── formatMermaid branches ─────────────────────────────────────────────────

describe('formatMermaid branches (#1486)', () => {
  it('emits the no-history section when there are no entries', () => {
    const mermaid = formatMermaid({
      nodeId: 'N',
      nodeTitle: 'title',
      entries: [],
      currentStatus: 'UNKNOWN',
    })
    expect(mermaid).toContain('section History')
    expect(mermaid).toContain('No git history found')
  })

  it('groups entries by year (new-year and existing-year branches) and sanitises detail', () => {
    const mermaid = formatMermaid({
      nodeId: 'N',
      nodeTitle: 'title',
      currentStatus: 'ACTIVE',
      entries: [
        { ts: '2024-01-01', event: 'CREATED', detail: 'first:entry', sha: 'sha0001' },
        { ts: '2024-06-01', event: 'MODIFIED', detail: 'second:entry same year', sha: 'sha0002' },
        { ts: '2025-02-01', event: 'ENFORCED', detail: 'third in a new year', sha: 'sha0003' },
      ],
    })
    expect(mermaid).toContain('section 2024')
    expect(mermaid).toContain('section 2025')
    // colon replaced with dash
    expect(mermaid).toContain('first-entry')
    expect(mermaid).not.toContain('first:entry')
  })

  it('truncates long details to 60 chars', () => {
    const longDetail = 'x'.repeat(120)
    const mermaid = formatMermaid({
      nodeId: 'N',
      nodeTitle: 'title',
      currentStatus: 'ACTIVE',
      entries: [{ ts: '2024-01-01', event: 'CREATED', detail: longDetail, sha: 'sha0001' }],
    })
    expect(mermaid).toContain('x'.repeat(60))
    expect(mermaid).not.toContain('x'.repeat(61))
  })
})

// ── formatMarkdownAudit branches ───────────────────────────────────────────

describe('formatMarkdownAudit branches (#1486)', () => {
  it('emits the no-history italic line when there are no entries', () => {
    const md = formatMarkdownAudit({
      nodeId: 'N',
      nodeTitle: 'title',
      entries: [],
      currentStatus: 'UNKNOWN',
    })
    expect(md).toContain('_No git history found for this node._')
  })

  it('renders a table and escapes pipe characters in detail', () => {
    const md = formatMarkdownAudit({
      nodeId: 'N',
      nodeTitle: 'title',
      currentStatus: 'ACTIVE',
      entries: [{ ts: '2024-01-01', event: 'CREATED', detail: 'has | pipe', sha: 'sha0001' }],
    })
    expect(md).toContain('| Date | Event | Detail | SHA |')
    expect(md).toContain('has \\| pipe')
  })

  it('renders a Compliance Mappings table when mappings present and non-empty', () => {
    const md = formatMarkdownAudit({
      nodeId: 'N',
      nodeTitle: 'title',
      currentStatus: 'ACTIVE',
      entries: [],
      complianceMappings: MAPPINGS,
    })
    expect(md).toContain('## Compliance Mappings')
    expect(md).toContain('| ISO27001 | A.12.1 |')
  })

  it('omits Compliance Mappings table when mappings empty', () => {
    const md = formatMarkdownAudit({
      nodeId: 'N',
      nodeTitle: 'title',
      currentStatus: 'ACTIVE',
      entries: [],
      complianceMappings: [],
    })
    expect(md).not.toContain('## Compliance Mappings')
  })

  it('omits Compliance Mappings table when mappings undefined', () => {
    const md = formatMarkdownAudit({
      nodeId: 'N',
      nodeTitle: 'title',
      currentStatus: 'ACTIVE',
      entries: [],
    })
    expect(md).not.toContain('## Compliance Mappings')
  })
})
