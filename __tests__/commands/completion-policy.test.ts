// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { resolveEvidenceCompletionPolicy } from '../../src/commands/completion-policy'

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
})
