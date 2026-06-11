// SPDX-License-Identifier: Apache-2.0
//
// #1306 (ADR-094 §Decision.4) — the three Project-Profile orchestration prefs:
// maxParallelWorktrees / defaultGateLevel / affinityBatching. One schema field +
// one catalog entry + one validator each, picked up by the unified #1305 resolver.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfig } from '../../src/config/schema.js'
import { parseValue, ALLOWED_PATHS, OVERRIDABLE_PATHS } from '../../src/commands/configure.js'
import { resolveSetting } from '../../src/config/override-resolver.js'
import {
  resolveDefaultMaxParallelWorktrees,
  resolveDefaultAffinityBatching,
  resolveDefaultGateLevel,
} from '../../src/config/collaboration-mode-defaults.js'
import { defaultConfig } from '../helpers/default-config.js'

const dirs: string[] = []
function tmpRepo(arbiterJson: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-profilefields-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(arbiterJson))
  return dir
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

// A FULLY-VALID config (defaultConfig) with the automation block swapped in, so
// validateConfig / loadConfig only ever fail on the automation field under test —
// never on an unrelated missing feature/threshold.
const base = (automation: Record<string, unknown>): Record<string, unknown> => ({
  ...defaultConfig(),
  automation,
})

// ── schema validation ─────────────────────────────────────────────────────────

describe('validateConfig — automation prefs (#1306)', () => {
  it('accepts valid values for all three fields', () => {
    const r = validateConfig(
      base({
        autonomy: 'L1',
        maxParallelWorktrees: 3,
        defaultGateLevel: 'L2',
        affinityBatching: true,
      }),
    )
    expect(r.ok).toBe(true)
  })

  it('accepts a legacy automation block (autonomy only)', () => {
    expect(validateConfig(base({ autonomy: 'L0' })).ok).toBe(true)
  })

  it('accepts a config with NO automation block (back-compat, no $schemaVersion bump)', () => {
    const cfg = base({ autonomy: 'L0' })
    delete cfg['automation']
    expect(validateConfig(cfg).ok).toBe(true)
  })

  it('rejects non-integer / non-positive maxParallelWorktrees', () => {
    expect(validateConfig(base({ autonomy: 'L0', maxParallelWorktrees: 0 })).ok).toBe(false)
    expect(validateConfig(base({ autonomy: 'L0', maxParallelWorktrees: -1 })).ok).toBe(false)
    expect(validateConfig(base({ autonomy: 'L0', maxParallelWorktrees: 2.5 })).ok).toBe(false)
    expect(validateConfig(base({ autonomy: 'L0', maxParallelWorktrees: 'x' })).ok).toBe(false)
  })

  it('rejects defaultGateLevel outside L1/L2 (L3 is not a runnable gate level)', () => {
    expect(validateConfig(base({ autonomy: 'L0', defaultGateLevel: 'L3' })).ok).toBe(false)
    expect(validateConfig(base({ autonomy: 'L0', defaultGateLevel: 'L1' })).ok).toBe(true)
  })

  it('rejects non-boolean affinityBatching', () => {
    expect(validateConfig(base({ autonomy: 'L0', affinityBatching: 'yes' })).ok).toBe(false)
  })
})

// ── catalog + parseValue ────────────────────────────────────────────────────────

