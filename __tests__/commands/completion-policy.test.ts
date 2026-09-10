// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import {
  resolveDirectCompletionPolicy,
  resolveEvidenceCompletionPolicy,
} from '../../src/commands/pr-merged'

describe('resolveEvidenceCompletionPolicy (#2638)', () => {
  it('AC-1/AC-2: selects reviewed-pr for an explicitly permitted gated-review harness', () => {
    expect(
      resolveEvidenceCompletionPolicy({
        collaborationMode: 'gated-review',
        permitGitHub: true,
        features: { evidenceHarness: true },
      }),
    ).toEqual({ ok: true, policy: 'reviewed-pr' })
  })

  it('AC-4: refuses a legacy useGitHub alias without raw permitGitHub', () => {
    expect(
      resolveEvidenceCompletionPolicy({
        collaborationMode: 'peer-review',
        useGitHub: true,
        features: { evidenceHarness: true },
      }),
    ).toMatchObject({ ok: false })
  })

  it('AC-3: selects direct only for explicit trunk-solo direct mode', () => {
    expect(
      resolveEvidenceCompletionPolicy({
        collaborationMode: 'trunk-solo',
        permitGitHub: true,
        solo: { mergeMode: 'direct' },
        features: { evidenceHarness: true },
      }),
    ).toEqual({ ok: true, policy: 'direct' })
  })

  it('AC-1: refuses a harness without a raw collaboration mode', () => {
    expect(resolveEvidenceCompletionPolicy({ features: { evidenceHarness: true } })).toMatchObject({
      ok: false,
    })
  })

  it('AC-3: refuses --no-pr authorization outside raw trunk-solo direct mode', () => {
    expect(
      resolveDirectCompletionPolicy({
        collaborationMode: 'peer-review',
        permitGitHub: true,
      }),
    ).toMatchObject({ ok: false })
  })
})
