// SPDX-License-Identifier: Apache-2.0
//
// #1288 — de-self-only the `arbiter ship` engine: resolve a runtime ShipProfile from the
// TARGET repo's arbiter.json (not arbiter-self assumptions) and detect arbiter-self by the
// unique npm package name. Crash-safe (malformed config/package.json must NOT throw).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveShipProfile,
  isArbiterSelf,
  autonomyAllows,
  buildShipOverrides,
  CONSUMER_DEFAULT_PROFILE,
} from '../../src/commands/ship-profile.js'
import { writeOverride, readOverride } from '../../src/commands/task-state.js'
import { shipStepFor } from '../../src/commands/task-ship.js'

const dirs: string[] = []
function tmpRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-shipprofile-'))
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

// #1730 — a guaranteed-companion-free Claude home so profile-equality assertions stay
// deterministic regardless of what the test runner happens to have installed in ~/.claude.
const EMPTY_HOME = join(tmpdir(), 'arbiter-shipprofile-no-companion-home')

const pkg = (name: string): string => JSON.stringify({ name, version: '1.0.0' })
const cfg = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    version: '2.0.0',
    governanceLevel: 'L2',
    tools: {},
    features: {},
    thresholds: {},
    ...extra,
  })

// #2047 — `cfg()`'s `version: '2.0.0'` is not the real v2 marker (that's the string '0.2';
// migrate() routes anything else through the v0→v1→v2 chain, which REBUILDS `features` from
// a fixed set of derived keys and drops any other key — including `features.soloDevMode`, the
// legacy alias under test). A real, currently-authored arbiter.json (this repo's own) carries
// `version: '0.2'`, which migrateV1ToV2 passes through via `validateConfig` unchanged — the
// only path that preserves `features.soloDevMode` verbatim. Full, schema-valid shape (mirrors
// this repo's own arbiter.json) so the v0.2 passthrough branch validates.
const cfgV2 = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    version: '0.2',
    governanceLevel: 'L2',
    tools: ['claude'],
    permitGitHub: false,
    features: {
      debtGates: true,
      suppressions: true,
      securityScanning: true,
      mutationTesting: true,
      contractTesting: false,
      evidenceHarness: false,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
    decomposition: { backend: 'markdown' },
    ...extra,
  })

