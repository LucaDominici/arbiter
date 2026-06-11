// SPDX-License-Identifier: Apache-2.0
//
// #1305 (ADR-094 §Decision.2-3) — the unified override resolver + --set grammar.
// One curated catalog (OVERRIDABLE_PATHS ⊂ ALLOWED_PATHS) + one precedence resolver
// resolveSetting(path): per-run override → session → env+profile → derived default.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OVERRIDABLE_PATHS,
  ALLOWED_PATHS,
  assertOverridablePath,
} from '../../src/commands/configure.js'
import { resolveSetting } from '../../src/config/override-resolver.js'
import { writeOverride } from '../../src/commands/task-state.js'
import { DEFAULT_AUTONOMY } from '../../src/config/collaboration-mode-defaults.js'

const dirs: string[] = []
function tmpRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-override-'))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}
afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

const cfg = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    version: '2.0.0',
    governanceLevel: 'L2',
    tools: {},
    features: {},
    thresholds: {},
    ...extra,
  })

// ─── catalog: OVERRIDABLE_PATHS is a curated subset of ALLOWED_PATHS ───────────

describe('OVERRIDABLE_PATHS catalog (ADR-094 §Decision.2)', () => {
  it('is a strict subset of ALLOWED_PATHS', () => {
    for (const p of OVERRIDABLE_PATHS) {
      expect(ALLOWED_PATHS.has(p), `${p} must be in ALLOWED_PATHS`).toBe(true)
    }
    expect(OVERRIDABLE_PATHS.size).toBeLessThan(ALLOWED_PATHS.size)
  })

  it('contains automation.autonomy but NOT governanceLevel (not per-run-flippable)', () => {
    expect(OVERRIDABLE_PATHS.has('automation.autonomy')).toBe(true)
    expect(OVERRIDABLE_PATHS.has('governanceLevel')).toBe(false)
  })
})

describe('assertOverridablePath guard (RT-01)', () => {
  it('passes for an overridable path', () => {
    expect(() => assertOverridablePath('automation.autonomy')).not.toThrow()
  })

  it('throws for a non-overridable path (governanceLevel)', () => {
    expect(() => assertOverridablePath('governanceLevel')).toThrow()
  })

  it('throws for an unknown path', () => {
    expect(() => assertOverridablePath('not.a.real.path')).toThrow()
  })
})

// ─── resolveSetting precedence ────────────────────────────────────────────────

describe('resolveSetting — precedence (ADR-094 §Decision.3)', () => {
  it('derived default L0 with no config, no session, no override', () => {
    const dir = tmpRepo({})
    expect(resolveSetting('automation.autonomy', { root: dir })).toBe(DEFAULT_AUTONOMY)
    expect(DEFAULT_AUTONOMY).toBe('L0')
  })

  it('arbiter.json profile beats the derived default', () => {
    const dir = tmpRepo({ 'arbiter.json': cfg({ automation: { autonomy: 'L2' } }) })
    expect(resolveSetting('automation.autonomy', { root: dir })).toBe('L2')
  })

  it('session value beats the profile (set survives /clear)', () => {
    const dir = tmpRepo({ 'arbiter.json': cfg({ automation: { autonomy: 'L1' } }) })
    writeOverride(dir, 'automation.autonomy', 'L2')
    // No per-run override: simulates a post-/clear re-entry reading the session.
    expect(resolveSetting('automation.autonomy', { root: dir })).toBe('L2')
  })

  it('per-run override beats the session and the profile', () => {
    const dir = tmpRepo({ 'arbiter.json': cfg({ automation: { autonomy: 'L1' } }) })
    writeOverride(dir, 'automation.autonomy', 'L2')
    expect(
      resolveSetting('automation.autonomy', {
        root: dir,
        overrides: { 'automation.autonomy': 'L3' },
      }),
    ).toBe('L3')
  })

  it('an invalid per-run override is warn-skipped, falling to the next layer (fail-closed, RT-02)', () => {
    const dir = tmpRepo({ 'arbiter.json': cfg({ automation: { autonomy: 'L1' } }) })
    expect(
      resolveSetting('automation.autonomy', {
        root: dir,
        overrides: { 'automation.autonomy': 'turbo' },
      }),
    ).toBe('L1')
  })

  it('an invalid value persisted in the session is warn-skipped, never crashing (fail-closed, RT-02)', () => {
    const dir = tmpRepo({ 'arbiter.json': cfg({ automation: { autonomy: 'L1' } }) })
    // Simulate a corrupt/hand-edited session value.
    mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
    writeFileSync(
      join(dir, '.claude', '.task', 'status.json'),
      JSON.stringify({ overrides: { 'automation.autonomy': 'L9' } }) + '\n',
    )
    expect(() => resolveSetting('automation.autonomy', { root: dir })).not.toThrow()
    expect(resolveSetting('automation.autonomy', { root: dir })).toBe('L1')
  })
})
