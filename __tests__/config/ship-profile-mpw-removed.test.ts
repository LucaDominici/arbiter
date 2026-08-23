// SPDX-License-Identifier: Apache-2.0
//
// #2333 — `ShipProfile.maxParallelWorktrees` lost its only reader when #2329 deleted
// `planAction()`'s affinity branch. The field kept resolving into the profile and the
// path kept sitting in OVERRIDABLE_PATHS, so `arbiter ship --set
// automation.maxParallelWorktrees=4` was accepted, validated, persisted to the session
// layer — and changed nothing. Same accept-then-ignore class as #2329, one level down.
//
// Resolution is strict subtraction (option (a), matching #1817/#2329): the SHIP-side
// residual goes — the ShipProfile field, the OVERRIDABLE_PATHS entry, the resolver's
// derived floor. The CONFIG KNOB STAYS: it has two real consumers (doctor
// profile-coherence, wizard coherence) plus the schema/wizard/settings/method/recipe
// surfaces. Over-deletion is a failure here, not a bonus — hence the consumer-intact
// and negative-control blocks below.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runConfigure,
  ALLOWED_PATHS,
  OVERRIDABLE_PATHS,
  assertOverridablePath,
} from '../../src/commands/configure.js'
import { resolveSetting } from '../../src/config/override-resolver.js'
import { readOverride } from '../../src/commands/task-state.js'
import {
  buildShipOverrides,
  resolveShipProfile,
  CONSUMER_DEFAULT_PROFILE,
} from '../../src/commands/ship-profile.js'
import { validateProfileCoherence } from '../../src/commands/wizard/coherence.js'
import { defaultConfig } from '../helpers/default-config.js'

/** The path whose SHIP-side residual #2333 removes (the knob itself survives). */
const UNREAD_PATH = 'automation.maxParallelWorktrees'
/** The sibling pref that keeps a real reader (verification reads it) — negative control. */
const LIVE_PATH = 'automation.defaultGateLevel'

const dirs: string[] = []

function tmpRepo(automation?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-2333-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'acme-app' }))
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify({
      ...defaultConfig(),
      collaborationMode: 'peer-review',
      ...(automation !== undefined ? { automation } : {}),
    }),
  )
  return dir
}

/** A repo with NO arbiter.json — every resolver layer below "derived default" is empty. */
function blindRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-2333-blind-'))
  dirs.push(dir)
  return dir
}

function readArbiterJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<string, unknown>
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

// ── the accept-then-ignore path is now REJECTED, not silently honoured ─────────

describe('#2333 — `ship --set automation.maxParallelWorktrees` is rejected', () => {
  it('buildShipOverrides (what cli.ts actually calls) throws E_UNKNOWN_PATH', () => {
    const dir = tmpRepo({ autonomy: 'L0' })
    expect(() => buildShipOverrides(dir, { sets: [`${UNREAD_PATH}=4`] })).toThrowError(
      /E_UNKNOWN_PATH|unknown/i,
    )
  })

  it('and NOTHING is persisted to the session layer (the accept-then-ignore signature)', () => {
    const dir = tmpRepo({ autonomy: 'L0' })
    try {
      buildShipOverrides(dir, { sets: [`${UNREAD_PATH}=4`] })
    } catch {
      /* expected — the assertion is about what did NOT land */
    }
    expect(readOverride(dir, UNREAD_PATH)).toBeUndefined()
  })

  it('the low-level guard and the catalog agree the path is not per-run overridable', () => {
    expect(() => assertOverridablePath(UNREAD_PATH)).toThrowError(/E_UNKNOWN_PATH|unknown/i)
    expect(OVERRIDABLE_PATHS.has(UNREAD_PATH)).toBe(false)
  })
})

// ── ShipProfile carries no field without a reader ──────────────────────────────

describe('#2333 — ShipProfile no longer carries the unread field', () => {
  it('CONSUMER_DEFAULT_PROFILE has no maxParallelWorktrees own-key', () => {
    expect(Object.keys(CONSUMER_DEFAULT_PROFILE)).not.toContain('maxParallelWorktrees')
  })

  it('a resolved profile has no maxParallelWorktrees own-key, even when arbiter.json sets it', () => {
    const dir = tmpRepo({ autonomy: 'L0', maxParallelWorktrees: 3, defaultGateLevel: 'L2' })
    expect(Object.keys(resolveShipProfile(dir))).not.toContain('maxParallelWorktrees')
  })
})