describe('resolveShipProfile — reads the TARGET repo arbiter.json (#1288)', () => {
  it('consumer repo (peer-review) → not self, peer-review, pr-ff, L2', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'peer-review' }),
    })
    expect(resolveShipProfile(dir, { claudeHome: EMPTY_HOME })).toEqual({
      isArbiterSelf: false,
      collaborationMode: 'peer-review',
      mergeMode: 'pr-ff',
      governanceLevel: 'L2',
      autonomy: 'L0',
      // #1306 — no automation block ⇒ resolver derived floor.
      defaultGateLevel: 'L1',
      // #1730 — no companion installed in the injected home.
      companions: [],
    })
  })

  it('consumer trunk-solo + solo.mergeMode:direct → mergeMode direct (RT-02 override honored)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'direct' } }),
    })
    const p = resolveShipProfile(dir)
    expect(p.collaborationMode).toBe('trunk-solo')
    expect(p.mergeMode).toBe('direct')
  })

  it('explicit collaborationMode field is authoritative over the legacy features.soloDevMode alias (RT-03)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo' }),
    })
    expect(resolveShipProfile(dir).collaborationMode).toBe('trunk-solo')
  })

  it(
    '#2047 — a consumer with ONLY the legacy features.soloDevMode:true alias (no explicit ' +
      'collaborationMode) resolves to trunk-solo/direct, not the peer-review default',
    () => {
      // No migration derives collaborationMode from features.soloDevMode (verified: no such
      // mapping exists under src/config/migrations/), so collaborationProfile bridges the alias
      // itself. Before #2047 this silently resolved to 'peer-review' — the opposite of the
      // flag's declared intent (a PR-gated ship for a repo that asked to skip PRs).
      const dir = tmpRepo({
        'package.json': pkg('acme-app'),
        'arbiter.json': cfgV2({
          features: {
            debtGates: true,
            suppressions: true,
            securityScanning: true,
            mutationTesting: true,
            contractTesting: false,
            evidenceHarness: false,
            soloDevMode: true,
          },
        }),
      })
      const profile = resolveShipProfile(dir)
      expect(profile.collaborationMode).toBe('trunk-solo')
      expect(profile.mergeMode).toBe('direct')
    },
  )

  it(
    '#2047 — explicit collaborationMode still wins when BOTH the canonical field and the ' +
      'legacy soloDevMode alias are present',
    () => {
      const dir = tmpRepo({
        'package.json': pkg('acme-app'),
        'arbiter.json': cfgV2({
          collaborationMode: 'peer-review',
          features: {
            debtGates: true,
            suppressions: true,
            securityScanning: true,
            mutationTesting: true,
            contractTesting: false,
            evidenceHarness: false,
            soloDevMode: true,
          },
        }),
      })
      expect(resolveShipProfile(dir).collaborationMode).toBe('peer-review')
    },
  )

  it('malformed arbiter.json → safe defaults, never throws (RT-01)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': '{ this is not valid json',
    })
    expect(() => resolveShipProfile(dir, { claudeHome: EMPTY_HOME })).not.toThrow()
    expect(resolveShipProfile(dir, { claudeHome: EMPTY_HOME })).toEqual(CONSUMER_DEFAULT_PROFILE)
  })

  it('absent arbiter.json → consumer-safe defaults (peer-review / pr-ff / L2)', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme-app') })
    expect(resolveShipProfile(dir, { claudeHome: EMPTY_HOME })).toEqual(CONSUMER_DEFAULT_PROFILE)
  })

  it('arbiter-self (pkg @arbiter/cli, trunk-solo + pr-ff) → isArbiterSelf true', () => {
    const dir = tmpRepo({
      'package.json': pkg('@arbiter/cli'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'pr-ff' } }),
    })
    expect(resolveShipProfile(dir, { claudeHome: EMPTY_HOME })).toEqual({
      isArbiterSelf: true,
      collaborationMode: 'trunk-solo',
      mergeMode: 'pr-ff',
      governanceLevel: 'L2',
      autonomy: 'L0',
      // #1306 — no automation block ⇒ resolver derived floor.
      defaultGateLevel: 'L1',
      // #1730 — arbiter-self never activates a companion (guard at resolution).
      companions: [],
    })
  })
})

// #1730 — companion resolution is threaded onto the ShipProfile: HOME-installed → active on a
// product repo, never on arbiter-self, and disableable via arbiter.json.
describe('resolveShipProfile — companion plugins (#1730)', () => {
  function homeWithPonytail(): string {
    const home = mkdtempSync(join(tmpdir(), 'arbiter-shipprofile-home-'))
    dirs.push(home)
    const skill = join(home, 'plugins', 'cache', 'ponytail', '4.8.4', 'skills', 'ponytail')
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), `---\nname: ponytail\nversion: 4.8.4\n---\n# Ponytail\n`)
    return home
  }

  it('product repo + ponytail installed in home → companion active (full)', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme-app') })
    const p = resolveShipProfile(dir, { claudeHome: homeWithPonytail() })
    expect(p.companions.map((c) => c.label)).toEqual(['ponytail'])
    expect(p.companions[0]?.mode).toBe('full')
  })

  it('stored java language resolves the companion to lite mode', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'pom.xml': '<project />',
      'arbiter.json': cfg({ language: 'java' }),
    })
    const p = resolveShipProfile(dir, { claudeHome: homeWithPonytail() })
    expect(p.companions[0]?.mode).toBe('lite')
  })

  it('falls back to existing stack detection when no language is stored', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'pom.xml': '<project />',
    })
    const p = resolveShipProfile(dir, { claudeHome: homeWithPonytail() })
    expect(p.companions[0]?.mode).toBe('lite')
  })

  it('explicit companion override still beats the stack default inside ship-profile', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'pom.xml': '<project />',
      'arbiter.json': cfg({ language: 'java', companions: { ponytail: { mode: 'full' } } }),
    })
    const p = resolveShipProfile(dir, { claudeHome: homeWithPonytail() })
    expect(p.companions[0]?.mode).toBe('full')
  })

  it('arbiter-self + ponytail installed → NO companion (self guard)', () => {
    const dir = tmpRepo({ 'package.json': pkg('@arbiter/cli') })
    const p = resolveShipProfile(dir, { claudeHome: homeWithPonytail() })
    expect(p.companions).toEqual([])
  })

  it('arbiter.json companions.ponytail.enabled=false disables it', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ companions: { ponytail: { enabled: false } } }),
    })
    const p = resolveShipProfile(dir, { claudeHome: homeWithPonytail() })
    expect(p.companions).toEqual([])
  })
})

