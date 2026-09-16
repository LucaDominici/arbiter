// SPDX-License-Identifier: Apache-2.0
// #1121: `arbiter settings` discovery view + SSOT coverage of ALLOWED_PATHS.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SETTINGS_CATALOG,
  SETTINGS_PATHS,
  resolveCatalogSettingValue,
  runSettings,
} from '../../src/commands/settings.js'
import { ALLOWED_PATHS } from '../../src/commands/configure.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { ARBITER_ENV_FLAGS } from '../../src/config/env-registry.js'
import { writeUnifiedState } from '../../src/commands/task-state.js'

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

  it('keeps controls without a safe generic writer out of configure', () => {
    for (const path of ['plugins', 'companions']) {
      const field = SETTINGS_CATALOG.flatMap((group) => group.fields).find(
        (candidate) => candidate.path === path,
      )
      expect(field, path).toMatchObject({ classification: 'internal' })
      expect(field?.applicability({})).toEqual({ applicable: true, reason: null })
      expect(SETTINGS_PATHS.has(path), path).toBe(false)
      expect(ALLOWED_PATHS.has(path), path).toBe(false)
    }

    const conformance = SETTINGS_CATALOG.flatMap((group) => group.fields).find(
      (candidate) => candidate.path === 'conformanceThresholds',
    )
    expect(conformance).toMatchObject({ classification: 'not-applicable' })
    expect(conformance?.applicability({})).toEqual({
      applicable: false,
      reason: 'No operational runtime consumer',
    })
    expect(SETTINGS_PATHS.has('conformanceThresholds')).toBe(false)
    expect(ALLOWED_PATHS.has('conformanceThresholds')).toBe(false)
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

describe('resolveCatalogSettingValue', () => {
  it('resolves nested dotted paths', () => {
    const cfg = { thresholds: { lineCoverage: 80 }, governanceLevel: 'L2' }
    expect(resolveCatalogSettingValue(cfg, 'thresholds.lineCoverage')).toBe(80)
    expect(resolveCatalogSettingValue(cfg, 'governanceLevel')).toBe('L2')
    expect(() => resolveCatalogSettingValue(cfg, 'missing.path')).toThrow(
      'Unknown settings catalog path: missing.path',
    )
  })

  it('maps the legacy solo feature into the runtime parallelism default', () => {
    expect(
      resolveCatalogSettingValue(
        { features: { soloDevMode: true } },
        'automation.maxParallelWorktrees',
      ),
    ).toBe(1)
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

  it('reports session overrides as the effective value', () => {
    const target = projectWith({ automation: { autonomy: 'L0' } })
    writeUnifiedState(target, {
      taskId: '#2039',
      overrides: { 'automation.autonomy': 'L3' },
    })
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })

    runSettings({ dir: target, json: true })

    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const autonomy = parsed.data.groups
      .flatMap((group) => group.fields)
      .find((field) => field['path'] === 'automation.autonomy')
    expect(autonomy).toMatchObject({ declared: 'L0', effective: 'L3', source: 'session' })
  })

  it('parses and redacts the registered environment value shapes', () => {
    const values = {
      ARBITER_RUN_ID: 'run-secret',
      ARBITER_HOOK_DEBOUNCE_MS: '250',
      ARBITER_LOG_FORMAT: 'json',
      ARBITER_FINDING_LOSS_HARD: 'true',
      ARBITER_THRESHOLD__LINE_COVERAGE: '88',
      ARBITER_FEATURE__CONTRACT_TESTING: 'true',
    }
    Object.assign(process.env, values)
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    try {
      runSettings({ dir: projectWith({}), json: true })
    } finally {
      delete process.env['ARBITER_RUN_ID']
      delete process.env['ARBITER_HOOK_DEBOUNCE_MS']
      delete process.env['ARBITER_LOG_FORMAT']
      delete process.env['ARBITER_FINDING_LOSS_HARD']
      delete process.env['ARBITER_THRESHOLD__LINE_COVERAGE']
      delete process.env['ARBITER_FEATURE__CONTRACT_TESTING']
    }
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const byPath = new Map(
      parsed.data.groups.flatMap((group) => group.fields).map((field) => [field['path'], field]),
    )
    expect(byPath.get('ARBITER_RUN_ID')).toMatchObject({
      declared: '(set)',
      effective: '(set)',
      source: 'env',
    })
    expect(byPath.get('ARBITER_HOOK_DEBOUNCE_MS')).toMatchObject({ effective: 250, source: 'env' })
    expect(byPath.get('ARBITER_LOG_FORMAT')).toMatchObject({ effective: 'json', source: 'env' })
    expect(byPath.get('ARBITER_FINDING_LOSS_HARD')).toMatchObject({
      effective: true,
      source: 'env',
    })
    expect(byPath.get('ARBITER_THRESHOLD__')).toMatchObject({
      effective: { ARBITER_THRESHOLD__LINE_COVERAGE: 88 },
      source: 'env',
    })
    expect(byPath.get('ARBITER_FEATURE__')).toMatchObject({
      effective: { ARBITER_FEATURE__CONTRACT_TESTING: true },
      source: 'env',
    })
  })

  it('falls back for invalid numeric and boolean environment values', () => {
    process.env['ARBITER_HOOK_DEBOUNCE_MS'] = '-1'
    process.env['ARBITER_FINDING_LOSS_HARD'] = 'maybe'
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    try {
      runSettings({ dir: projectWith({}), json: true })
    } finally {
      delete process.env['ARBITER_HOOK_DEBOUNCE_MS']
      delete process.env['ARBITER_FINDING_LOSS_HARD']
    }
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const byPath = new Map(
      parsed.data.groups.flatMap((group) => group.fields).map((field) => [field['path'], field]),
    )
    expect(byPath.get('ARBITER_HOOK_DEBOUNCE_MS')).toMatchObject({
      effective: 20000,
      source: 'default',
    })
    expect(byPath.get('ARBITER_FINDING_LOSS_HARD')).toMatchObject({
      effective: false,
      source: 'default',
    })
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
    expect(byPath.get('automation.maxParallelWorktrees')).toMatchObject({ effective: 3 })
    expect(byPath.get('runnerProfile')).toMatchObject({ effective: 'fleet' })
    expect(byPath.get('crossModelReview.enabled')).toMatchObject({ effective: false })
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

  it('does not report rejected prefix overrides as effective', () => {
    process.env['ARBITER_THRESHOLD__LINE_COVERAGE'] = '999'
    process.env['ARBITER_FEATURE__NO_SKIPPED_TESTS'] = 'false'
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out.push(String(s))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      runSettings({ dir: projectWith({}), json: true })
    } finally {
      delete process.env['ARBITER_THRESHOLD__LINE_COVERAGE']
      delete process.env['ARBITER_FEATURE__NO_SKIPPED_TESTS']
    }
    const parsed = JSON.parse(out.join('')) as {
      data: { groups: Array<{ fields: Array<Record<string, unknown>> }> }
    }
    const byPath = new Map(
      parsed.data.groups.flatMap((group) => group.fields).map((field) => [field['path'], field]),
    )
    expect(byPath.get('ARBITER_THRESHOLD__')).toMatchObject({ effective: null, source: 'default' })
    expect(byPath.get('ARBITER_FEATURE__')).toMatchObject({ effective: null, source: 'default' })
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
