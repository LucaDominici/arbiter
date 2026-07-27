// SPDX-License-Identifier: Apache-2.0
import { runCli } from '../utils/run-cli.js'
import { classifyGhError, type GhErrorKind } from './classify-gh-error.js'
import type { CollaborationMode } from '../wizard/types.js'

export interface BranchProtectionResult {
  applied: boolean
  error: string | null
  errorKind?: GhErrorKind
  repoSettingsApplied: boolean
  repoSettingsError: string | null
}

/**
 * Apply branch protection and repo-level merge settings via gh api.
 * Two separate API calls are required:
 *   1. PUT  /repos/{owner}/{repo}/branches/main/protection — sets required_linear_history etc.
 *   2. PATCH /repos/{owner}/{repo}                        — sets allow_squash_merge:false etc.
 * GitHub keeps these on different endpoints; PATCH-only flags are not available in branch protection.
 * INV-101: squash-merge and rebase-merge are always disabled to preserve cosign SHA attestations.
 * Requires repo admin access.
 */
export function applyBranchProtection(
  owner: string,
  repo: string,
  collaborationMode: CollaborationMode = 'peer-review',
): BranchProtectionResult {
  const isSolo = collaborationMode === 'trunk-solo'

  const branchProtectionPayload = JSON.stringify(
    isSolo
      ? {
          required_status_checks: null,
          enforce_admins: false,
          required_pull_request_reviews: null,
          restrictions: null,
          allow_force_pushes: false,
          allow_deletions: false,
          required_linear_history: false,
        }
      : {
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
          required_linear_history: false,
        },
  )

  // INV-101: disallow squash and rebase-merge; keep merge-commit (SHA-preserving path).
  // allow_merge_commit:true is required — GitHub 422s if all three are false.
  const repoSettingsPayload = JSON.stringify({
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: false,
  })

  let branchApplied = false
  let branchError: string | null = null
  let branchErrorKind: GhErrorKind | undefined

  try {
    runCli(
      'gh',
      ['api', `repos/${owner}/${repo}/branches/main/protection`, '--method', 'PUT', '--input', '-'],
      { input: branchProtectionPayload },
    )
    branchApplied = true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    branchError = msg
    branchErrorKind = classifyGhError(err)
  }

  let repoApplied = false
  let repoError: string | null = null

  try {
    runCli('gh', ['api', `repos/${owner}/${repo}`, '--method', 'PATCH', '--input', '-'], {
      input: repoSettingsPayload,
    })
    repoApplied = true
  } catch (err) {
    repoError = err instanceof Error ? err.message : String(err)
  }

  return {
    applied: branchApplied && repoApplied,
    error: branchError,
    ...(branchErrorKind !== undefined ? { errorKind: branchErrorKind } : {}),
    repoSettingsApplied: repoApplied,
    repoSettingsError: repoError,
  }
}