describe('configure catalog + parseValue (#1306)', () => {
  const paths = [
    'automation.maxParallelWorktrees',
    'automation.defaultGateLevel',
    'automation.affinityBatching',
  ]

  it('all three are in ALLOWED_PATHS and OVERRIDABLE_PATHS', () => {
    for (const p of paths) {
      expect(ALLOWED_PATHS.has(p), `${p} in ALLOWED_PATHS`).toBe(true)
      expect(OVERRIDABLE_PATHS.has(p), `${p} in OVERRIDABLE_PATHS`).toBe(true)
    }
  })

  it('OVERRIDABLE_PATHS remains a strict subset of ALLOWED_PATHS', () => {
    for (const p of OVERRIDABLE_PATHS) expect(ALLOWED_PATHS.has(p)).toBe(true)
    expect(OVERRIDABLE_PATHS.size).toBeLessThan(ALLOWED_PATHS.size)
  })

  it('parseValue coerces maxParallelWorktrees to a positive int and rejects junk', () => {
    expect(parseValue('automation.maxParallelWorktrees', '3')).toBe(3)
    expect(() => parseValue('automation.maxParallelWorktrees', '0')).toThrow()
    expect(() => parseValue('automation.maxParallelWorktrees', '-1')).toThrow()
    expect(() => parseValue('automation.maxParallelWorktrees', '2.5')).toThrow()
    expect(() => parseValue('automation.maxParallelWorktrees', 'abc')).toThrow()
  })

  it('parseValue enum-validates defaultGateLevel (L1/L2 only)', () => {
    expect(parseValue('automation.defaultGateLevel', 'L1')).toBe('L1')
    expect(parseValue('automation.defaultGateLevel', 'L2')).toBe('L2')
    expect(() => parseValue('automation.defaultGateLevel', 'L3')).toThrow()
  })

  it('parseValue boolean-validates affinityBatching', () => {
    expect(parseValue('automation.affinityBatching', 'true')).toBe(true)
    expect(parseValue('automation.affinityBatching', 'false')).toBe(false)
    expect(() => parseValue('automation.affinityBatching', '1')).toThrow()
  })
})

// ── unified resolver derived floors (RT-1306-04) ──────────────────────────────

describe('resolveSetting — derived floors for the new paths (#1306)', () => {
  it('never throws "no derived default" for the three paths on a profile-blind repo', () => {
    const dir = tmpRepo(base({ autonomy: 'L0' }))
    expect(resolveSetting('automation.maxParallelWorktrees', { root: dir })).toBe('1')
    expect(resolveSetting('automation.defaultGateLevel', { root: dir })).toBe('L1')
    expect(resolveSetting('automation.affinityBatching', { root: dir })).toBe('false')
  })

  it('profile value wins over the floor', () => {
    const dir = tmpRepo(
      base({
        autonomy: 'L0',
        maxParallelWorktrees: 4,
        defaultGateLevel: 'L2',
        affinityBatching: true,
      }),
    )
    expect(resolveSetting('automation.maxParallelWorktrees', { root: dir })).toBe('4')
    expect(resolveSetting('automation.defaultGateLevel', { root: dir })).toBe('L2')
    expect(resolveSetting('automation.affinityBatching', { root: dir })).toBe('true')
  })

  it('per-run override wins over profile (highest precedence)', () => {
    const dir = tmpRepo(base({ autonomy: 'L0', maxParallelWorktrees: 4 }))
    expect(
      resolveSetting('automation.maxParallelWorktrees', {
        root: dir,
        overrides: { 'automation.maxParallelWorktrees': '2' },
      }),
    ).toBe('2')
  })

  it('an invalid profile value warn-skips to the floor (fail-closed)', () => {
    const dir = tmpRepo(base({ autonomy: 'L0', defaultGateLevel: 'L3' }))
    // L3 is not parseValue-valid for defaultGateLevel → fall through to floor.
    expect(resolveSetting('automation.defaultGateLevel', { root: dir })).toBe('L1')
  })
})

// ── wizard derivation (convention over configuration) ─────────────────────────

describe('collaboration-mode derivations (#1306)', () => {
  it('trunk-solo → 1 worktree, no affinity batching', () => {
    expect(resolveDefaultMaxParallelWorktrees('trunk-solo')).toBe(1)
    expect(resolveDefaultAffinityBatching('trunk-solo')).toBe(false)
  })

  it('peer/gated review → >1 worktrees, affinity batching on', () => {
    expect(resolveDefaultMaxParallelWorktrees('peer-review')).toBeGreaterThan(1)
    expect(resolveDefaultAffinityBatching('peer-review')).toBe(true)
    expect(resolveDefaultMaxParallelWorktrees('gated-review')).toBeGreaterThan(1)
  })

  it('gate level derives from governance: L1/L2 → L1, L3/L4 → L2', () => {
    expect(resolveDefaultGateLevel('L1')).toBe('L1')
    expect(resolveDefaultGateLevel('L2')).toBe('L1')
    expect(resolveDefaultGateLevel('L3')).toBe('L2')
    expect(resolveDefaultGateLevel('L4')).toBe('L2')
  })
})
