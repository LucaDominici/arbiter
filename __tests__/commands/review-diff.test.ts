/**
 * `arbiter review diff` command tests (#262).
 *
 * Covers:
 *   AC-1  compares two graph snapshots
 *   AC-2  detects enforcement strengthened/weakened per INV
 *   AC-3  detects removed test provers (last prover for INV)
 *   AC-4  detects implicit ADR supersession (removed code under ADR)
 *   AC-5  --json structured output
 */

import { describe, it, expect } from 'vitest'
import { runReviewDiff } from '../../src/commands/review-diff.js'
import type { GraphSnapshot } from '../../src/graph/model.js'

// ── snapshot fixtures ────────────────────────────────────────────────────────

const BASE_SNAP: GraphSnapshot = {
  nodes: [
    { id: 'INV-04', kind: 'INV', attrs: { title: 'No any' } },
    { id: 'GATE:eslint-no-any', kind: 'GATE', attrs: { mechanism: 'eslint-no-any' } },
    { id: 'TEST:no-any-test', kind: 'TEST', attrs: { title: 'no-any-test' } },
    { id: 'ADR:ADR-040', kind: 'ADR', attrs: { title: 'Use TypeScript strict' } },
    { id: 'FILE:src/types.ts', kind: 'FILE', attrs: { path: 'src/types.ts' } },
  ],
  edges: [
    { from: 'INV-04', to: 'GATE:eslint-no-any', kind: 'enforces', attrs: {} },
    { from: 'TEST:no-any-test', to: 'INV-04', kind: 'proves', attrs: {} },
    { from: 'ADR:ADR-040', to: 'INV-04', kind: 'decides', attrs: {} },
    { from: 'FILE:src/types.ts', to: 'ADR:ADR-040', kind: 'implements', attrs: {} },
  ],
}

describe('review diff (#262)', () => {
  it('returns no changes when snapshots are identical', () => {
    const result = runReviewDiff({ base: BASE_SNAP, head: BASE_SNAP })
    expect(result.status).toBe('ok')
    expect(result.recommendation).toBe('PASS')
    expect(result.changes.enforcement_changes).toEqual([])
    expect(result.changes.removed_provers).toEqual([])
    expect(result.changes.adr_supersessions).toEqual([])
  })

  it('detects enforcement weakened (gate removed from INV)', () => {
    const headSnap: GraphSnapshot = {
      nodes: BASE_SNAP.nodes.filter((n) => n.id !== 'GATE:eslint-no-any'),
      edges: BASE_SNAP.edges.filter((e) => e.to !== 'GATE:eslint-no-any'),
    }
    const result = runReviewDiff({ base: BASE_SNAP, head: headSnap })
    expect(result.status).toBe('ok')
    expect(result.recommendation).toBe('BLOCK')
    const weakened = result.changes.enforcement_changes.find(
      (c) => c.inv === 'INV-04' && c.direction === 'weakened',
    )
    expect(weakened).toBeDefined()
  })

  it('detects enforcement strengthened (new gate added)', () => {
    const headSnap: GraphSnapshot = {
      nodes: [
        ...BASE_SNAP.nodes,
        { id: 'GATE:no-any-extra', kind: 'GATE', attrs: { mechanism: 'no-any-extra' } },
      ],
      edges: [
        ...BASE_SNAP.edges,
        { from: 'INV-04', to: 'GATE:no-any-extra', kind: 'enforces', attrs: {} },
      ],
    }
    const result = runReviewDiff({ base: BASE_SNAP, head: headSnap })
    expect(result.recommendation).toBe('PASS')
    const strengthened = result.changes.enforcement_changes.find(
      (c) => c.inv === 'INV-04' && c.direction === 'strengthened',
    )
    expect(strengthened).toBeDefined()
  })

  it('detects last prover removed (BLOCK)', () => {
    const headSnap: GraphSnapshot = {
      nodes: BASE_SNAP.nodes.filter((n) => n.id !== 'TEST:no-any-test'),
      edges: BASE_SNAP.edges.filter((e) => e.from !== 'TEST:no-any-test'),
    }
    const result = runReviewDiff({ base: BASE_SNAP, head: headSnap })
    expect(result.recommendation).toBe('BLOCK')
    expect(result.changes.removed_provers).toContain('INV-04')
  })

  it('detects ADR supersession (file implementing ADR removed)', () => {
    const headSnap: GraphSnapshot = {
      nodes: BASE_SNAP.nodes.filter((n) => n.id !== 'FILE:src/types.ts'),
      edges: BASE_SNAP.edges.filter((e) => e.from !== 'FILE:src/types.ts'),
    }
    const result = runReviewDiff({ base: BASE_SNAP, head: headSnap })
    expect(result.changes.adr_supersessions.length).toBeGreaterThan(0)
    const sup = result.changes.adr_supersessions[0]!
    expect(sup.adr).toBe('ADR:ADR-040')
  })

  it('--json returns structured output', () => {
    const result = runReviewDiff({ base: BASE_SNAP, head: BASE_SNAP })
    const json = JSON.parse(JSON.stringify(result))
    expect(json).toHaveProperty('status')
    expect(json).toHaveProperty('recommendation')
    expect(json).toHaveProperty('changes')
    expect(json).toHaveProperty('risk_delta')
  })
})
