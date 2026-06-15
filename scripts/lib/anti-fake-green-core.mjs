// SPDX-License-Identifier: Apache-2.0
// arbiter — anti-fake-green pure core (#1412). I/O-free verdict logic for the gh-audit
// guards, so the N2 self-audit can exercise them offline with synthetic fixtures. No
// process.exit, no spawn, no fs — pure functions only (lib; see check-fail-closed-audit SKIP_FILES).
//
// A "falso-green" is a passing signal satisfied by something other than the real property it
// attests. These classifiers fail-closed: when data is absent or a configured hint matches
// nothing, they return NV (not verified) — NEVER a manufactured PASS.

/** Verdicts shared with the conformance engine. */
export const V = { PASS: 'PASS', VIOLATION: 'VIOLATION', EXEMPT: 'EXEMPT', NV: 'NV' }

const DOC_GLOBS = [/\.mdx?$/i, /\.rst$/i, /(^|\/)docs\//i]

/** True if every changed path is documentation (doc-only PR). Empty file list ⇒ not doc-only. */
export function isDocOnly(files, docGlobs = DOC_GLOBS) {
  if (!Array.isArray(files) || files.length === 0) return false
  return files.every((f) => {
    const p = typeof f === 'string' ? f : (f && f.path) || ''
    return docGlobs.some((re) => re.test(p))
  })
}

/** Parse a dependabot bump level from a PR title. Returns 'major'|'minor'|'patch'|null. */
export function dependabotBumpLevel(title) {
  if (typeof title !== 'string') return null
  const m = title.match(/from\s+v?(\d+)\.(\d+)\.(\d+)\S*\s+to\s+v?(\d+)\.(\d+)\.(\d+)/i)
  if (!m) return null
  const [a1, a2] = [Number(m[1]), Number(m[2])]
  const [b1, b2] = [Number(m[4]), Number(m[5])]
  if (b1 > a1) return 'major'
  if (b2 > a2) return 'minor'
  return 'patch'
}

const isBot = (login) => /^dependabot(\[bot\])?$/i.test(login || '')

/**
 * #9 — review effort. VIOLATION only when there is NO non-author approval AND the merge window
 * is below the threshold (a genuinely-approved fast PR is never a violation). Uses latestReviews
 * (current state per reviewer), never the raw reviews[] event log (TC-2 stale-approval defense).
 */
export function classifyReview(pr, cfg = {}) {
  const codeWindow = cfg.codeWindowHours ?? 4
  const docWindow = cfg.docWindowHours ?? 1
  const exemptLabel = cfg.exemptLabel ?? 'min-review-exempt'
  if (!pr || typeof pr !== 'object') return { verdict: V.NV, reason: 'no PR data' }
  if (cfg.soloExempt) return { verdict: V.EXEMPT, reason: 'trunk-solo-attested (ADR-091)' }
  if (!pr.mergedAt) return { verdict: V.NV, reason: 'PR not merged' }

  const labels = (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
  if (labels.includes(exemptLabel)) return { verdict: V.EXEMPT, reason: `label:${exemptLabel}` }

  const author = (pr.author && pr.author.login) || ''
  if (isBot(author)) {
    const lvl = dependabotBumpLevel(pr.title)
    if (lvl === 'patch' || lvl === 'minor')
      return { verdict: V.EXEMPT, reason: `dependabot ${lvl} bump` }
    // major (or unparseable) bump: evaluate normally — not exempt.
  }

  const latest = Array.isArray(pr.latestReviews) ? pr.latestReviews : []
  const nonAuthorApprovals = latest.filter(
    (r) => r && r.state === 'APPROVED' && r.author && r.author.login !== author,
  ).length

  const docOnly = isDocOnly(pr.files)
  const createdMs = Date.parse(pr.createdAt)
  const mergedMs = Date.parse(pr.mergedAt)
  if (Number.isNaN(createdMs) || Number.isNaN(mergedMs))
    return { verdict: V.NV, reason: 'unparseable timestamps' }
  const windowHours = (mergedMs - createdMs) / 3_600_000

  const reviewFail = nonAuthorApprovals === 0
  const windowFail = windowHours < (docOnly ? docWindow : codeWindow)
  const verdict = reviewFail && windowFail ? V.VIOLATION : V.PASS
  return {
    verdict,
    reason:
      verdict === V.VIOLATION
        ? `0 non-author approvals + merged in ${windowHours.toFixed(2)}h (< ${docOnly ? docWindow : codeWindow}h)`
        : `${nonAuthorApprovals} non-author approval(s); window ${windowHours.toFixed(2)}h`,
    nonAuthorApprovals,
    windowHours: Number(windowHours.toFixed(4)),
    docOnly,
  }
}

/**
 * #10 / O-9 — ownership concentration. Scores the EMPIRICALLY dominant assignee (argmax over the
 * actual data), never a configured owner (NF-2/TC-1 defense): an ownerHint that matches nothing
 * forces NV, never PASS. Zero P0/P1 issues ⇒ NV (nothing to measure ≠ well-distributed).
 */
export function classifyOwnership(issues, cfg = {}) {
  const threshold = cfg.threshold ?? 30
  const priority = new Set(cfg.priorityLabels ?? ['P0', 'P1', 'priority:P0', 'priority:P1'])
  if (cfg.soloExempt) return { verdict: V.EXEMPT, reason: 'trunk-solo-attested (ADR-091)' }
  if (!Array.isArray(issues)) return { verdict: V.NV, reason: 'no issue data' }

  const p = issues.filter((i) =>
    (i.labels || []).some((l) => priority.has(typeof l === 'string' ? l : l.name)),
  )
  if (p.length === 0) return { verdict: V.NV, reason: 'no open P0/P1 issues to measure' }

  const n = p.length
  let unassigned = 0
  const perOwner = new Map()
  for (const i of p) {
    const as = i.assignees || []
    if (as.length === 0) {
      unassigned++
      continue
    }
    for (const a of as) {
      const login = typeof a === 'string' ? a : a.login
      perOwner.set(login, (perOwner.get(login) || 0) + 1)
    }
  }
  let dominant = null
  let dominantCount = 0
  for (const [login, c] of perOwner)
    if (c > dominantCount) ((dominant = login), (dominantCount = c))

  if (cfg.ownerHint && !perOwner.has(cfg.ownerHint))
    return {
      verdict: V.NV,
      reason: `configured owner "${cfg.ownerHint}" matches no assignee in data`,
    }

  const concentrationPct = Number((((unassigned + dominantCount) / n) * 100).toFixed(2))
  const verdict = concentrationPct > threshold ? V.VIOLATION : V.PASS
  return {
    verdict,
    reason: `concentration ${concentrationPct}% (unassigned ${unassigned} + dominant ${dominant || '—'} ${dominantCount}) / ${n} P0+P1; threshold ${threshold}%`,
    concentrationPct,
    dominant,
    n,
  }
}
