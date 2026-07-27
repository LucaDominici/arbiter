// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  EXACT_SHA_BRANCH_SETTINGS,
  EXACT_SHA_REPO_SETTINGS,
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
