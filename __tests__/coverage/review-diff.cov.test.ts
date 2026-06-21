// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/commands/review-diff.ts (#1486).
 *
 * The module is a pure snapshot-diff engine with no I/O seam — the test
 * surface is constructing `GraphSnapshot` fixtures and asserting the diff
 * result + markdown render. This suite targets the branches the existing
 * __tests__/commands/review-diff.test.ts leaves uncovered:
 *   - direction boundary: removed.length === added.length → strengthened
 *   - risk_delta: 'decreased' (only strengthened), 'unchanged' (no changes)
 *   - diffProvers: base has no provers → skipped; provers retained → no flag
 *   - summary line assembly: provers-only / adr-only / combined / empty
 *   - renderMarkdown: PASS + BLOCK icons, weakened/strengthened labels,
 *     added-only / removed-only / both edge lists, every section, empty path
 */

import { describe, it, expect } from 'vitest'
import { runReviewDiff, renderMarkdown } from '../../src/commands/review-diff.js'
import type { GraphSnapshot, GraphNode, GraphEdge } from '../../src/graph/model.js'

// ── fixture builders (typed, no partials) ───────────────────────────────────

function node(id: string, kind: GraphNode['kind']): GraphNode {
  return { id, kind, attrs: {} }
}

function edge(from: string, to: string, kind: GraphEdge['kind']): GraphEdge {
  return { from, to, kind, attrs: {} }
}

function snap(nodes: GraphNode[], edges: GraphEdge[]): GraphSnapshot {
  return { nodes, edges }
}

// A base graph with one INV, two gates enforcing it, a prover test, an ADR
// and a file implementing the ADR.
const BASE: GraphSnapshot = snap(
  [
    node('INV-04', 'INV'),
    node('GATE:a', 'GATE'),
    node('GATE:b', 'GATE'),
    node('TEST:t1', 'TEST'),
    node('ADR:040', 'ADR'),
    node('FILE:src/x.ts', 'FILE'),
  ],
  [
    edge('INV-04', 'GATE:a', 'enforces'),
    edge('INV-04', 'GATE:b', 'enforces'),
    edge('TEST:t1', 'INV-04', 'proves'),
    edge('FILE:src/x.ts', 'ADR:040', 'implements'),
  ],
)

