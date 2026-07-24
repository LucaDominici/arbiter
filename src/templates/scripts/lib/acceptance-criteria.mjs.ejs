// SPDX-License-Identifier: Apache-2.0
// acceptance-criteria.mjs — pure parsing/validation core for the acceptance-criteria
// anchor (INV-138). No I/O, no process.exit: shared by scripts/issue-readiness.mjs
// (orchestration-time entry gate), scripts/check-acceptance.mjs (L1 gate) and tests.
//
// Grammar:
//   - Sections are markdown headings at any level (or bold-label lines) matching
//     /acceptance criteria/i, /non-goals?/i, /(files|contracts|touch)/i — the shapes
//     GitHub issue forms emit (`### Acceptance criteria`) included. CRLF normalized.
//   - Criteria are checkbox bullets `- [ ] AC-N: text`. Explicit stable `AC-N:` ids are
//     REQUIRED for readiness (bare checkboxes are a renumbering hazard: inserting one
//     silently shifts every later id after tests/reviews already cite them). Bare
//     checkboxes still parse (positional id, explicit:false) for display purposes.
import { createHash } from 'node:crypto'

export const AC_FIT_SCHEMA = 'arbiter-ac-fit-v1'
const VERDICTS = new Set(['PASS', 'FAIL', 'NOT-TESTED'])

// Template prefill lines that never count as task-specific criteria.
const STOCK_CRITERIA = new Set([
  'gate l1 passes',
  'gate l2 passes',
  'tests cover new behavior',
  'criterion 1',
  'criterion 2',
])

function sectionKind(headingText) {
  const t = headingText.trim().toLowerCase()
  if (/acceptance\s+criteria/.test(t)) return 'criteria'
  if (/^non[-\s]?goals?\b/.test(t)) return 'nonGoals'
  if (/\bfiles?\b|\bcontracts?\b|\btouch(?:es|ed)?\b|\bscope\b/.test(t)) return 'touches'
  return 'other'
}

/** GitHub issue forms number labels ("6. Non-Goals") and may emphasize them — strip both. */
function normalizeHeading(headingText) {
  return headingText
    .trim()
    .replace(/^[*_]+|[*_]+$/g, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim()
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim()
}

/** Parse AC checkboxes, non-goals and touches sections out of an issue/plan body. */
export function parseAcceptanceBlocks(markdown) {
  const lines = String(markdown ?? '')
    .split('\r\n')
    .join('\n')
    .split('\n')
  const criteria = []
  const nonGoals = []
  const touches = []
  let current = 'other'
  let inFence = false
  for (const line of lines) {
    // Fenced code blocks quote the grammar (docs, ADRs, skill examples) — never parse them.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line) ?? /^\*\*(.+?)\*\*:?\s*$/.exec(line)
    if (heading) {
      current = sectionKind(normalizeHeading(heading[1]))
      continue
    }
    if (current === 'criteria') parseCriterionLine(line, criteria)
    else if (current === 'nonGoals') parseBulletLine(line, nonGoals)
    else if (current === 'touches') parseBulletLine(line, touches)
  }
  return { criteria, nonGoals, touches }
}

function parseBulletLine(line, target) {
  const bullet = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line)
  if (bullet) target.push(normalizeText(bullet[1]))
}

function parseCriterionLine(line, criteria) {
  const box = /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/.exec(line)
  if (!box) return
  const body = box[1].trim()
  // Explicit stable ids: AC-3, or wave-namespaced AC-123.1 / AC-123-1 (issue.criterion)
  const explicit = /^AC-(\d+(?:[.-]\d+)?)\s*[:.–-]\s*(.*)$/.exec(body)
  if (explicit) {
    criteria.push({ id: `AC-${explicit[1]}`, text: normalizeText(explicit[2]), explicit: true })
  } else {
    criteria.push({ id: `AC-${criteria.length + 1}`, text: normalizeText(body), explicit: false })
  }
}

function isStock(criterion) {
  // Unreplaced template placeholders (`<observable behavior>`) are as generic as stock lines.
  if (/<[^>]+>/.test(criterion.text)) return true
  return STOCK_CRITERIA.has(criterion.text.toLowerCase().replace(/[.!]+$/, ''))
}

/**
 * Entry-gate readiness: an issue is workable only when its target is written down —
 * explicit AC-N criteria beyond the template stock lines, non-goals, and the
 * files/contracts it touches. Anything less is `needs-clarification`, priced as a
 * prompt BEFORE dispatch instead of a thrown-away PR after.
 */
