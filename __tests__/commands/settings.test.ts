// SPDX-License-Identifier: Apache-2.0
// #1121: `arbiter settings` discovery view + SSOT coverage of ALLOWED_PATHS.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SETTINGS_CATALOG,
  SETTINGS_PATHS,
  resolveSettingValue,
  runSettings,
} from '../../src/commands/settings.js'
import { ALLOWED_PATHS } from '../../src/commands/configure.js'

let dir: string
afterEach(() => {
  vi.restoreAllMocks()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function projectWith(config: Record<string, unknown>): string {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-settings-'))
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({
      version: '0.2',
      governanceLevel: 'L2',
      tools: ['claude'],
      permitGitHub: false,
      features: {
        contractTesting: false,
        mutationTesting: false,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      ...config,
    }),
  )
  return dir
}

describe('settings catalog (#1121)', () => {
  it('covers exactly the configure ALLOWED_PATHS (no drift)', () => {
    expect([...SETTINGS_PATHS].sort()).toEqual([...ALLOWED_PATHS].sort())
  })

  it('has no duplicate paths across groups', () => {
    const all = SETTINGS_CATALOG.flatMap((g) => g.fields.map((f) => f.path))
    expect(all.length).toBe(new Set(all).size)
  })
})

describe('resolveSettingValue', () => {
  it('resolves nested dotted paths', () => {
    const cfg = { thresholds: { lineCoverage: 80 }, governanceLevel: 'L2' }
    expect(resolveSettingValue(cfg, 'thresholds.lineCoverage')).toBe(80)
    expect(resolveSettingValue(cfg, 'governanceLevel')).toBe('L2')
    expect(resolveSettingValue(cfg, 'missing.path')).toBeUndefined()
  })
})

describe('runSettings', () => {
  it('lists every group and resolves current values', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runSettings({ dir: projectWith({ governanceLevel: 'L3' }) })
    const text = out.join('')
    for (const group of SETTINGS_CATALOG) expect(text).toContain(group.group)
    expect(text).toContain('governanceLevel')
    expect(text).toContain('L3')
  })

  it('emits machine-readable JSON with --json', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runSettings({ dir: projectWith({ hasDatabase: true }), json: true })
    const parsed = JSON.parse(out.join('')) as Array<{ group: string }>
    expect(parsed.map((g) => g.group)).toContain('Project shape')
  })

  it('exits nonzero when no arbiter.json exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-settings-empty-'))
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((c?: number | string | null) => {
      throw new Error(`exit:${String(c)}`)
    })
    expect(() => runSettings({ dir })).toThrow('exit:1')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