describe('runReviewDiff — diff direction & risk delta branches', () => {
  it('treats equal added/removed counts as strengthened (boundary removed === added)', () => {
    // base enforces {a, b}; head enforces {a, c} → 1 removed (b), 1 added (c).
    const head = snap(
      [
        node('INV-04', 'INV'),
        node('GATE:a', 'GATE'),
        node('GATE:c', 'GATE'),
        node('TEST:t1', 'TEST'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('INV-04', 'GATE:a', 'enforces'),
        edge('INV-04', 'GATE:c', 'enforces'),
        edge('TEST:t1', 'INV-04', 'proves'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const result = runReviewDiff({ base: BASE, head })
    const change = result.changes.enforcement_changes.find((c) => c.inv === 'INV-04')
    expect(change).toBeDefined()
    expect(change?.direction).toBe('strengthened')
    expect(change?.added).toEqual(['GATE:c'])
    expect(change?.removed).toEqual(['GATE:b'])
    // strengthened only, no weakening, no lost provers → risk decreased, PASS.
    expect(result.recommendation).toBe('PASS')
    expect(result.risk_delta).toBe('decreased')
  })

  it('reports risk_delta unchanged + PASS when snapshots are identical', () => {
    const result = runReviewDiff({ base: BASE, head: BASE })
    expect(result.recommendation).toBe('PASS')
    expect(result.risk_delta).toBe('unchanged')
    expect(result.changes.enforcement_changes).toEqual([])
    expect(result.changes.removed_provers).toEqual([])
    expect(result.changes.adr_supersessions).toEqual([])
    expect(result.summary).toBe('[PASS] No semantic changes detected.')
  })

  it('reports risk_delta increased + BLOCK when enforcement weakened', () => {
    // head drops both gates → 2 removed, 0 added → weakened.
    const head = snap(
      [
        node('INV-04', 'INV'),
        node('TEST:t1', 'TEST'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('TEST:t1', 'INV-04', 'proves'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const result = runReviewDiff({ base: BASE, head })
    const change = result.changes.enforcement_changes.find((c) => c.inv === 'INV-04')
    expect(change?.direction).toBe('weakened')
    expect(change?.added).toEqual([])
    expect(change?.removed.sort()).toEqual(['GATE:a', 'GATE:b'])
    expect(result.recommendation).toBe('BLOCK')
    expect(result.risk_delta).toBe('increased')
  })

  it('reports risk_delta increased via lost provers even with no enforcement change', () => {
    // head keeps gates but removes the only prover test.
    const head = snap(
      [
        node('INV-04', 'INV'),
        node('GATE:a', 'GATE'),
        node('GATE:b', 'GATE'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('INV-04', 'GATE:a', 'enforces'),
        edge('INV-04', 'GATE:b', 'enforces'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const result = runReviewDiff({ base: BASE, head })
    expect(result.changes.enforcement_changes).toEqual([])
    expect(result.changes.removed_provers).toEqual(['INV-04'])
    expect(result.recommendation).toBe('BLOCK')
    expect(result.risk_delta).toBe('increased')
  })

  it('skips an INV with no provers in base and one whose provers are retained', () => {
    // INV-NOPROVER has zero provers in base (continue branch).
    // INV-04 keeps its prover (headProvers.length !== 0 → no flag).
    const base = snap(
      [node('INV-04', 'INV'), node('INV-NOPROVER', 'INV'), node('TEST:t1', 'TEST')],
      [edge('TEST:t1', 'INV-04', 'proves')],
    )
    const head = snap(
      [node('INV-04', 'INV'), node('INV-NOPROVER', 'INV'), node('TEST:t1', 'TEST')],
      [edge('TEST:t1', 'INV-04', 'proves')],
    )
    const result = runReviewDiff({ base, head })
    expect(result.changes.removed_provers).toEqual([])
    expect(result.recommendation).toBe('PASS')
    expect(result.risk_delta).toBe('unchanged')
  })

  it('skips ADRs with no implementors in base (diffAdrSupersessions continue)', () => {
    const base = snap([node('ADR:099', 'ADR')], [])
    const head = snap([node('ADR:099', 'ADR')], [])
    const result = runReviewDiff({ base, head })
    expect(result.changes.adr_supersessions).toEqual([])
  })
})

describe('runReviewDiff — summary line assembly branches', () => {
  it('builds a provers-only summary when only provers are lost', () => {
    const base = snap(
      [node('INV-09', 'INV'), node('TEST:p', 'TEST')],
      [edge('TEST:p', 'INV-09', 'proves')],
    )
    const head = snap([node('INV-09', 'INV')], [])
    const result = runReviewDiff({ base, head })
    expect(result.summary).toBe('[BLOCK] Removed last provers: INV-09')
  })

  it('builds an adr-only summary when only ADR implementors are removed', () => {
    const base = snap(
      [node('ADR:055', 'ADR'), node('FILE:src/y.ts', 'FILE')],
      [edge('FILE:src/y.ts', 'ADR:055', 'implements')],
    )
    const head = snap([node('ADR:055', 'ADR')], [])
    const result = runReviewDiff({ base, head })
    // ADR supersession alone does not block — leads summary with that line.
    expect(result.recommendation).toBe('PASS')
    expect(result.summary).toBe('[PASS] ADR supersessions: ADR:055')
    expect(result.changes.adr_supersessions).toEqual([
      { adr: 'ADR:055', removedImplementors: ['FILE:src/y.ts'] },
    ])
  })

  it('leads summary with enforcement line when all change kinds are present', () => {
    // weakened enforcement + lost prover + ADR supersession together.
    const base = snap(
      [
        node('INV-04', 'INV'),
        node('GATE:a', 'GATE'),
        node('TEST:t1', 'TEST'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('INV-04', 'GATE:a', 'enforces'),
        edge('TEST:t1', 'INV-04', 'proves'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const head = snap([node('INV-04', 'INV'), node('ADR:040', 'ADR')], [])
    const result = runReviewDiff({ base, head })
    expect(result.recommendation).toBe('BLOCK')
    expect(result.risk_delta).toBe('increased')
    expect(result.summary.startsWith('[BLOCK] Enforcement changes: 1')).toBe(true)
    expect(result.changes.enforcement_changes).toHaveLength(1)
    expect(result.changes.removed_provers).toEqual(['INV-04'])
    expect(result.changes.adr_supersessions).toHaveLength(1)
  })
})

describe('renderMarkdown — render branches', () => {
  it('renders the empty "no semantic changes" markdown with PASS icon', () => {
    const result = runReviewDiff({ base: BASE, head: BASE })
    const md = renderMarkdown(result)
    expect(md).toContain('## Semantic Review: PASS')
    expect(md).toContain('**Risk delta:** unchanged')
    expect(md).toContain('**Recommendation:** PASS')
    expect(md).toContain('No semantic changes detected.')
    expect(md).not.toContain('### Enforcement Changes')
    expect(md).not.toContain('### Removed Provers')
    expect(md).not.toContain('### Implicit ADR Supersessions')
  })

  it('renders strengthened enforcement with an added-only edge list', () => {
    const head = snap(
      [
        node('INV-04', 'INV'),
        node('GATE:a', 'GATE'),
        node('GATE:b', 'GATE'),
        node('GATE:d', 'GATE'),
        node('TEST:t1', 'TEST'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('INV-04', 'GATE:a', 'enforces'),
        edge('INV-04', 'GATE:b', 'enforces'),
        edge('INV-04', 'GATE:d', 'enforces'),
        edge('TEST:t1', 'INV-04', 'proves'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const result = runReviewDiff({ base: BASE, head })
    const md = renderMarkdown(result)
    expect(md).toContain('## Semantic Review: PASS')
    expect(md).toContain('### Enforcement Changes')
    expect(md).toContain('- **INV-04**: strengthened')
    expect(md).toContain('  - Added: GATE:d')
    // no removed edges in this case → no "Removed:" line for the change.
    expect(md).not.toContain('  - Removed:')
  })

  it('renders weakened enforcement with a removed-only edge list and BLOCK icon', () => {
    const head = snap(
      [
        node('INV-04', 'INV'),
        node('GATE:a', 'GATE'),
        node('TEST:t1', 'TEST'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('INV-04', 'GATE:a', 'enforces'),
        edge('TEST:t1', 'INV-04', 'proves'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const result = runReviewDiff({ base: BASE, head })
    const md = renderMarkdown(result)
    expect(md).toContain('## Semantic Review: BLOCK')
    expect(md).toContain('- **INV-04**: WEAKENED')
    expect(md).toContain('  - Removed: GATE:b')
    expect(md).not.toContain('  - Added:')
  })

  it('renders both added and removed edge lists for a swap change', () => {
    const head = snap(
      [
        node('INV-04', 'INV'),
        node('GATE:a', 'GATE'),
        node('GATE:c', 'GATE'),
        node('TEST:t1', 'TEST'),
        node('ADR:040', 'ADR'),
        node('FILE:src/x.ts', 'FILE'),
      ],
      [
        edge('INV-04', 'GATE:a', 'enforces'),
        edge('INV-04', 'GATE:c', 'enforces'),
        edge('TEST:t1', 'INV-04', 'proves'),
        edge('FILE:src/x.ts', 'ADR:040', 'implements'),
      ],
    )
    const result = runReviewDiff({ base: BASE, head })
    const md = renderMarkdown(result)
    expect(md).toContain('  - Added: GATE:c')
    expect(md).toContain('  - Removed: GATE:b')
  })

  it('renders the Removed Provers section', () => {
    const base = snap(
      [node('INV-09', 'INV'), node('TEST:p', 'TEST')],
      [edge('TEST:p', 'INV-09', 'proves')],
    )
    const head = snap([node('INV-09', 'INV')], [])
    const result = runReviewDiff({ base, head })
    const md = renderMarkdown(result)
    expect(md).toContain('### Removed Provers (BLOCK)')
    expect(md).toContain('- **INV-09**: last test prover removed')
  })

  it('renders the Implicit ADR Supersessions section', () => {
    const base = snap(
      [node('ADR:055', 'ADR'), node('FILE:src/y.ts', 'FILE')],
      [edge('FILE:src/y.ts', 'ADR:055', 'implements')],
    )
    const head = snap([node('ADR:055', 'ADR')], [])
    const result = runReviewDiff({ base, head })
    const md = renderMarkdown(result)
    expect(md).toContain('### Implicit ADR Supersessions')
    expect(md).toContain('- **ADR:055**: implementors removed: FILE:src/y.ts')
  })
})
