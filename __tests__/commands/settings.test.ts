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

  // #1261: the Project Profile autonomy axis must be a discoverable setting.
  it('surfaces automation.autonomy in an Automation group (#1261)', () => {
    expect(SETTINGS_PATHS.has('automation.autonomy')).toBe(true)
    const group = SETTINGS_CATALOG.find((g) =>
      g.fields.some((f) => f.path === 'automation.autonomy'),
    )
    expect(group?.group).toBe('Automation')
  })

  // #1306: the orchestration prefs must be discoverable in `arbiter settings`.
  // #2329 removed the third (automation.affinityBatching) — pinned absent in
  // __tests__/config/affinity-batching-removed.test.ts.
  it('surfaces the #1306 orchestration prefs in the Automation group', () => {
    const automation = SETTINGS_CATALOG.find((g) => g.group === 'Automation')
    const paths = automation?.fields.map((f) => f.path) ?? []
    expect(paths).toContain('automation.maxParallelWorktrees')
    expect(paths).toContain('automation.defaultGateLevel')
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
    const parsed = JSON.parse(out.join('')) as { data: { groups: Array<{ group: string }> } }
    expect(parsed.data.groups.map((g) => g.group)).toContain('Project shape')
  })

  // #1261: absent automation block renders (unset) — the label documents absent=L0.
  it('renders automation.autonomy as (unset) when absent and the level when set (#1261)', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runSettings({ dir: projectWith({}) })
    const absentText = out.join('')
    expect(absentText).toMatch(/automation\.autonomy\s+\(unset\)/)

    out.length = 0
    rmSync(dir, { recursive: true, force: true })
    runSettings({ dir: projectWith({ automation: { autonomy: 'L2' } }) })
    const setText = out.join('')
    expect(setText).toMatch(/automation\.autonomy\s+L2/)
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
