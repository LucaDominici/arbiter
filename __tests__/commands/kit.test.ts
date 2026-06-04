// SPDX-License-Identifier: Apache-2.0
// Smoke tests for kit CLI commands.
// Tests call command functions directly to avoid full CLI spawn overhead.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runKitList, runKitShow, runKitExplain } from '../../src/commands/kit.js'
import { toCsv } from '../../src/kit/csv.js'
import type { DerivedKit } from '../../src/kit/schema.js'

function makeDim(overrides: Partial<DerivedKit[number]> = {}): DerivedKit[number] {
  return {
    id: 'N01',
    name: 'Test',
    tml: 'L1',
    gate: 'BLOCKING',
    categoryRef: 'test',
    archetypeGating: { applies: [], excludes: [] },
    status: 'covered',
    perStack: {
      java: { kind: 'tool', tool: 'junit5', matrixCategory: 'test' },
      typescript: { kind: 'tool', tool: 'vitest', matrixCategory: 'test' },
      python: { kind: 'tool', tool: 'pytest', matrixCategory: 'test' },
      go: { kind: 'tool', tool: 'go test', matrixCategory: 'test' },
      rust: { kind: 'tool', tool: 'cargo test', matrixCategory: 'test' },
    },
    ...overrides,
  }
}

describe('toCsv — RFC 4180 quoting', () => {
  it('wraps values containing comma in double quotes', () => {
    const dim = makeDim({ name: 'foo,bar' })
    const csv = toCsv([dim])
    expect(csv).toContain('"foo,bar"')
  })

  it('escapes double quotes by doubling them', () => {
    const dim = makeDim({ name: 'say "hello"' })
    const csv = toCsv([dim])
    expect(csv).toContain('"say ""hello"""')
  })

  it('wraps values containing \\r in double quotes', () => {
    const dim = makeDim({ note: 'line\rbreak' })
    const csv = toCsv([dim])
    expect(csv).toContain('"line\rbreak"')
  })

  it('produces header + N data rows with \\r\\n line endings', () => {
    const dims = [makeDim({ id: 'N01' }), makeDim({ id: 'N02' })]
    const csv = toCsv(dims)
    const lines = csv.split('\r\n').filter(Boolean)
    expect(lines.length).toBe(3) // header + 2 rows
    expect(lines[0]).toMatch(/^id,/)
  })
})

describe('kit CLI', () => {
  let stdout: string
  let mockWrite: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdout = ''
    mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })
  })

  afterEach(() => {
    mockWrite.mockRestore()
  })

  it('kit list --format=table outputs 78 rows', () => {
    runKitList({ format: 'table' })
    const lines = stdout.split('\n').filter((l) => l.startsWith('N'))
    expect(lines.length).toBe(78)
  })

  it('kit list --format=json outputs valid JSON array with 78 elements', () => {
    runKitList({ format: 'json' })
    const parsed = JSON.parse(stdout)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(78)
    // Each element has required fields
    for (const dim of parsed) {
      expect(dim.id).toBeDefined()
      expect(dim.tml).toMatch(/^L[123]$/)
      expect(dim.perStack).toBeDefined()
    }
  })

  it('kit list --format=csv has header + 78 data rows', () => {
    runKitList({ format: 'csv' })
    // CSV uses \r\n as line ending per RFC 4180
    const lines = stdout.split('\r\n').filter(Boolean)
    expect(lines.length).toBe(79) // header + 78 rows
    expect(lines[0]).toContain('id')
    expect(lines[0]).toContain('name')
    expect(lines[0]).toContain('tml')
  })

  it('kit list --filter=gaps filters to dims with gaps', () => {
    runKitList({ format: 'json', filter: 'gaps' })
    const parsed = JSON.parse(stdout)
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed.length).toBeLessThan(77)
  })

  it('kit list --stack=java excludes dims where java has gap coverage', () => {
    runKitList({ format: 'json', stack: 'java' })
    const parsed: Array<{ perStack: Record<string, { kind: string }> }> = JSON.parse(stdout)
    // Every result must have java covered (non-gap)
    for (const dim of parsed) {
      expect(dim.perStack['java']?.kind, `dim has java gap: ${JSON.stringify(dim)}`).not.toBe('gap')
    }
    // Result must be a strict subset of all dims
    expect(parsed.length).toBeGreaterThan(0)
    expect(parsed.length).toBeLessThan(77)
  })

  it('kit list --tml=L1 filters to L1 dims only', () => {
    runKitList({ format: 'json', tml: 'L1' })
    const parsed = JSON.parse(stdout)
    expect(parsed.every((d: { tml: string }) => d.tml === 'L1')).toBe(true)
  })

  it('kit show N01 outputs id and perStack', () => {
    runKitShow('N01')
    const parsed = JSON.parse(stdout)
    expect(parsed.id).toBe('N01')
    expect(parsed.perStack).toBeDefined()
  })

  it('kit explain N01 outputs name and per-stack projection', () => {
    runKitExplain('N01')
    expect(stdout).toContain('N01')
    expect(stdout).toContain('Per-stack projection')
  })

  it('kit explain N08 shows gap cells for non-java stacks', () => {
    runKitExplain('N08')
    // N08 has overlay gap entries for typescript/python/go/rust
    expect(stdout).toContain('gap')
    expect(stdout).toContain('java')
  })

  it('kit show unknown ID exits non-zero', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(() => runKitShow('N99')).toThrow('exit')

    mockExit.mockRestore()
    mockStderr.mockRestore()
  })
})
