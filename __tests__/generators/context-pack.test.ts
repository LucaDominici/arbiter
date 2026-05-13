import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateContextPack, type ContextPackInput } from '../../src/context-pack/generator.js'
import { TRACK_INV_MAP, type Track } from '../../src/context-pack/track-mapping.js'
import { ReviewContextSchema, combinedVerdict } from '../../src/context-pack/review-context.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-ctx-pack-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ─── track mapping ────────────────────────────────────────────────────────────

describe('TRACK_INV_MAP', () => {
  it('defines all four tracks', () => {
    const tracks: Track[] = ['A', 'B', 'C', 'D']
    for (const t of tracks) {
      expect(TRACK_INV_MAP[t]).toBeDefined()
      expect(TRACK_INV_MAP[t].length).toBeGreaterThan(0)
    }
  })

  it('track A includes architectural invariants INV-01 and INV-04', () => {
    expect(TRACK_INV_MAP['A']).toContain('INV-01')
    expect(TRACK_INV_MAP['A']).toContain('INV-04')
  })

  it('track B includes governance invariants INV-21 and INV-26', () => {
    expect(TRACK_INV_MAP['B']).toContain('INV-21')
    expect(TRACK_INV_MAP['B']).toContain('INV-26')
  })

  it('track C includes data/security invariants INV-07 and INV-13', () => {
    expect(TRACK_INV_MAP['C']).toContain('INV-07')
    expect(TRACK_INV_MAP['C']).toContain('INV-13')
  })

  it('track D includes operational invariants INV-16 and INV-20', () => {
    expect(TRACK_INV_MAP['D']).toContain('INV-16')
    expect(TRACK_INV_MAP['D']).toContain('INV-20')
  })

  it('has no duplicate INV IDs within a track', () => {
    for (const [track, invs] of Object.entries(TRACK_INV_MAP)) {
      const unique = new Set(invs)
      expect(unique.size, `Track ${track} has duplicates`).toBe(invs.length)
    }
  })
})

// ─── ReviewContext schema ─────────────────────────────────────────────────────

describe('ReviewContextSchema', () => {
  it('parses a valid REVIEW_CONTEXT object', () => {
    const valid = {
      task_id: '#254',
      track: 'A',
      files: [{ path: 'src/foo.ts', observation: 'Adds new export', verdict: 'PASS' as const }],
      invariants_checked: ['INV-01', 'INV-04'],
      context_verdict: 'PASS' as const,
    }
    const result = ReviewContextSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('rejects missing task_id', () => {
    const invalid = {
      track: 'A',
      files: [],
      invariants_checked: [],
      context_verdict: 'PASS',
    }
    expect(ReviewContextSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects invalid track value', () => {
    const invalid = {
      task_id: '#1',
      track: 'Z',
      files: [],
      invariants_checked: [],
      context_verdict: 'PASS',
    }
    expect(ReviewContextSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects invalid context_verdict', () => {
    const invalid = {
      task_id: '#1',
      track: 'A',
      files: [],
      invariants_checked: [],
      context_verdict: 'MAYBE',
    }
    expect(ReviewContextSchema.safeParse(invalid).success).toBe(false)
  })
})

// ─── combined-verdict matrix ──────────────────────────────────────────────────

describe('combinedVerdict', () => {
  it('PASS + PASS → PASS', () => {
    expect(combinedVerdict('PASS', 'PASS')).toBe('PASS')
  })

  it('PASS + REJECT → REJECT', () => {
    expect(combinedVerdict('PASS', 'REJECT')).toBe('REJECT')
  })

  it('REJECT + PASS → REJECT', () => {
    expect(combinedVerdict('REJECT', 'PASS')).toBe('REJECT')
  })

  it('REJECT + REJECT → REJECT', () => {
    expect(combinedVerdict('REJECT', 'REJECT')).toBe('REJECT')
  })
})

// ─── generateContextPack ──────────────────────────────────────────────────────

function makeInput(overrides: Partial<ContextPackInput> = {}): ContextPackInput {
  return {
    taskId: '#254',
    track: 'A',
    files: ['src/context-pack/generator.ts', 'src/context-pack/track-mapping.ts'],
    adrMappings: [],
    ...overrides,
  }
}

describe('generateContextPack — happy path', () => {
  it('returns a non-empty string', () => {
    const output = generateContextPack(makeInput())
    expect(typeof output).toBe('string')
    expect(output.length).toBeGreaterThan(0)
  })

  it('contains @source: citations for each file', () => {
    const input = makeInput({ files: ['src/foo.ts', 'src/bar.ts'] })
    const output = generateContextPack(input)
    expect(output).toContain('@source: src/foo.ts')
    expect(output).toContain('@source: src/bar.ts')
  })

  it('contains the task ID in the output', () => {
    const output = generateContextPack(makeInput({ taskId: '#999' }))
    expect(output).toContain('#999')
  })

  it('lists the track', () => {
    const output = generateContextPack(makeInput({ track: 'B' }))
    expect(output).toContain('Track: B')
  })

  it('lists the default INV IDs for track A', () => {
    const output = generateContextPack(makeInput({ track: 'A' }))
    expect(output).toContain('INV-01')
    expect(output).toContain('INV-04')
  })

  it('lists the default INV IDs for track B', () => {
    const output = generateContextPack(makeInput({ track: 'B' }))
    expect(output).toContain('INV-21')
    expect(output).toContain('INV-26')
  })
})

describe('generateContextPack — determinism fixture', () => {
  it('two files with different tracks produce different CONTEXT_PACK content', () => {
    const inputA = makeInput({
      taskId: '#1',
      track: 'A',
      files: ['src/alpha.ts'],
    })
    const inputB = makeInput({
      taskId: '#1',
      track: 'B',
      files: ['src/alpha.ts'],
    })
    const outA = generateContextPack(inputA)
    const outB = generateContextPack(inputB)
    expect(outA).not.toBe(outB)
    // Track A should have INV-01, track B should have INV-21
    expect(outA).toContain('INV-01')
    expect(outA).not.toContain('INV-21')
    expect(outB).toContain('INV-21')
    expect(outB).not.toContain('INV-01')
  })

  it('same input always produces the same output (deterministic)', () => {
    const input = makeInput({
      files: ['src/x.ts', 'src/y.ts', 'src/a.ts'],
    })
    const out1 = generateContextPack(input)
    const out2 = generateContextPack(input)
    expect(out1).toBe(out2)
  })

  it('files are sorted in output regardless of input order', () => {
    const input1 = makeInput({ files: ['src/z.ts', 'src/a.ts', 'src/m.ts'] })
    const input2 = makeInput({ files: ['src/a.ts', 'src/m.ts', 'src/z.ts'] })
    expect(generateContextPack(input1)).toBe(generateContextPack(input2))
  })
})

describe('generateContextPack — ADR mappings', () => {
  it('includes ADR link when file matches a pattern', () => {
    const input = makeInput({
      files: ['src/api/handler.ts'],
      adrMappings: [{ pattern: 'src/api/**', adr: 'ADR-007' }],
    })
    const output = generateContextPack(input)
    expect(output).toContain('ADR-007')
  })

  it('does not include ADR link when no pattern matches', () => {
    const input = makeInput({
      files: ['src/utils/helper.ts'],
      adrMappings: [{ pattern: 'src/api/**', adr: 'ADR-007' }],
    })
    const output = generateContextPack(input)
    expect(output).not.toContain('ADR-007')
  })
})
