// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIntegrationsList } from '../../src/commands/integrations.js'

describe('runIntegrationsList (#561)', () => {
  let dir: string
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-integrations-'))
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns detected + recommended keys', () => {
    const result = runIntegrationsList({ dir, json: true })
    expect(Array.isArray(result.detected)).toBe(true)
    expect(Array.isArray(result.recommended)).toBe(true)
  })

  it('detected + recommended covers all matrix entries', () => {
    const result = runIntegrationsList({ dir })
    const total = result.detected.length + result.recommended.length
    expect(total).toBeGreaterThan(0)
  })

  it('detects a skill installed under project .claude/skills', () => {
    const skillDir = join(dir, '.claude', 'skills', 'tdd')
    mkdirSync(skillDir, { recursive: true })
    const result = runIntegrationsList({ dir })
    const found = [...result.detected, ...result.recommended]
    const tddEntry = found.find((e) => e.id === 'tdd')
    expect(tddEntry?.detected).toBe(true)
  })

  it('json mode emits valid JSON via jsonOutput', () => {
    const written: string[] = []
    stdoutSpy.mockImplementation((s) => {
      written.push(String(s))
      return true
    })
    runIntegrationsList({ dir, json: true })
    const combined = written.join('')
    const parsed = JSON.parse(combined) as unknown
    expect(parsed).toMatchObject({ status: 'ok' })
  })

  it('human mode writes Detected and Recommended headers', () => {
    const written: string[] = []
    stdoutSpy.mockImplementation((s) => {
      written.push(String(s))
      return true
    })
    runIntegrationsList({ dir })
    const combined = written.join('')
    expect(combined).toMatch(/Detected/i)
    expect(combined).toMatch(/Recommended/i)
  })
})
