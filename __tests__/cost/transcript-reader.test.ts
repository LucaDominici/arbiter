// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { readTranscriptCosts } from '../../src/cost/transcript-reader.js'

describe('readTranscriptCosts (#703)', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpFile(lines: string[]): string {
    const d = mkdtempSync(join(tmpdir(), 'transcript-test-'))
    dirs.push(d)
    const p = join(d, 'transcript.jsonl')
    writeFileSync(p, lines.join('\n') + '\n', 'utf-8')
    return p
  }

  it('sums input and output tokens from assistant messages', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      message: {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 100,
        },
      },
    })
    const path = tmpFile([line])
    const result = readTranscriptCosts(path, '2026-05-18T09:00:00.000Z')
    expect(result.input).toBe(1600)
    expect(result.output).toBe(200)
    expect(result.samples).toBe(1)
  })

  it('filters messages before sinceISO', () => {
    const old = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T08:00:00.000Z',
      message: { usage: { input_tokens: 5000, output_tokens: 1000 } },
    })
    const recent = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      message: { usage: { input_tokens: 100, output_tokens: 20 } },
    })
    const path = tmpFile([old, recent])
    const result = readTranscriptCosts(path, '2026-05-18T09:00:00.000Z')
    expect(result.input).toBe(100)
    expect(result.output).toBe(20)
    expect(result.samples).toBe(1)
  })

  it('returns zero samples for non-existent file', () => {
    const result = readTranscriptCosts('/non/existent/path.jsonl', '2026-05-18T00:00:00.000Z')
    expect(result).toEqual({ input: 0, output: 0, samples: 0 })
  })

  it('returns zero samples for malformed JSONL (graceful failure)', () => {
    const path = tmpFile(['not json at all', '{broken'])
    const result = readTranscriptCosts(path, '2026-05-18T00:00:00.000Z')
    expect(result).toEqual({ input: 0, output: 0, samples: 0 })
  })

  it('skips lines missing usage field without throwing', () => {
    const noUsage = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      message: { content: 'hello' },
    })
    const withUsage = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:01:00.000Z',
      message: { usage: { input_tokens: 50, output_tokens: 10 } },
    })
    const path = tmpFile([noUsage, withUsage])
    const result = readTranscriptCosts(path, '2026-05-18T09:00:00.000Z')
    expect(result.samples).toBe(1)
    expect(result.input).toBe(50)
  })

  it('skips malformed line and accumulates valid lines before and after it', () => {
    const valid1 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      message: { usage: { input_tokens: 100, output_tokens: 20 } },
    })
    const valid2 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:02:00.000Z',
      message: { usage: { input_tokens: 200, output_tokens: 40 } },
    })
    const path = tmpFile([valid1, 'CORRUPT_JSON', valid2])
    const result = readTranscriptCosts(path, '2026-05-18T09:00:00.000Z')
    expect(result.samples).toBe(2)
    expect(result.input).toBe(300)
    expect(result.output).toBe(60)
  })

  it('skips a bare `null` line (valid JSON scalar) without abandoning the whole file', () => {
    // Regression (#1535): `JSON.parse("null")` succeeds → `parsed.type` used to
    // throw TypeError, propagating to the outer catch and zeroing the file.
    const valid1 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      message: { usage: { input_tokens: 100, output_tokens: 20 } },
    })
    const valid2 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:02:00.000Z',
      message: { usage: { input_tokens: 100, output_tokens: 20 } },
    })
    const path = tmpFile([valid1, 'null', valid2])
    const result = readTranscriptCosts(path, '2026-05-18T09:00:00.000Z')
    expect(result.samples).toBe(2)
    expect(result.input).toBe(200)
    expect(result.output).toBe(40)
  })

  it('filters by instant, not lexicographically, across timestamp formats (#1535)', () => {
    // Offset form "+02:00" == 10:00Z, which is BEFORE the 11:00Z cutoff → must be
    // EXCLUDED. A naive string compare ("…T12…+02:00" > "…T11…Z") wrongly keeps it.
    const offset = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T12:00:00.000+02:00',
      message: { usage: { input_tokens: 70, output_tokens: 7 } },
    })
    const path = tmpFile([offset])
    const result = readTranscriptCosts(path, '2026-05-18T11:00:00.000Z')
    expect(result.samples).toBe(0)
  })

  it('returned object never contains PII fields', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-18T10:00:00.000Z',
      message: { usage: { input_tokens: 100, output_tokens: 20 } },
    })
    const path = tmpFile([line])
    const result = readTranscriptCosts(path, '2026-05-18T09:00:00.000Z')
    const keys = Object.keys(result)
    expect(keys).toEqual(expect.arrayContaining(['input', 'output', 'samples']))
    expect(keys.length).toBe(3)
  })
})
