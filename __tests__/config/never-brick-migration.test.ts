// SPDX-License-Identifier: Apache-2.0
/**
 * T0 — never-brick config migration corpus test.
 *
 * IRON LAW proof for T0 (see docs/EXECUTION-PLAYBOOK.md §T0):
 *   WIRED   — every fixture below round-trips through the real loadConfig()
 *             fallback path (migrate → validateConfig → sanitizeCoercibleFields
 *             → validateConfig), not a mock.
 *   TESTED  — the pact fixture flips throw→green with a non-empty report; a
 *             genuinely uncoercible fixture (deliberately outside the
 *             coercible set — a broken `features` block) still throws
 *             E_CONFIG_INVALID, proving the fallback is not a swallow-everything.
 *   WORKING — dogfooded separately against a real downstream showcase repo via
 *             `arbiter diff` / `arbiter doctor` (see task report); this file
 *             proves the mechanism in isolation with disposable fixtures.
 *
 * Root cause (docs/EXECUTION-PLAYBOOK.md §T0): a v0.2 `arbiter.json` with a
 * stale/removed enum value (flagship case: `contractType: 'pact'`, the pre-#T0
 * Pact flavor) threw `E_CONFIG_INVALID` INSIDE migrate() — before loadConfig's
 * own validation (and now its fallback) ever ran. Fixed at two points:
 *   1. src/config/migrations/v1-to-v2.ts — the v0.2-passthrough branch no
 *      longer throws on a strict-validation failure; it warns and defers.
 *   2. src/config/schema.ts::sanitizeCoercibleFields — the generic, single
 *      source of truth for which fields are safe to default (axis/identity
 *      fields only — never features/thresholds/decomposition/... which
 *      directly gate CI strictness).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/utils/config.js'
import { sanitizeCoercibleFields, DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { ConfigError } from '../../src/utils/errors.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'arbiter-never-brick-'))
}

function writeConfig(dir: string, raw: unknown): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(raw, null, 2))
}

// ── sanitizeCoercibleFields — unit level ────────────────────────────────────

// Baseline that already satisfies every OTHER field sanitizeCoercibleFields
// checks, so each test below isolates exactly the one field under test.
const BASELINE = {
  version: '0.2',
  governanceLevel: 'L2',
  tools: ['claude', 'codex'],
  permitGitHub: false,
}

describe('sanitizeCoercibleFields', () => {
  it('drops an unknown contractType (the field-observed pact regression) and reports it', () => {
    const { draft, report } = sanitizeCoercibleFields({
      ...BASELINE,
      contractType: 'pact',
    })
    expect(draft['contractType']).toBeUndefined()
    expect(report).toEqual([{ field: 'contractType', from: 'pact', to: undefined }])
  })

  it('is a no-op (empty report) on an already-valid contractType', () => {
    const { draft, report } = sanitizeCoercibleFields({
      ...BASELINE,
      contractType: 'graphql',
    })
    expect(draft['contractType']).toBe('graphql')
    expect(report).toEqual([])
  })

  it('is a no-op (empty report) when the field is absent', () => {
    const { report } = sanitizeCoercibleFields({ ...BASELINE })
    expect(report).toEqual([])
  })

  it('defaults an unrecognized governanceLevel to L2', () => {
    const { draft, report } = sanitizeCoercibleFields({ governanceLevel: 'L99' })
    expect(draft['governanceLevel']).toBe('L2')
    expect(report).toContainEqual({ field: 'governanceLevel', from: 'L99', to: 'L2' })
  })

  it('filters unknown tools and falls back to claude+codex if the result would be empty', () => {
    const { draft, report } = sanitizeCoercibleFields({ tools: ['not-a-real-tool'] })
    expect(draft['tools']).toEqual(['claude', 'codex'])
    expect(report).toContainEqual({
      field: 'tools',
      from: ['not-a-real-tool'],
      to: ['claude', 'codex'],
    })
  })

  it('filters invalid lane entries but keeps the valid ones', () => {
    const { draft, report } = sanitizeCoercibleFields({ lanes: ['frontend', 'bogus-lane'] })
    expect(draft['lanes']).toEqual(['frontend'])
    expect(report).toContainEqual({
      field: 'lanes',
      from: ['frontend', 'bogus-lane'],
      to: ['frontend'],
    })
  })

  it('defaults permitGitHub:false when neither useGitHub nor permitGitHub is present', () => {
    const { draft, report } = sanitizeCoercibleFields({})
    expect(draft['permitGitHub']).toBe(false)
    expect(report).toContainEqual({ field: 'permitGitHub', from: undefined, to: false })
  })

  it('never touches the fatal surface (features/thresholds/decomposition/...)', () => {
    const { draft, report } = sanitizeCoercibleFields({
      contractType: 'pact',
      features: 'not-an-object',
    })
    // contractType is coerced...
    expect(draft['contractType']).toBeUndefined()
    // ...but the deliberately-broken `features` block is left untouched for
    // validateConfig to reject as fatal.
    expect(draft['features']).toBe('not-an-object')
    expect(report.some((r) => r.field === 'features')).toBe(false)
  })
})

// ── loadConfig — corpus fixtures (every historical shape) ──────────────────

describe('loadConfig — never-brick corpus (T0)', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('v0 (no version field) loads green', () => {
    writeConfig(dir, { tools: ['claude'], governanceLevel: 'L2', useGitHub: false })
    const config = loadConfig(dir)
    expect(config?.version).toBe('0.2')
    expect(config?.$schemaVersion).toBe(4)
  })

  it('v0.1 loads green', () => {
    writeConfig(dir, {
      version: '0.1',
      tools: ['claude'],
      governanceLevel: 'L2',
      useGitHub: false,
    })
    const config = loadConfig(dir)
    expect(config?.version).toBe('0.2')
    expect(config?.$schemaVersion).toBe(4)
  })

  it('v0.2 canonical (already valid) loads green with an empty report (no WARN path taken)', () => {
    writeConfig(dir, {
      version: '0.2',
      tools: ['claude', 'codex'],
      governanceLevel: 'L2',
      permitGitHub: false,
      decomposition: { backend: 'markdown' },
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    const config = loadConfig(dir)
    expect(config?.$schemaVersion).toBe(4)
  })

  it('v0.2 with contractType:"pact" (the exact field-observed regression) flips throw→green', () => {
    writeConfig(dir, {
      version: '0.2',
      tools: ['claude', 'codex'],
      governanceLevel: 'L2',
      permitGitHub: false,
      decomposition: { backend: 'markdown' },
      features: {
        contractTesting: true,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: true,
        debtGates: true,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
      contractType: 'pact',
    })
    // Before T0 this threw E_CONFIG_INVALID inside migrate(). It must now load
    // green, with the coercion visible only as a WARN (see loadConfig).
    const config = loadConfig(dir)
    expect(config).not.toBeNull()
    expect(config?.$schemaVersion).toBe(4)
    expect((config as unknown as Record<string, unknown>)['contractType']).toBeUndefined()
  })

  it('v3 ($schemaVersion: 3) loads green', () => {
    writeConfig(dir, {
      version: '0.2',
      $schemaVersion: 3,
      tools: ['claude'],
      governanceLevel: 'L2',
      permitGitHub: false,
      decomposition: { backend: 'markdown' },
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    const config = loadConfig(dir)
    expect(config?.$schemaVersion).toBe(4)
  })

  it('v4 ($schemaVersion: 4, current) loads green and is idempotent', () => {
    writeConfig(dir, {
      version: '0.2',
      $schemaVersion: 4,
      tools: ['claude'],
      governanceLevel: 'L2',
      permitGitHub: false,
      decomposition: { backend: 'markdown' },
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
      },
      thresholds: DEFAULT_THRESHOLDS.L2,
      kit: { measure: {} },
    })
    const config = loadConfig(dir)
    expect(config?.$schemaVersion).toBe(4)
  })

  // ── red path — proves the fallback is not a swallow-everything ───────────

  it('RED PATH: a genuinely uncoercible config (broken features block) still throws E_CONFIG_INVALID', () => {
    writeConfig(dir, {
      version: '0.2',
      tools: ['claude'],
      governanceLevel: 'L2',
      permitGitHub: false,
      decomposition: { backend: 'markdown' },
      // `features` must be an object per validateConfig — this is outside the
      // coercible set (it directly gates CI strictness) and MUST stay fatal.
      features: 'not-an-object',
      thresholds: DEFAULT_THRESHOLDS.L2,
    })
    expect(() => loadConfig(dir)).toThrow(ConfigError)
    expect(() => loadConfig(dir)).toThrow(/E_CONFIG_INVALID|failed validation/)
  })

  it('RED PATH: unparseable JSON still throws E_CONFIG_INVALID (never coerced)', () => {
    writeFileSync(join(dir, 'arbiter.json'), '{not valid json')
    expect(() => loadConfig(dir)).toThrow(ConfigError)
  })
})
