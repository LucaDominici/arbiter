import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { describe, it, expect, afterEach } from 'vitest'
import { buildEvidenceNodes } from '../../src/graph/builders/evidence.js'
import { GraphStore } from '../../src/graph/store.js'

/** Produce a valid SUMMARY.json that passes SHA verification. */
function makeSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    head_sha: 'aabbccdd1122334455667788',
    head_sha_short: 'aabbccdd',
    obs_gate: 'PASS',
    tests: {},
    coverage: {},
    mutation: {},
    security: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  }
  // Compute SHA over the body (excluding sha field itself) — matches verifySummarySha
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base)) {
    if (k !== 'sha') body[k] = v
  }
  const shaValue = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  return { ...body, sha: shaValue }
}

describe('buildEvidenceNodes (#259-followup)', () => {
  const created: string[] = []
  afterEach(() => {
    while (created.length > 0) {
      const d = created.pop()
      if (d !== undefined) rmSync(d, { recursive: true, force: true })
    }
  })

  it('emits EVIDENCE node from .evidence/SUMMARY.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-builder-'))
    created.push(dir)
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir)
    writeFileSync(join(evidenceDir, 'SUMMARY.json'), JSON.stringify(makeSummary()), 'utf-8')

    const store = buildEvidenceNodes(new GraphStore(), {}, dir)
    const evidenceNodes = store.nodesByKind('EVIDENCE')
    expect(evidenceNodes.length).toBe(1)
    expect(evidenceNodes[0]?.attrs['head_sha_short']).toBe('aabbccdd')
  })

  it('emits GATE --produces--> EVIDENCE edge', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-edge-'))
    created.push(dir)
    const evidenceDir = join(dir, '.evidence')
    mkdirSync(evidenceDir)
    writeFileSync(join(evidenceDir, 'SUMMARY.json'), JSON.stringify(makeSummary()), 'utf-8')

    const store = buildEvidenceNodes(new GraphStore(), {}, dir)
    const gateNodes = store.nodesByKind('GATE')
    expect(gateNodes.length).toBe(1)
    const edges = store.outgoing(gateNodes[0]!.id, 'produces')
    expect(edges.length).toBe(1)
    expect(edges[0]?.to).toMatch(/^EVIDENCE:/)
  })

  it('degrades gracefully when SUMMARY.json is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-missing-'))
    created.push(dir)
    const store = buildEvidenceNodes(new GraphStore(), {}, dir)
    expect(store.nodesByKind('EVIDENCE')).toHaveLength(0)
  })

  it('uses summaryPath override for tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-override-'))
    created.push(dir)
    const customPath = join(dir, 'custom-summary.json')
    writeFileSync(customPath, JSON.stringify(makeSummary({ head_sha_short: 'deadbeef' })), 'utf-8')

    const store = buildEvidenceNodes(new GraphStore(), { summaryPath: customPath }, dir)
    const evidenceNodes = store.nodesByKind('EVIDENCE')
    expect(evidenceNodes[0]?.attrs['head_sha_short']).toBe('deadbeef')
  })
})