// ── NEGATIVE CONTROLS: a surviving overridable path still round-trips fully ────

describe('#2333 NEGATIVE CONTROL — the live sibling pref is untouched', () => {
  it('automation.defaultGateLevel round-trips override → session → resolved profile', () => {
    const dir = tmpRepo({ autonomy: 'L0', defaultGateLevel: 'L1' })
    const overrides = buildShipOverrides(dir, { sets: [`${LIVE_PATH}=L2`] })
    expect(overrides[LIVE_PATH]).toBe('L2')
    // persisted to the session layer so it survives a mid-wave /clear …
    expect(readOverride(dir, LIVE_PATH)).toBe('L2')
    // … and it actually changes the resolved profile (not accept-then-ignore).
    expect(resolveShipProfile(dir, { overrides }).defaultGateLevel).toBe('L2')
    // it also survives WITHOUT the in-memory overrides map, straight off the session.
    expect(resolveShipProfile(dir).defaultGateLevel).toBe('L2')
  })

  it('automation.autonomy is still per-run overridable and observable', () => {
    const dir = tmpRepo({ autonomy: 'L0' })
    const overrides = buildShipOverrides(dir, { sets: ['automation.autonomy=L2'] })
    expect(resolveShipProfile(dir, { overrides }).autonomy).toBe('L2')
  })
})

// ── the KNOB ITSELF survives: both real consumers still read it ────────────────

describe('#2333 — the config knob keeps its two real consumers (no over-deletion)', () => {
  it('`arbiter configure --set automation.maxParallelWorktrees=3` still persists', async () => {
    const dir = tmpRepo({ autonomy: 'L0' })
    await runConfigure({ dir, sets: [`${UNREAD_PATH}=3`] })
    const automation = readArbiterJson(dir)['automation'] as Record<string, unknown>
    expect(automation[UNREAD_PATH.split('.')[1] as string]).toBe(3)
  })

  it('it is still an ALLOWED_PATH (persistent), just not an OVERRIDABLE one (per-run)', () => {
    expect(ALLOWED_PATHS.has(UNREAD_PATH)).toBe(true)
    expect(OVERRIDABLE_PATHS.has(UNREAD_PATH)).toBe(false)
  })

  it('wizard/doctor coherence still flags >1 under trunk-solo as CRITICAL', () => {
    const r = validateProfileCoherence(3, undefined, 'trunk-solo', 'L2')
    expect(r.severity).toBe('CRITICAL')
    expect(r.message).toContain(UNREAD_PATH)
    // and the coherent cases still pass
    expect(validateProfileCoherence(1, undefined, 'trunk-solo', 'L2').severity).toBe('OK')
    expect(validateProfileCoherence(4, undefined, 'peer-review', 'L2').severity).toBe('OK')
  })
})

// ── the RATCHET that would have caught #2333 mechanically ─────────────────────
//
// A per-run override target and a resolver derived-default must exist together:
//   • a DERIVED_DEFAULTS entry without an OVERRIDABLE_PATHS entry is dead config
//     (nothing can ever reach that layer) — the residual #2333 removes;
//   • an OVERRIDABLE_PATHS entry without a DERIVED_DEFAULTS entry makes
//     `resolveSetting` THROW on a profile-blind repo — a crash-on-fresh-repo bug.
// Asserted behaviourally (resolveSetting throws iff no floor is registered) so no
// module-private table needs exporting.

describe('#2333 — OVERRIDABLE_PATHS ↔ resolver derived floors stay in lockstep', () => {
  it('every overridable path resolves on a profile-blind repo (a floor is registered)', () => {
    const dir = blindRepo()
    expect(OVERRIDABLE_PATHS.size).toBeGreaterThanOrEqual(2) // non-vacuity
    for (const p of OVERRIDABLE_PATHS) {
      expect(() => resolveSetting(p, { root: dir }), `${p} has a derived floor`).not.toThrow()
    }
  })

  it('every NON-overridable allowed path has NO floor — no dead resolver entry survives', () => {
    const dir = blindRepo()
    const nonOverridable = [...ALLOWED_PATHS].filter((p) => !OVERRIDABLE_PATHS.has(p))
    expect(nonOverridable.length).toBeGreaterThan(0) // non-vacuity
    for (const p of nonOverridable) {
      expect(() => resolveSetting(p, { root: dir }), `${p} must have no floor`).toThrowError(
        /no derived default/,
      )
    }
  })
})