export function assessReadiness(markdown) {
  const { criteria, nonGoals, touches } = parseAcceptanceBlocks(markdown)
  const missing = []
  if (criteria.length === 0) {
    missing.push('acceptance-criteria: no `- [ ] AC-N: <observable behavior>` checkbox found')
  } else {
    if (criteria.some((c) => !c.explicit)) {
      missing.push('acceptance-criteria: every checkbox needs an explicit stable `AC-N:` id')
    }
    if (criteria.every(isStock)) {
      missing.push('acceptance-criteria: only stock/template lines — add task-specific criteria')
    }
  }
  if (nonGoals.length === 0) missing.push('non-goals: section missing or empty')
  if (touches.length === 0) missing.push('files/contracts touched: section missing or empty')
  return { ready: missing.length === 0, missing }
}

/** Markdown comment body posted on an issue that fails readiness. */
export function renderClarificationComment(missing) {
  return [
    'This issue is not ready for a wave (`needs-clarification`).',
    '',
    'The "done right" target must live in the issue, not in anyone\'s head. Please add:',
    '',
    ...missing.map((m) => `- [ ] ${m}`),
    '',
    'Template: explicit `- [ ] AC-N: <observable behavior>` acceptance criteria,',
    'a `Non-goals` section, and a `Files / contracts touched` section.',
    'Once updated, remove the `needs-clarification` label to re-enter the queue.',
  ].join('\n')
}

/** Read the frozen AC anchor out of a plan body; null when no anchor sections exist. */
export function parsePlanAnchor(planBody) {
  const { criteria, nonGoals } = parseAcceptanceBlocks(planBody)
  if (criteria.length === 0 && nonGoals.length === 0) return null
  return { criteria, nonGoals }
}

/** Stable hash of the frozen criteria (id + normalized text) — detects issue↔anchor drift. */
export function computeAcHash(criteria) {
  const canonical = criteria.map((c) => `${c.id}:${normalizeText(c.text)}`).join('\n')
  return createHash('sha1').update(canonical, 'utf-8').digest('hex')
}

/**
 * Validate an ac-fit evidence artifact against the plan's frozen criteria ids.
 * Returns an error list (empty = valid). With `requireAllPass`, any non-PASS verdict
 * is an error — the mechanical form of "unproven criterion = REJECT".
 */
function validateFitHeader(json, opts, errors) {
  if (json.schema !== AC_FIT_SCHEMA) errors.push(`ac-fit: schema must be "${AC_FIT_SCHEMA}"`)
  if (typeof json.taskId !== 'string' || json.taskId.length === 0) {
    errors.push('ac-fit: missing taskId')
  } else if (typeof opts.expectedTaskId === 'string' && json.taskId !== opts.expectedTaskId) {
    errors.push(
      `ac-fit: taskId "${json.taskId}" does not match the active task "${opts.expectedTaskId}" (stale artifact?)`,
    )
  }
}

function isUsableEvidence(e) {
  return typeof e?.file === 'string' && e.file.length > 0 && Number.isInteger(e?.line) && e.line > 0
}

function validateFitVerdict(criterion, id, opts, errors) {
  const verdict =
    criterion === null || typeof criterion !== 'object' ? undefined : criterion.verdict
  if (!VERDICTS.has(verdict)) errors.push(`criterion ${id}: invalid verdict "${verdict}"`)
  const evidence = Array.isArray(criterion?.evidence) ? criterion.evidence : []
  if (verdict === 'PASS' && !evidence.some(isUsableEvidence))
    errors.push(`criterion ${id}: PASS without evidence (cite the diff/test line)`)
  if (opts.requireAllPass && verdict !== 'PASS')
    errors.push(`criterion ${id}: verdict ${verdict} is not PASS`)
}

function validateFitCriterion(c, seen, opts, errors) {
  const id = typeof c?.id === 'string' ? c.id : '(missing id)'
  if (seen.has(id)) errors.push(`criterion ${id}: duplicated in the ac-fit artifact`)
  seen.add(id)
  validateFitVerdict(c, id, opts, errors)
}

function validateFitCoverage(seen, planCriteriaIds, errors) {
  for (const id of planCriteriaIds) {
    if (!seen.has(id)) errors.push(`criterion ${id}: not covered by ac-fit artifact`)
  }
  for (const id of seen) {
    if (!planCriteriaIds.includes(id))
      errors.push(`criterion ${id}: unknown (not in the plan anchor)`)
  }
}

export function validateAcFit(json, planCriteriaIds, opts = {}) {
  const errors = []
  if (typeof json !== 'object' || json === null) return ['ac-fit: not an object']
  validateFitHeader(json, opts, errors)
  const list = Array.isArray(json.criteria) ? json.criteria : []
  if (!Array.isArray(json.criteria)) errors.push('ac-fit: criteria must be an array')
  const seen = new Set()
  for (const c of list) validateFitCriterion(c, seen, opts, errors)
  validateFitCoverage(seen, planCriteriaIds, errors)
  return errors
}
