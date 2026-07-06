// SPDX-License-Identifier: Apache-2.0
//
// #1748 — e2e contract for the #1730 companion "if present" guarantee. Unit tests already cover
// `resolveCompanions` and the render helpers with INJECTED profile objects (ship-profile.test.ts,
// companions.test.ts), but nothing before this drove the full wiring — detection (real Claude-home
// filesystem scan) → resolution (resolveShipProfile) → ship output (buildShipStepLines) — end to
// end. A future refactor could sever that wiring while every unit test, mocked at the seam it
// broke, stayed green.
//
// Contract lives at the seam consumers actually see (the rendered `arbiter ship` step output), so
// it survives internal refactors of companions.ts (per the issue's design note). No profile object
// is ever hand-built here: every scenario resolves a real ShipProfile from a real tmp `claudeHome`
// (and, for the spoof case, a real tmp target repo) via `resolveShipProfile` itself.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveShipProfile, type ShipProfile } from '../../src/commands/ship-profile.js'
import {
  shipStepFor,
  buildShipStepLines,
  verticalsForTier,
  type ShipResult,
} from '../../src/commands/task-ship.js'
import type { TaskPhase } from '../../src/commands/task-state.js'
import {
  companionGreenInstruction,
  companionStatusLine,
} from '../../src/integrations/companions.js'

const dirs: string[] = []
function tmpRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-companion-contract-repo-'))
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

const pkg = (name: string): string => JSON.stringify({ name, version: '1.0.0' })

/** A guaranteed-companion-free Claude home: the path is never created, so the detector's early
 * `existsSync` check short-circuits — deterministic regardless of what the runner happens to have
 * installed under its real `~/.claude`. */
const EMPTY_HOME = join(tmpdir(), 'arbiter-companion-contract-no-companion-home')

/** A real Claude home containing an installed ponytail companion skill. */
function homeWithPonytail(): string {
  const home = mkdtempSync(join(tmpdir(), 'arbiter-companion-contract-home-'))
  dirs.push(home)
  const skill = join(home, 'plugins', 'cache', 'ponytail', '4.8.4', 'skills', 'ponytail')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), `---\nname: ponytail\nversion: 4.8.4\n---\n# Ponytail\n`)
  return home
}

/** A target repo with a ponytail plugin layout committed INSIDE it (the spoof attempt) — never a
 * real Claude home. Detection is HOME-ONLY (companions.ts hardcodes `targetDir: ''`), so this must
 * be invisible to resolution regardless of what `claudeHome` is passed. */
function repoWithSpoofedPlugin(): string {
  const dir = tmpRepo({ 'package.json': pkg('acme-app') })
  const skill = join(dir, '.claude', 'plugins', 'cache', 'ponytail', '4.8.4', 'skills', 'ponytail')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), `---\nname: ponytail\nversion: 4.8.4\n---\n# Ponytail\n`)
  return dir
}

const STANDARD_TIER = 'Standard'

/**
 * Drive the real end-to-end pipeline a ship invocation uses: resolve the profile from `root` +
 * `claudeHome` (real filesystem scan, no injected profile), compute the green-phase step from that
 * profile, then render the full step-output lines a human/agent would see. Returns the resolved
 * profile alongside the lines so a scenario can assert on both without a second resolution.
 */
function renderGreenStep(
  root: string,
  claudeHome: string,
): { lines: string[]; profile: ShipProfile } {
  const phase: TaskPhase = 'green'
  const profile = resolveShipProfile(root, { claudeHome })
  const step = shipStepFor(phase, STANDARD_TIER, profile)
  const result: ShipResult = { phase, step, advanced: false, done: false, profile }
  return { lines: buildShipStepLines(result, STANDARD_TIER), profile }
}

describe('companion contract — e2e (#1748)', () => {
  it('present: ponytail installed in claudeHome composes the green action and announces itself', () => {
    const root = tmpRepo({ 'package.json': pkg('acme-app') })
    const { lines, profile } = renderGreenStep(root, homeWithPonytail())

    // Wiring guard (acceptance #3): fails if resolveCompanions stops being reached by the
    // profile-resolution path — a real filesystem scan found ponytail, not an injected double.
    expect(profile.companions.map((c) => c.label)).toEqual(['ponytail'])

    const instruction = companionGreenInstruction(profile.companions)
    expect(instruction.length).toBeGreaterThan(0)
    expect(lines).toContain(`Action: Implement the minimum to make the tests pass. ${instruction}`)
    expect(lines).toContain(
      `Companion: ${companionStatusLine(profile.companions)} · arbiter gates remain the safety net`,
    )
  })

  it('absent: no companion anywhere → full output is byte-identical to the pre-companion baseline', () => {
    const root = tmpRepo({ 'package.json': pkg('acme-app') })
    const { lines, profile } = renderGreenStep(root, EMPTY_HOME)

    expect(profile.companions).toEqual([])
    // Full-array equality (acceptance #2): byte identity, not merely "no Companion: line".
    expect(lines).toEqual([
      'Phase: green',
      'Action: Implement the minimum to make the tests pass.',
      `Tier: ${STANDARD_TIER} · verticals: ${verticalsForTier(STANDARD_TIER).join(', ')}`,
      'Governance: L2',
      'Autonomy: L0',
    ])
  })

  it('spoof: plugin layout committed inside the target repo is inert — byte-identical to absent', () => {
    const spoofedRoot = repoWithSpoofedPlugin()
    const cleanRoot = tmpRepo({ 'package.json': pkg('acme-app') })

    const spoofed = renderGreenStep(spoofedRoot, EMPTY_HOME)
    const clean = renderGreenStep(cleanRoot, EMPTY_HOME)

    expect(spoofed.profile.companions).toEqual([])
    expect(spoofed.lines).toEqual(clean.lines)
    expect(spoofed.lines.some((l) => l.startsWith('Companion:'))).toBe(false)
  })
})
