// SPDX-License-Identifier: Apache-2.0
import { runCli } from '../utils/run-cli.js'
import { classifyGhError, type GhErrorKind } from './classify-gh-error.js'

export interface BranchProtectionResult {
  applied: boolean
  error: string | null
  errorKind?: GhErrorKind
}

/**
 * Apply branch protection to main via gh api.
 * When soloDevMode=true applies permissive policy (INV-23 still bans direct push;
 * PR remains, only review/CI gates relaxed). INV-59 parity check guards merge.
 * Requires repo admin access.
 */
export function applyBranchProtection(
  owner: string,
  repo: string,
  soloDevMode = false,
): BranchProtectionResult {
  const payload = soloDevMode
    ? JSON.stringify({
        required_status_checks: null,
        enforce_admins: false,
        required_pull_request_reviews: null,
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false,
      })
    : JSON.stringify({
        required_status_checks: {
          strict: true,
          contexts: ['CI Required'],
        },
        enforce_admins: false,
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
        },
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false,
      })

  try {
    runCli(
      'gh',
      ['api', `repos/${owner}/${repo}/branches/main/protection`, '--method', 'PUT', '--input', '-'],
      { input: payload },
    )
    return { applied: true, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { applied: false, error: msg, errorKind: classifyGhError(err) }
  }
}
