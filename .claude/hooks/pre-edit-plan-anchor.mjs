#!/usr/bin/env node
// Arbiter hook: hard-block edits in implementation phase when no plan is anchored
// Hook type: PreToolUse (Edit|Write)
// Phase-aware: blocks during "implementation" phase with no valid plan
// Injects plan context (stdout) when plan is valid — model sees it before the edit
// CANON-16: blocks Write to new src/ files lacking a valid Existing Code Survey
// Exit 2: block — stderr returned to Claude as error context; user is NOT prompted
// Bypass: ARBITER_PLAN_BYPASS=1 (session-scoped — see CONTRIBUTING.md)
import { readTaskState, getRepoRoot } from './lib.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { join, basename, resolve, relative } from 'node:path'

if (process.env.ARBITER_PLAN_BYPASS === '1') process.exit(0)

const root = getRepoRoot()
const { phase, plan } = readTaskState(root)

const IMPL_PHASES = new Set(['red', 'green', 'refactor'])
if (!IMPL_PHASES.has(phase)) process.exit(0)

// During implementation phases (red/green/refactor), plan is required
const planPath = !plan || plan === 'unknown' ? null : plan.startsWith('/') ? plan : join(root, plan)

if (!planPath || !existsSync(planPath)) {
  process.stderr.write(
    `[arbiter] PLAN ANCHOR: ${phase} phase requires .task-plan pointing to an existing plan file.\n` +
      `Set via: echo "<path>" > .claude/.task-plan (or use ARBITER_PLAN_BYPASS=1 for emergency edits)\n`,
  )
  process.stderr.write(`[arbiter] Run \`arbiter explain CANON-16\` for details.\n`)
  process.exit(2)
}

let planBody
try {
  planBody = readFileSync(planPath, 'utf-8')
} catch (err) {
  process.stderr.write(
    `[arbiter] PLAN ANCHOR: plan file disappeared or became unreadable at ${planPath}: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
const preview = planBody.split('\n').slice(0, 20).join('\n')

process.stdout.write(`=== ACTIVE PLAN (${basename(planPath)}) ===\n` + `${preview}\n` + `===\n`)

// ─── Context Block validation (#689) ─────────────────────────────────────────
// Validates YAML front-matter Context Block. Required for all new plans.
// Plans with "# [legacy — pre-Context-Block]" header are exempt.
const isLegacyPlan = /^\s*#\s*\[legacy\s*[\u2014\u2013-]\s*pre-context-block\]/im.test(planBody)

if (!isLegacyPlan) {
  // Extract front-matter between first --- and second ---
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(planBody)

  if (!fmMatch) {
    process.stderr.write(
      `[arbiter] PLAN ANCHOR: plan is missing a Context Block (YAML front-matter).\n` +
        `Every plan must begin with a "---" front-matter block containing a "context:" key.\n` +
        `See docs/REFERENCE/plan-template.md for the required format.\n` +
        `Use ARBITER_PLAN_BYPASS=1 for emergency edits or mark plan as:\n` +
        `  # [legacy -- pre-Context-Block]\n`,
    )
    process.exit(2)
  }

  const fm = fmMatch[1]

  // Validate context: key exists
  if (!/^\s*context\s*:/m.test(fm)) {
    process.stderr.write(
      `[arbiter] PLAN ANCHOR: front-matter missing "context:" key.\n` +
        `See docs/REFERENCE/plan-template.md for the required format.\n`,
    )
    process.exit(2)
  }

  // Validate issue/issues — accept either form
  const hasIssue = /^\s+issue\s*:/m.test(fm)
  const hasIssues = /^\s+issues\s*:/m.test(fm)
  if (!hasIssue && !hasIssues) {
    process.stderr.write(
      `[arbiter] PLAN ANCHOR: Context Block missing required field: "issue" or "issues".\n` +
        `Use "issue: ..." for single tasks or "issues: [...]" for batches.\n`,
    )
    process.exit(2)
  }

  // Validate remaining required fields
  const REQUIRED_FIELDS = [
    'type',
    'pipeline',
    'branch_convention',
    'base_branch',
    'key_constraints',
    'red_team_warnings',
    'estimate',
  ]
  const missing = REQUIRED_FIELDS.filter((f) => !new RegExp(`^\\s+${f}\\s*:`, 'm').test(fm))

  if (missing.length > 0) {
    process.stderr.write(
      `[arbiter] PLAN ANCHOR: Context Block missing required field(s): ${missing.join(', ')}.\n` +
        `See docs/REFERENCE/plan-template.md for the full list of required fields.\n`,
    )
    process.exit(2)
  }
}

