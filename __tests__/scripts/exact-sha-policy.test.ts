// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXACT_SHA_BRANCH_SETTINGS,
  EXACT_SHA_REPO_SETTINGS,
  LANDING_CONTRACT,
  TRUSTED_UPDATER_ISSUE,
  resolveLandingContract,
  validateLiveExactShaPolicy,
} from '../../scripts/lib/exact-sha-policy.mjs'

describe('exact-SHA landing policy (#2148, INV-101)', () => {
  const repo = { ...EXACT_SHA_REPO_SETTINGS }
  const protection = {
    required_linear_history: { enabled: EXACT_SHA_BRANCH_SETTINGS.required_linear_history },
    required_status_checks: { strict: true, contexts: ['CI Required'] },
    enforce_admins: { enabled: false },
    allow_force_pushes: { enabled: EXACT_SHA_BRANCH_SETTINGS.allow_force_pushes },
    allow_deletions: { enabled: EXACT_SHA_BRANCH_SETTINGS.allow_deletions },
  }

  it('accepts the GitHub-compatible CAS policy', () => {
    expect(validateLiveExactShaPolicy(repo, protection)).toEqual([])
  })

  it.each([
    ['allow_rebase_merge', true],
    ['allow_squash_merge', true],
    ['allow_merge_commit', false],
  ] as const)('rejects repo drift: %s=%s', (key, value) => {
    expect(validateLiveExactShaPolicy({ ...repo, [key]: value }, protection)).toContainEqual(
      expect.stringContaining(key),
    )
  })

  it('rejects required_linear_history because GitHub makes the repo tuple inoperable', () => {
    expect(
      validateLiveExactShaPolicy(repo, {
        ...protection,
        required_linear_history: { enabled: true },
      }),
    ).toContainEqual(expect.stringContaining('required_linear_history'))
  })

  it('rejects force-push or deletion drift', () => {
    expect(
      validateLiveExactShaPolicy(repo, {
        ...protection,
        allow_force_pushes: { enabled: true },
        allow_deletions: { enabled: true },
      }),
    ).toHaveLength(2)
  })

  it('rejects a missing required CI context or enforced admins', () => {
    const errors = validateLiveExactShaPolicy(repo, {
      ...protection,
      required_status_checks: { strict: true, contexts: [] },
      enforce_admins: { enabled: true },
    })
    expect(errors).toContainEqual(expect.stringContaining('CI Required'))
    expect(errors).toContainEqual(expect.stringContaining('enforce_admins'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #2150 — the mode-aware landing contract (AC-5).
//
// One table, three arcs, no defaults. `trunk-solo` is the only arc that buys the
// `main == gatedHeadSha` contract; `peer-review` and `gated-review` are DECLARED
// and refused, pointing at the deferred trusted-updater work (#2289). An absent
// arc would read as "never considered" — an unsupported arc reads as "known,
// refused and tracked".
// ─────────────────────────────────────────────────────────────────────────────

const UNSUPPORTED_MODES = ['peer-review', 'gated-review'] as const

describe('LANDING_CONTRACT (#2150, AC-5)', () => {
  it('declares exactly one arc per member of the closed collaborationMode vocabulary', () => {
    expect(Object.keys(LANDING_CONTRACT).sort()).toEqual([
      'gated-review',
      'peer-review',
      'trunk-solo',
    ])
  })

  it('is frozen, arcs included — the landing table is not patchable at runtime', () => {
    expect(Object.isFrozen(LANDING_CONTRACT)).toBe(true)
    for (const arc of Object.values(LANDING_CONTRACT)) expect(Object.isFrozen(arc)).toBe(true)
  })

  it('names the deferred trusted-updater issue', () => {
    expect(TRUSTED_UPDATER_ISSUE).toBe('#2289')
  })

  it('trunk-solo is the only arc that lands the exact gated SHA', () => {
    expect(LANDING_CONTRACT['trunk-solo']).toMatchObject({
      supported: true,
      requiresTrustedUpdater: false,
      blockedOn: null,
      exactShaLanding: true,
      requiredMergeMode: 'pr-ff',
    })
  })

  it.each(UNSUPPORTED_MODES)(
    '%s is declared, unsupported, and blocked on the trusted-updater issue',
    (mode) => {
      expect(LANDING_CONTRACT[mode]).toMatchObject({
        supported: false,
        requiresTrustedUpdater: true,
        blockedOn: TRUSTED_UPDATER_ISSUE,
        exactShaLanding: false,
      })
    },
  )

  it('no unsupported arc claims exact-SHA landing', () => {
    for (const arc of Object.values(LANDING_CONTRACT)) {
      if (!arc.supported) expect(arc.exactShaLanding).toBe(false)
    }
  })
})

describe('resolveLandingContract (#2150, AC-5 + AC-3) — refuses, never defaults', () => {
  it('accepts trunk-solo + pr-ff and hands back the resolved arc', () => {
    const decision = resolveLandingContract({
      collaborationMode: 'trunk-solo',
      solo: { mergeMode: 'pr-ff' },
    })
    expect(decision.supported).toBe(true)
    expect(decision.mode).toBe('trunk-solo')
    expect(decision.arc).toBe(LANDING_CONTRACT['trunk-solo'])
  })

  it.each(UNSUPPORTED_MODES)('refuses %s and cites the deferred issue', (mode) => {
    const decision = resolveLandingContract({ collaborationMode: mode })
    expect(decision.supported).toBe(false)
    expect(decision.blockedOn).toBe(TRUSTED_UPDATER_ISSUE)
    expect(decision.reason).toContain(mode)
    expect(decision.reason).toContain(TRUSTED_UPDATER_ISSUE)
  })

  it('refuses an UNKNOWN mode rather than falling back to a supported arc', () => {
    const decision = resolveLandingContract({ collaborationMode: 'mob-programming' })
    expect(decision.supported).toBe(false)
    expect(decision.arc).toBeNull()
    expect(decision.reason).toContain('mob-programming')
  })

  it('refuses an ABSENT mode rather than defaulting to trunk-solo', () => {
    const decision = resolveLandingContract({ solo: { mergeMode: 'pr-ff' } })
    expect(decision.supported).toBe(false)
    expect(decision.mode).toBeNull()
    expect(decision.reason).toMatch(/absent|missing/i)
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'trunk-solo'],
    ['a number', 7],
    ['undefined', undefined],
    ['a non-string collaborationMode', { collaborationMode: 42 }],
  ] as const)('refuses a MALFORMED config: %s', (_label, config) => {
    const decision = resolveLandingContract(config)
    expect(decision.supported).toBe(false)
    expect(decision.reason.length).toBeGreaterThan(0)
  })

  it('refuses trunk-solo when the merge mode is not the arc-required pr-ff', () => {
    const decision = resolveLandingContract({
      collaborationMode: 'trunk-solo',
      solo: { mergeMode: 'direct' },
    })
    expect(decision.supported).toBe(false)
    expect(decision.reason).toContain('pr-ff')
  })

  it('refuses trunk-solo when the solo block is absent', () => {
    const decision = resolveLandingContract({ collaborationMode: 'trunk-solo' })
    expect(decision.supported).toBe(false)
    expect(decision.reason).toContain('pr-ff')
  })
})

describe('landing-contract wiring (#2150, AC-5) — consumers read the arc, never re-decide', () => {
  const read = (rel: string) => readFileSync(resolve(rel), 'utf8')

  it('the watcher asks the contract instead of comparing a collaborationMode literal', () => {
    const watcher = read('scripts/pr-merge-watch.mjs')
    expect(watcher).toContain('resolveLandingContract')
    expect(watcher).not.toContain("'trunk-solo'")
    expect(watcher).not.toContain('"trunk-solo"')
  })

  it('the shipped watcher twin refuses through the same contract', () => {
    const shipped = read('src/templates/scripts/pr-merge-watch.mjs.ejs')
    expect(shipped).toContain('resolveLandingContract')
    expect(shipped).not.toContain("'trunk-solo'")
  })

  it('the branch-protection applicator reports the resolved arc', () => {
    const applicator = read('scripts/apply-branch-protection.mjs')
    expect(applicator).toContain('resolveLandingContract')
  })

  it('the review branch is NOT wired here — it belongs to the deferred issue', () => {
    for (const rel of [
      'scripts/pr-merge-watch.mjs',
      'src/templates/scripts/pr-merge-watch.mjs.ejs',
      'scripts/lib/exact-sha-policy.mjs',
    ]) {
      expect(read(rel)).not.toContain('reviewDecision')
    }
  })
})
