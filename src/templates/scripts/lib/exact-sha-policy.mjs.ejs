// SPDX-License-Identifier: Apache-2.0
// Canonical executable policy for INV-101 exact-SHA landing.
//
// GitHub rejects required_linear_history:true when squash and rebase are both
// disabled. Arbiter therefore enforces linearity at the mutation boundary with
// updateRefs(beforeOid, afterOid, force:false), while these compatibility
// settings remove every SHA-rewriting PR merge method.
export const EXACT_SHA_REPO_SETTINGS = Object.freeze({
  allow_merge_commit: true,
  allow_squash_merge: false,
  allow_rebase_merge: false,
})

export const EXACT_SHA_BRANCH_SETTINGS = Object.freeze({
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
})

function recordMismatch(errors, label, actual, expected) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual}`)
}

function readPath(source, path) {
  let value = source
  for (const segment of path) {
    if (value == null) return undefined
    value = value[segment]
  }
  return value
}

export function validateLiveExactShaPolicy(repo, protection) {
  const errors = []
  for (const [key, expected] of Object.entries(EXACT_SHA_REPO_SETTINGS)) {
    recordMismatch(errors, key, readPath(repo, [key]), expected)
  }
  for (const [key, expected] of Object.entries(EXACT_SHA_BRANCH_SETTINGS)) {
    recordMismatch(errors, `${key}.enabled`, readPath(protection, [key, 'enabled']), expected)
  }
  const contexts = [
    ...(readPath(protection, ['required_status_checks', 'contexts']) ?? []),
    ...(readPath(protection, ['required_status_checks', 'checks']) ?? []).map(
      (check) => check.context,
    ),
  ]
  recordMismatch(
    errors,
    'required_status_checks.strict',
    readPath(protection, ['required_status_checks', 'strict']),
    true,
  )
  if (!contexts.includes('CI Required'))
    errors.push('required status context CI Required is missing')
  recordMismatch(
    errors,
    'enforce_admins.enabled',
    readPath(protection, ['enforce_admins', 'enabled']),
    false,
  )
  return errors
}
