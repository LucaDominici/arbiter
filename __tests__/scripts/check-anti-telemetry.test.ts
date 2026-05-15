// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const allowlistPath = resolve(root, 'suppressions/telemetry-allowlist.json')

describe('telemetry-allowlist.json schema (#642)', () => {
  it('file exists', () => {
    expect(() => readFileSync(allowlistPath, 'utf-8')).not.toThrow()
  })

  it('parses as valid JSON array', () => {
    const raw = readFileSync(allowlistPath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('every entry has required fields: pattern, file, justification', () => {
    const entries = JSON.parse(readFileSync(allowlistPath, 'utf-8')) as unknown[]
    for (const entry of entries) {
      const e = entry as Record<string, unknown>
      expect(typeof e.pattern, `entry missing pattern: ${JSON.stringify(e)}`).toBe('string')
      expect(typeof e.file, `entry missing file: ${JSON.stringify(e)}`).toBe('string')
      expect(typeof e.justification, `entry missing justification: ${JSON.stringify(e)}`).toBe(
        'string',
      )
    }
  })

  it('no entry has an empty justification', () => {
    const entries = JSON.parse(readFileSync(allowlistPath, 'utf-8')) as Array<{
      justification: string
    }>
    for (const entry of entries) {
      expect(
        entry.justification.trim().length,
        `empty justification in ${JSON.stringify(entry)}`,
      ).toBeGreaterThan(0)
    }
  })
})
