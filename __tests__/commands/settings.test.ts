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
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { ARBITER_ENV_FLAGS } from '../../src/config/env-registry.js'

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

  it('classifies every row with product-facing effect, cost, consent and applicability', () => {
    for (const field of SETTINGS_CATALOG.flatMap((group) => group.fields)) {
      expect(field.classification, field.path).toMatch(
        /^(editable|derived|mandatory|not-applicable|internal)$/,
      )
      expect(field.effect, field.path).not.toHaveLength(0)
      expect(field.cost, field.path).toMatch(/^(none|low|medium|high|unmeasured)$/)
      expect(field.consent, field.path).toMatch(/^(none|github|diff-egress)$/)
      expect(field.applicability, field.path).toBeTypeOf('function')
    }
  })

  it('surfaces existing runtime controls that were only reachable through config, recipe or init', () => {
    for (const path of [
      'features.fiveLaneCi',
      'runnerProfile',
      'ship.train.maxChain',
      'ship.train.maxAgeMinutes',
      'ship.review.maxRounds',
    ]) {
      expect(SETTINGS_PATHS.has(path), path).toBe(true)
    }
  })

  it('classifies every registered environment control without exposing it as persistent', () => {
    const environment = SETTINGS_CATALOG.find((group) => group.group === 'Per-process environment')
    expect(environment?.fields.map((field) => field.path)).toEqual(
      ARBITER_ENV_FLAGS.map((flag) => flag.name),
    )
    expect(environment?.fields.every((field) => field.classification !== 'editable')).toBe(true)
    expect(
      environment?.fields.find((field) => field.path === 'ARBITER_EVIDENCE_DIR')?.applicability({}),
    ).toEqual({ applicable: false, reason: 'No operational runtime consumer' })
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

  it('reports declared and effective values with env provenance in JSON', () => {
    process.env['ARBITER_THRESHOLD__LINE_COVERAGE'] = '88'
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    try {
      runSettings({
        dir: projectWith({
          thresholds: {
            lineCoverage: 60,
            branchCoverage: 70,
            mutationScore: 70,
            cyclomaticComplexity: 15,
            methodLength: 60,
            maxParams: 5,
          },
        }),
        json: true,
      })
    } finally {
      delete process.env['ARBITER_THRESHOLD__LINE_COVERAGE']
    }
    const parsed = JSON.parse(out.join('')) as {
      data: {
        groups: Array<{
          fields: Array<{
            path: string
            declared: unknown
            effective: unknown
            source: string
            applicability: { applicable: boolean; reason: string | null }
            cost: string
            consent: string
          }>
        }>
      }
    }
    const field = parsed.data.groups
      .flatMap((group) => group.fields)
      .find((candidate) => candidate.path === 'thresholds.lineCoverage')
    expect(field).toMatchObject({
      declared: 60,
      effective: 88,
      source: 'env',
      applicability: { applicable: true, reason: null },
      cost: expect.any(String),
      consent: 'none',
    })
  })

  it('reports env provenance even when the override equals the declared value', () => {
    process.env['ARBITER_THRESHOLD__LINE_COVERAGE'] = '60'
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    try {
      runSettings({ dir: projectWith({ thresholds: { ...DEFAULT_THRESHOLDS.L1 } }), json: true })
    } finally {
      delete process.env['ARBITER_THRESHOLD__LINE_COVERAGE']
    }
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const field = parsed.data.groups
      .flatMap((group) => group.fields)
      .find((candidate) => candidate['path'] === 'thresholds.lineCoverage')
    expect(field).toMatchObject({ declared: 60, effective: 60, source: 'env' })
  })

  it('reports the derived autonomy default instead of an unexplained unset value', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runSettings({ dir: projectWith({}), json: true })
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const autonomy = parsed.data.groups
      .flatMap((group) => group.fields)
      .find((field) => field['path'] === 'automation.autonomy')
    expect(autonomy).toMatchObject({ declared: null, effective: 'L0', source: 'default' })
  })

  it('reports the runtime defaults used by Ship when fields are absent', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runSettings({ dir: projectWith({}), json: true })
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const byPath = new Map(
      parsed.data.groups.flatMap((group) => group.fields).map((field) => [field['path'], field]),
    )
    expect(byPath.get('automation.defaultGateLevel')).toMatchObject({
      declared: null,
      effective: 'L1',
      source: 'default',
    })
    expect(byPath.get('ship.train.maxChain')).toMatchObject({ effective: 10 })
    expect(byPath.get('ship.train.maxAgeMinutes')).toMatchObject({ effective: 480 })
    expect(byPath.get('ship.review.maxRounds')).toMatchObject({ effective: 2 })
  })

  it('does not report an invalid environment value as effective', () => {
    process.env['ARBITER_LOG_LEVEL'] = 'verbose'
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    try {
      runSettings({ dir: projectWith({}), json: true })
    } finally {
      delete process.env['ARBITER_LOG_LEVEL']
    }
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const level = parsed.data.groups
      .flatMap((group) => group.fields)
      .find((field) => field['path'] === 'ARBITER_LOG_LEVEL')
    expect(level).toMatchObject({ declared: 'verbose', effective: 'info', source: 'default' })
  })

  // #1261/#2039: absence is an explained effective default, never an unexplained unset.
  it('renders automation.autonomy with declared/effective provenance (#1261)', () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    runSettings({ dir: projectWith({}) })
    const absentText = out.join('')
    expect(absentText).toMatch(/automation\.autonomy\s+L0 .*declared null; default/)

    out.length = 0
    rmSync(dir, { recursive: true, force: true })
    runSettings({ dir: projectWith({ automation: { autonomy: 'L2' } }) })
    const setText = out.join('')
    expect(setText).toMatch(/automation\.autonomy\s+L2 .*declared L2; project/)
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