// #1306 (ADR-094 §Decision.4) — the orchestration prefs resolve through the SAME
// unified resolver as autonomy: verification reads defaultGateLevel, all from one
// ShipProfile. (#2329 removed the third pref, affinityBatching.)
describe('resolveShipProfile — Project-Profile orchestration prefs (#1306)', () => {
  it('surfaces persisted automation prefs from arbiter.json', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({
        collaborationMode: 'peer-review',
        automation: {
          autonomy: 'L1',
          maxParallelWorktrees: 3,
          defaultGateLevel: 'L2',
        },
      }),
    })
    const p = resolveShipProfile(dir)
    expect(p.defaultGateLevel).toBe('L2')
    // #2333 — maxParallelWorktrees is a persistent-only knob now; it never reaches
    // the profile even when arbiter.json sets it.
    expect(Object.keys(p)).not.toContain('maxParallelWorktrees')
  })

  it('per-run --set overrides the persisted prefs (override layer wins)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({
        collaborationMode: 'peer-review',
        automation: {
          autonomy: 'L0',
          maxParallelWorktrees: 3,
          defaultGateLevel: 'L2',
        },
      }),
    })
    const overrides = buildShipOverrides(dir, {
      sets: ['automation.defaultGateLevel=L1'],
    })
    const p = resolveShipProfile(dir, { overrides })
    expect(p.defaultGateLevel).toBe('L1')
    // #2333 — the sibling path is no longer an override target at all.
    expect(() =>
      buildShipOverrides(dir, { sets: ['automation.maxParallelWorktrees=1'] }),
    ).toThrowError(/E_UNKNOWN_PATH|unknown/i)
  })

  it('absent automation block ⇒ derived floors, never throws (RT-1306-04)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'peer-review' }),
    })
    let p!: ReturnType<typeof resolveShipProfile>
    expect(() => {
      p = resolveShipProfile(dir)
    }).not.toThrow()
    expect(p.defaultGateLevel).toBe('L1')
  })
})

describe('isArbiterSelf — package-name signal, rooted, crash-safe (#1288 RT-04/09)', () => {
  it('true only for the unique @arbiter/cli package name', () => {
    const self = tmpRepo({ 'package.json': pkg('@arbiter/cli') })
    expect(isArbiterSelf(self)).toBe(true)
  })

  it('false for a consumer even if it has a src/templates dir (no path false-positive, RT-04)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-codegen'),
      'src/templates/x.ejs': '<%= 1 %>',
      'src/invariants/catalog.ts': 'export const x = 1',
    })
    expect(isArbiterSelf(dir)).toBe(false)
  })

  it('false (no throw) when package.json is missing or malformed (RT-09)', () => {
    const missing = tmpRepo({ 'arbiter.json': cfg({}) })
    expect(isArbiterSelf(missing)).toBe(false)
    const malformed = tmpRepo({ 'package.json': '{ broken' })
    expect(isArbiterSelf(malformed)).toBe(false)
  })

  it('resolves against the passed root, not process.cwd() (RT-09)', () => {
    const dir = tmpRepo({ 'package.json': pkg('@arbiter/cli') })
    // cwd is the arbiter worktree (also @arbiter/cli) — assert the function honors `dir`
    const consumer = tmpRepo({ 'package.json': pkg('other') })
    expect(isArbiterSelf(dir)).toBe(true)
    expect(isArbiterSelf(consumer)).toBe(false)
  })
})

