// SPDX-License-Identifier: Apache-2.0
//
// #2329 — `automation.affinityBatching` was a live, wizard-surfaced, documented knob
// whose engine (`src/affinity/`) was deleted in the #1817 B-prune. Its only surviving
// consumer was one advisory English sentence in `planAction`, while `.claude/commands/
// ship.md` + the shipped template promised an **Affinity** line that no code emits.
//
// This suite pins the DELETION, and specifically the half-deletion failure mode: a knob
// removed from the schema but still ACCEPTED (then ignored) by a CLI or recipe path.
// Every write surface must REJECT it; every doc surface must stop promising it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject } from '../helpers.js'
import {
  runConfigure,
  ALLOWED_PATHS,
  OVERRIDABLE_PATHS,
  assertOverridablePath,
} from '../../src/commands/configure.js'
import { SETTINGS_PATHS } from '../../src/commands/settings.js'
import { RecipeSchema } from '../../src/recipes/schema.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'
import { shipStepFor, buildShipStepLines } from '../../src/commands/task-ship.js'
import type { ShipProfile } from '../../src/commands/ship-profile.js'
import { CONSUMER_DEFAULT_PROFILE } from '../../src/commands/ship-profile.js'

const REMOVED_PATH = 'automation.affinityBatching'

function writeV2Config(dir: string): void {
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify(
      {
        version: '0.2',
        tools: ['claude'],
        governanceLevel: 'L2',
        useGitHub: false,
        features: {
          contractTesting: false,
          mutationTesting: true,
          securityScanning: true,
          evidenceHarness: false,
          debtGates: true,
          suppressions: true,
        },
        thresholds: { ...DEFAULT_THRESHOLDS.L2 },
        automation: { autonomy: 'L0' },
      },
      null,
      2,
    ),
  )
}

function readArbiterJson(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<string, unknown>
}

// ── the half-deletion guard: every write surface REJECTS the removed path ──────

describe('#2329 — the removed knob is rejected, never silently accepted', () => {
  let dir: string
  beforeEach(() => {
    dir = createTestProject('typescript')
    writeV2Config(dir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('`arbiter configure --set automation.affinityBatching=true` is REJECTED (E_UNKNOWN_PATH)', async () => {
    await expect(runConfigure({ dir, sets: [`${REMOVED_PATH}=true`] })).rejects.toMatchObject({
      code: 'E_UNKNOWN_PATH',
    })
    // and nothing was persisted
    const automation = readArbiterJson(dir)['automation'] as Record<string, unknown>
    expect(automation).not.toHaveProperty('affinityBatching')
  })

  it('NEGATIVE CONTROL — a surviving automation path still round-trips through configure', async () => {
    await runConfigure({ dir, sets: ['automation.maxParallelWorktrees=3'] })
    const automation = readArbiterJson(dir)['automation'] as Record<string, unknown>
    expect(automation['maxParallelWorktrees']).toBe(3)
  })

  it('the per-run `ship --set` guard rejects it too (assertOverridablePath)', () => {
    expect(() => assertOverridablePath(REMOVED_PATH)).toThrowError(/E_UNKNOWN_PATH|unknown/i)
    // NEGATIVE CONTROL: a surviving overridable path is still accepted.
    // (#2333 retired automation.maxParallelWorktrees as an override target — it is
    // still an ALLOWED_PATH, asserted below, just no longer a per-run one.)
    expect(() => assertOverridablePath('automation.defaultGateLevel')).not.toThrow()
  })

  it('the path is gone from ALLOWED_PATHS, OVERRIDABLE_PATHS and the settings catalog', () => {
    expect(ALLOWED_PATHS.has(REMOVED_PATH)).toBe(false)
    expect(OVERRIDABLE_PATHS.has(REMOVED_PATH)).toBe(false)
    expect(SETTINGS_PATHS.has(REMOVED_PATH)).toBe(false)
    // NEGATIVE CONTROL: the sibling prefs are untouched.
    expect(ALLOWED_PATHS.has('automation.maxParallelWorktrees')).toBe(true)
    expect(SETTINGS_PATHS.has('automation.defaultGateLevel')).toBe(true)
  })

  it('a recipe carrying automation.affinityBatching is REJECTED, not silently stripped', () => {
    const parsed = RecipeSchema.safeParse({
      automation: { autonomy: 'L0', affinityBatching: true },
    })
    expect(parsed.success).toBe(false)
    // NEGATIVE CONTROL: the same recipe without the removed key parses.
    expect(
      RecipeSchema.safeParse({
        automation: { autonomy: 'L0', maxParallelWorktrees: 2 },
      }).success,
    ).toBe(true)
  })
})

// ── the doc surfaces stop promising an Affinity line no code emits ────────────

describe('#2329 — no doc, self or generated, promises the phantom Affinity line', () => {
  // Globbed, not enumerated: a future generated copy is caught automatically.
  const DOC_GLOBS = [
    '.claude/commands/ship.md',
    '.claude/skills/wave-drain/SKILL.md',
    'src/templates/claude/commands/ship.md.ejs',
    'src/templates/claude/skills/wave-drain/SKILL.md.ejs',
    'examples/python-library/.claude/commands/ship.md',
    'examples/python-library/.claude/skills/wave-drain/SKILL.md',
    'examples/ts-library/.claude/commands/ship.md',
    'examples/ts-library/.claude/skills/wave-drain/SKILL.md',
    'examples/go-library/.claude/commands/ship.md',
    'examples/go-library/.claude/skills/wave-drain/SKILL.md',
  ]

  it('every ship/wave-drain doc copy (self, template, examples) is affinity-free', () => {
    const offenders: string[] = []
    for (const rel of DOC_GLOBS) {
      if (!existsSync(rel)) continue
      const src = readFileSync(rel, 'utf-8')
      for (const [i, line] of src.split('\n').entries()) {
        if (/affinit/i.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('at least the four canonical copies actually exist (the glob is not vacuous)', () => {
    expect(DOC_GLOBS.filter((p) => existsSync(p)).length).toBeGreaterThanOrEqual(4)
  })
})

// ── the ship step keeps working; the profile no longer carries the dead field ──

describe('#2329 — ship output is unchanged apart from the removal', () => {
  const profile = (over: Partial<ShipProfile> = {}): ShipProfile => ({
    ...CONSUMER_DEFAULT_PROFILE,
    ...over,
  })

  it('the plan step emits the plain single-issue action, with no batching prose', () => {
    const step = shipStepFor('plan', 'Standard', profile())
    expect(step.action).toBe('Write the plan, then pass the plan-review gate.')
    expect(step.action).not.toMatch(/affinit|parallel worktrees/i)
    expect(step.command).toBe('arbiter verify plan <plan-file>')
  })

  it('NEGATIVE CONTROL — buildShipStepLines still renders a normal ship step', () => {
    const lines = buildShipStepLines({
      phase: 'verification',
      step: shipStepFor('verification', 'Standard', profile()),
      advanced: false,
      done: false,
      tier: 'Standard',
      profile: profile(),
    })
    const text = lines.join('\n')
    expect(text).toMatch(/Phase:/)
    expect(text).toMatch(/Action:/)
    expect(text).toMatch(/Command:/)
    expect(text).not.toMatch(/Affinity/i)
  })

  it('ShipProfile no longer carries an affinityBatching field', () => {
    expect(CONSUMER_DEFAULT_PROFILE).not.toHaveProperty('affinityBatching')
  })
})