// ─── CANON-16: Survey gate for new src/ files ─────────────────────────────────
const targetRaw = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (targetRaw) {
  const absTarget = resolve(targetRaw)
  const rel = relative(root, absTarget)

  const inScope =
    !existsSync(absTarget) && // new files only
    rel.startsWith('src/') && // under src/
    !rel.startsWith('src/..') && // no path escape
    !/(?:^|\/)__tests__(?:\/|$)/.test(rel) && // exclude test dirs
    !/\.(test|spec)\.[cm]?[jt]s$/.test(rel) && // exclude test files
    !/^docs\//.test(rel) // exclude docs

  if (inScope) {
    const VALID_DECISIONS = new Set([
      'refactor-applied',
      'refactor-rejected',
      'extend',
      'extract',
      'new file justified',
      'no-similar-code',
    ])

    const targetLine = `- **Target:** \`${rel}\``
    // Split plan into H2 sections; find Survey section containing this Target line
    const h2Sections = planBody.split(/\n(?=## )/)
    const surveySection = h2Sections.find(
      (s) => /^## Existing Code Survey\b/.test(s) && s.includes(targetLine),
    )

    if (!surveySection) {
      process.stderr.write(
        `[arbiter] STOP — CANON-16 violation: no Existing Code Survey for \`${rel}\`.\n` +
          `Plan must contain a section:\n` +
          `  ## Existing Code Survey\n` +
          `  - **Target:** \`${rel}\`\n` +
          `  - **Decision:** \`<keyword>\`\n` +
          `  ### Evidence  (≥3 grep/ls rows)\n` +
          `  ### Rationale (≥200 chars)\n` +
          `Run /senior-survey or set ARBITER_PLAN_BYPASS=1 to bypass.\n`,
      )
      process.exit(2)
    }

    // Decision keyword
    const decisionMatch = surveySection.match(/[-*]\s+\*\*Decision:\*\*\s+`([^`]+)`/i)
    const decision = decisionMatch?.[1]?.toLowerCase().trim() ?? ''
    if (!VALID_DECISIONS.has(decision)) {
      process.stderr.write(
        `[arbiter] STOP — CANON-16 violation: Survey for \`${rel}\` has invalid or missing Decision keyword.\n` +
          `Valid values: ${[...VALID_DECISIONS].join(' | ')}\n` +
          `Found: ${decisionMatch ? `"${decisionMatch[1]}"` : '(none)'}\n`,
      )
      process.exit(2)
    }

    // Evidence rows: split into H3 subsections; find Evidence subsection; count rows
    const h3Sections = surveySection.split(/\n(?=### )/)
    const evidencePart = h3Sections.find((s) => /^### Evidence\b/.test(s)) ?? ''
    const evidenceRows = evidencePart.split('\n').filter((l) => /^- `(?:grep|ls)\b/.test(l.trim()))
    if (evidenceRows.length < 3) {
      process.stderr.write(
        `[arbiter] STOP — CANON-16 violation: Survey for \`${rel}\` needs ≥3 evidence rows (grep/ls), found ${evidenceRows.length}.\n`,
      )
      process.exit(2)
    }

    // Rationale: ≥200 non-whitespace chars
    const rationalePart = h3Sections.find((s) => /^### Rationale\b/.test(s)) ?? ''
    const rationaleLen = rationalePart.replace(/\s+/g, '').length
    if (rationaleLen < 200) {
      process.stderr.write(
        `[arbiter] STOP — CANON-16 violation: Survey Rationale for \`${rel}\` is too thin (${rationaleLen} non-whitespace chars, need ≥200).\n` +
          `Explain: what exists, why refactor was/wasn't viable, what new responsibility justifies this file.\n`,
      )
      process.exit(2)
    }
  }
}
