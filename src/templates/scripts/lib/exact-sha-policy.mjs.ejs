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

// ─── #2150: the mode-aware landing contract ──────────────────────────────────
//
// One table, three arcs, no defaults. `trunk-solo` is the only collaboration mode
// whose landing achieves `main === gatedHeadSha`: after the checks go green the
// watcher advances `refs/heads/main` with an atomic non-force compare-and-swap
// (`updateRefs`, `beforeOid`/`afterOid`, `force:false`) instead of calling a GitHub
// PR merge method. No GitHub PR merge method implements that contract — squash and
// rebase rewrite commit identity, a merge commit gives `main` a new tip (PR #2147
// landed a gated head as a different SHA: `preservation: LOST`).
//
// `peer-review` and `gated-review` are DECLARED here and refused. Omitting them
// would read as "never considered"; declaring them unsupported reads as "known,
// refused and tracked". Landing the exact gated SHA in those modes needs a trusted
// updater (a GitHub App owning the ref advance), which is deferred work.
//
// An unknown, absent or malformed `collaborationMode` resolves to REFUSED. It never
// falls back to a supported arc: on a merge trust boundary the safe resolution of an
// ambiguity is to refuse, never to permit.

/**
 * The deferred half of INV-101 — trusted updater (GitHub App) as the only actor
 * allowed to advance `main`. Every refusal below cites it instead of inventing a
 * fallback landing path.
 */
export const TRUSTED_UPDATER_ISSUE = '#2289'

/**
 * @typedef {object} LandingArc
 * @property {string} mode                    the `collaborationMode` this arc describes
 * @property {boolean} supported              may exact-SHA landing run in this mode at all
 * @property {boolean} requiresTrustedUpdater does landing here need the deferred GitHub App
 * @property {string|null} blockedOn          issue tracking the missing half, or null
 * @property {string|null} requiredMergeMode  `solo.mergeMode` this arc demands, or null
 * @property {boolean} exactShaLanding        does landing here yield `main === gatedHeadSha`
 * @property {string} landing                 the mechanism that actually advances `main`
 * @property {string} rationale               why this arc is what it is
 */

/** @type {Readonly<Record<string, LandingArc>>} */
export const LANDING_CONTRACT = Object.freeze({
  'trunk-solo': Object.freeze({
    mode: 'trunk-solo',
    supported: true,
    requiresTrustedUpdater: false,
    blockedOn: null,
    requiredMergeMode: 'pr-ff',
    exactShaLanding: true,
    landing: 'atomic non-force updateRefs CAS (beforeOid/afterOid, force:false)',
    rationale:
      'The PR carries the checks; arbiter never calls a GitHub PR merge endpoint, so main ends up at the exact gated head SHA.',
  }),
  'peer-review': Object.freeze({
    mode: 'peer-review',
    supported: false,
    requiresTrustedUpdater: true,
    blockedOn: TRUSTED_UPDATER_ISSUE,
    requiredMergeMode: null,
    exactShaLanding: false,
    landing: 'GitHub PR merge (merge commit) — main gets a new tip',
    rationale:
      'A second approver exists, but no actor is authorised to advance main by CAS; the GitHub merge that does land gives main a tip that was never the gated head.',
  }),
  'gated-review': Object.freeze({
    mode: 'gated-review',
    supported: false,
    requiresTrustedUpdater: true,
    blockedOn: TRUSTED_UPDATER_ISSUE,
    requiredMergeMode: null,
    exactShaLanding: false,
    landing: 'GitHub PR merge (merge commit / merge queue) — main gets a new tip',
    rationale:
      'CODEOWNERS and the merge queue add approvals, not ref-advance authority; the landed SHA still differs from the gated head.',
  }),
})

/** The closed vocabulary, in declaration order — used verbatim in refusal text. */
const KNOWN_MODES = Object.keys(LANDING_CONTRACT)

/** A short, safe description of an arbitrary value for refusal messages. */
function shapeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/**
 * @param {string} reason
 * @param {{mode?: string|null, arc?: LandingArc|null, blockedOn?: string|null}} [detail]
 */
function refuse(reason, detail = {}) {
  return Object.freeze({
    supported: false,
    mode: detail.mode ?? null,
    arc: detail.arc ?? null,
    blockedOn: detail.blockedOn ?? null,
    reason,
  })
}

/**
 * Resolve an `arbiter.json` object to its landing arc.
 *
 * Pure: it never touches the network, the filesystem or `process` — the caller owns
 * the exit contract and converts a refusal fail-closed BEFORE any GitHub call.
 *
 * @param {unknown} config parsed `arbiter.json` (any shape — malformed input is expected)
 * @returns {{supported: boolean, mode: string|null, arc: LandingArc|null, blockedOn: string|null, reason: string}}
 */
export function resolveLandingContract(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return refuse(
      `arbiter.json did not resolve to an object (got ${shapeOf(config)}): exact-SHA landing refused — a malformed config has no landing arc`,
    )
  }
  const mode = config.collaborationMode
  if (mode === undefined || mode === null) {
    return refuse(
      'collaborationMode is absent: exact-SHA landing refused — the landing contract has no default arc, and an unresolved mode must never fall through to a supported one',
    )
  }
  if (typeof mode !== 'string') {
    return refuse(
      `collaborationMode is not a string (got ${shapeOf(mode)}): exact-SHA landing refused — a malformed mode has no landing arc`,
    )
  }
  const arc = Object.hasOwn(LANDING_CONTRACT, mode) ? LANDING_CONTRACT[mode] : null
  if (arc === null) {
    return refuse(
      `collaborationMode "${mode}" is not a known landing arc (known: ${KNOWN_MODES.join(', ')}): exact-SHA landing refused — an unrecognised mode never resolves to a supported arc`,
      { mode },
    )
  }
  if (!arc.supported) {
    return refuse(
      `collaborationMode "${mode}" has no exact-SHA landing arc: it requires a trusted updater (GitHub App), tracked on ${arc.blockedOn}. In this mode landing is "${arc.landing}", so main != gatedHeadSha — refusing before any GitHub call rather than producing a false green`,
      { mode, arc, blockedOn: arc.blockedOn },
    )
  }
  const mergeMode = config.solo?.mergeMode
  if (mergeMode !== arc.requiredMergeMode) {
    return refuse(
      `collaborationMode "${mode}" lands the exact gated SHA only with solo.mergeMode "${arc.requiredMergeMode}" (got ${mergeMode === undefined ? 'nothing' : JSON.stringify(mergeMode)}): exact-SHA landing refused`,
      { mode, arc },
    )
  }
  return Object.freeze({ supported: true, mode, arc, blockedOn: null, reason: '' })
}