// ─── #1291 — autonomy resolution + grants ─────────────────────────────────────

describe('autonomy resolution (#1291): flag > config > L0 default', () => {
  it('defaults to L0 with no config and no override', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    expect(resolveShipProfile(dir).autonomy).toBe('L0')
    expect(CONSUMER_DEFAULT_PROFILE.autonomy).toBe('L0')
  })

  it('reads automation.autonomy from arbiter.json', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L2' } }),
    })
    expect(resolveShipProfile(dir).autonomy).toBe('L2')
  })

  it('a valid override beats the config', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L1' } }),
    })
    expect(resolveShipProfile(dir, { autonomyOverride: 'L3' }).autonomy).toBe('L3')
  })

  it('an invalid override is warn-ignored, falling back to config (fail-closed)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L1' } }),
    })
    expect(resolveShipProfile(dir, { autonomyOverride: 'turbo' }).autonomy).toBe('L1')
  })

  it('an invalid level in arbiter.json degrades the whole profile to consumer defaults (RT-L1)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L9' } }),
    })
    const p = resolveShipProfile(dir)
    expect(p.autonomy).toBe('L0')
    expect(p.collaborationMode).toBe(CONSUMER_DEFAULT_PROFILE.collaborationMode)
  })

  // #1261 (D6): migration semantics — pre-existing repos whose arbiter.json
  // predates the profile block (no `automation` key) MUST resolve to L0.
  // No $schemaVersion bump; absent ⇒ L0 is the permanent contract.
  it('a config WITHOUT an automation block resolves autonomy L0 (#1261 migration pin)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ collaborationMode: 'gated-review' }),
    })
    const p = resolveShipProfile(dir)
    expect(p.autonomy).toBe('L0')
    // the rest of the profile still resolves from the config, not defaults
    expect(p.collaborationMode).toBe('gated-review')
  })
})

// ─── #1305 — desugar + session-stickiness through the unified resolver ─────────

describe('autonomy via unified resolver (#1305, ADR-094)', () => {
  it('--set automation.autonomy=L3 desugars to the same profile as --autonomy L3', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L0' } }),
    })
    const viaAutonomy = resolveShipProfile(dir, { autonomyOverride: 'L3' })
    const viaSet = resolveShipProfile(dir, { overrides: { 'automation.autonomy': 'L3' } })
    expect(viaSet.autonomy).toBe('L3')
    expect(viaSet).toEqual(viaAutonomy)
  })

  it('autonomy is session-sticky: a persisted session value survives with no per-run override (RT — /clear)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L1' } }),
    })
    writeOverride(dir, 'automation.autonomy', 'L2')
    // No override passed: emulates a post-/clear ship re-entry.
    expect(resolveShipProfile(dir).autonomy).toBe('L2')
  })

  it('a per-run override still beats a sticky session value', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme'),
      'arbiter.json': cfg({ automation: { autonomy: 'L1' } }),
    })
    writeOverride(dir, 'automation.autonomy', 'L2')
    expect(resolveShipProfile(dir, { autonomyOverride: 'L3' }).autonomy).toBe('L3')
  })
})

