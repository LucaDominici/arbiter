// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runIntegrationsList } from '../../src/commands/integrations.js'
import { clearSkillCache } from '../../src/integrations/skill-detector.js'

function writeSkill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`,
  )
}

describe('runIntegrationsList (#561)', () => {
  let dir: string
  let home: string
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearSkillCache()
    dir = mkdtempSync(join(tmpdir(), 'arbiter-integrations-'))
    // Isolated Claude home so detection never depends on the real machine.
    home = mkdtempSync(join(tmpdir(), 'arbiter-integrations-home-'))
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    clearSkillCache()
  })

  it('returns detected + recommended keys', () => {
    const result = runIntegrationsList({ dir, claudeHome: home, json: true })
    expect(Array.isArray(result.detected)).toBe(true)
    expect(Array.isArray(result.recommended)).toBe(true)
  })

  it('detected + recommended covers all matrix entries', () => {
    const result = runIntegrationsList({ dir, claudeHome: home })
    const total = result.detected.length + result.recommended.length
    expect(total).toBeGreaterThan(0)
  })

  it('detects a skill installed under project .claude/skills', () => {
    writeSkill(join(dir, '.claude', 'skills', 'tdd'), 'tdd')
    const result = runIntegrationsList({ dir, claudeHome: home })
    const found = [...result.detected, ...result.recommended]
    const tddEntry = found.find((e) => e.id === 'tdd')
    expect(tddEntry?.detected).toBe(true)
  })

  it('detects a plugin skill nested in the Claude home cache (#1613 Problem 1)', () => {
    // Real plugin install path: cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md.
    // The former flat existsSync probes never matched this nested shape, so an
    // installed plugin skill was always reported [missing].
    writeSkill(
      join(
        home,
        'plugins',
        'cache',
        'claude-plugins-official',
        'superpowers',
        '5.0.0',
        'skills',
        'using-superpowers',
      ),
      'using-superpowers',
    )
    const result = runIntegrationsList({ dir, claudeHome: home })
    const found = [...result.detected, ...result.recommended]
    const entry = found.find((e) => e.id === 'superpowers:using-superpowers')
    expect(entry?.detected).toBe(true)
    expect(result.detected.some((e) => e.id === 'superpowers:using-superpowers')).toBe(true)
  })

  it('reports an uninstalled plugin skill as recommended, not detected', () => {
    const result = runIntegrationsList({ dir, claudeHome: home })
    expect(result.recommended.some((e) => e.id === 'superpowers:using-superpowers')).toBe(true)
    expect(result.detected.some((e) => e.id === 'superpowers:using-superpowers')).toBe(false)
  })

  it('json mode emits valid JSON via jsonOutput', () => {
    const written: string[] = []
    stdoutSpy.mockImplementation((s) => {
      written.push(String(s))
      return true
    })
    runIntegrationsList({ dir, claudeHome: home, json: true })
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
    runIntegrationsList({ dir, claudeHome: home })
    const combined = written.join('')
    expect(combined).toMatch(/Detected/i)
    expect(combined).toMatch(/Recommended/i)
  })
})