describe('buildShipOverrides — --set grammar + desugar (#1305, ADR-094)', () => {
  it('parses --set and persists it to the session layer (survives /clear)', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    const overrides = buildShipOverrides(dir, { sets: ['automation.autonomy=L2'] })
    expect(overrides).toEqual({ 'automation.autonomy': 'L2' })
    expect(readOverride(dir, 'automation.autonomy')).toBe('L2')
  })

  it('--autonomy desugars to --set automation.autonomy=<level>', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    const overrides = buildShipOverrides(dir, { autonomy: 'L3' })
    expect(overrides).toEqual({ 'automation.autonomy': 'L3' })
    expect(readOverride(dir, 'automation.autonomy')).toBe('L3')
  })

  it('refuses a non-overridable path (RT-01: governanceLevel not per-run-flippable)', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    expect(() => buildShipOverrides(dir, { sets: ['governanceLevel=L1'] })).toThrow()
    // and nothing was persisted
    expect(readOverride(dir, 'governanceLevel')).toBeUndefined()
  })

  it('refuses a malformed value via the catalog validator (parseValue reuse)', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    expect(() => buildShipOverrides(dir, { sets: ['automation.autonomy=turbo'] })).toThrow()
  })

  it('rejects a --set with no = separator', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    expect(() => buildShipOverrides(dir, { sets: ['automation.autonomy'] })).toThrow()
  })

  it('an explicit --set automation.autonomy wins over --autonomy sugar', () => {
    const dir = tmpRepo({ 'package.json': pkg('acme') })
    const overrides = buildShipOverrides(dir, {
      autonomy: 'L1',
      sets: ['automation.autonomy=L3'],
    })
    expect(overrides['automation.autonomy']).toBe('L3')
  })
})

describe('autonomyAllows grants (#1291): adjacent levels differ mechanically', () => {
  const TABLE = [
    ['L0', []],
    ['L1', ['auto-advance', 'auto-merge']],
    ['L2', ['auto-advance', 'auto-merge', 'fix-on-red-attempt']],
    [
      'L3',
      [
        'auto-advance',
        'auto-merge',
        'fix-on-red-attempt',
        'wave-batch',
        'fix-on-red-autopush',
        'subagent-auto-spawn',
      ],
    ],
  ] as const
  const ALL = [
    'auto-advance',
    'auto-merge',
    'fix-on-red-attempt',
    'wave-batch',
    'fix-on-red-autopush',
    'subagent-auto-spawn',
  ] as const

  it.each(TABLE)('%s unlocks exactly its documented set', (level, granted) => {
    for (const b of ALL) {
      expect(autonomyAllows(level, b), `${level}:${b}`).toBe(
        (granted as readonly string[]).includes(b),
      )
    }
  })

  it('every adjacent pair differs (no map-fiction, RT-H1)', () => {
    for (let i = 1; i < TABLE.length; i++) {
      const prev = new Set(TABLE[i - 1][1])
      const next = new Set(TABLE[i][1])
      expect(next.size).toBeGreaterThan(prev.size)
    }
  })
})

// #2102 — `--chain` composes with the (collaborationMode × mergeMode) axis WITHOUT changing it.
// A real peer-review repo, resolved through the actual `resolveShipProfile` (not a hand-built
// mock profile), must still get a one-PR close action with a declared chain — never a direct
// push. This is the exact acceptance-criterion test from #2102 (AC-2102.3).
describe('shipStepFor(complete) — --chain composes with a real resolved profile (#2102)', () => {
  it('peer-review repo + --chain → complete step is still a PR close action, never direct push', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'peer-review' }),
    })
    const profile = resolveShipProfile(dir, { claudeHome: EMPTY_HOME })
    const action = shipStepFor('complete', 'Standard', profile, '#2102', ['#2103', '#2104']).action
    expect(action).toMatch(/open a PR/i)
    expect(action).toMatch(/await required review/i)
    expect(action).not.toMatch(/no PR/i)
    expect(action).toContain('Close issues #2102, #2103, #2104')
  })

  it('trunk-solo + direct repo + --chain → STILL direct push, no PR (axis unaffected either way)', () => {
    const dir = tmpRepo({
      'package.json': pkg('acme-app'),
      'arbiter.json': cfg({ collaborationMode: 'trunk-solo', solo: { mergeMode: 'direct' } }),
    })
    const profile = resolveShipProfile(dir, { claudeHome: EMPTY_HOME })
    const action = shipStepFor('complete', 'Standard', profile, '#2102', ['#2103']).action
    expect(action).toMatch(/no PR/i)
    expect(action).toContain('Close issues #2102, #2103')
  })
})
