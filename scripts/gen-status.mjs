#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/gen-status.mjs
// Generate docs/internal/PRODUCT/STATUS.md — living product dashboard derived from
// FEATURE_MATRIX.md, MILESTONES.md, and PRD.md.
//
// Usage:
//   node scripts/gen-status.mjs                  # regenerate (--write is default); milestones
//                                                 # via the fallback path (see #2409 note below)
//   node scripts/gen-status.mjs --write           # same as above
//   node scripts/gen-status.mjs --write --live    # regenerate with live GitHub milestones (gh
//                                                 # api) as primary source — only attempted when
//                                                 # `gh` is reachable AND arbiter.json sets
//                                                 # permitGitHub:true; degrades to the fallback
//                                                 # path on any failure (no permission, no `gh`,
//                                                 # unauthenticated, network down, bad JSON)
//   node scripts/gen-status.mjs --check           # fail (exit 1) if STATUS.md is stale
//
// #2409: `--check` NEVER attempts a live `gh` call, even if `--live` is also passed — it always
// recomputes the milestone section via the fallback path (MILESTONES.md's "**Open epics:**"
// table) or "unavailable". This keeps the doc-freshness gate byte-reproducible on a machine with
// no `gh` credentials (the common CI case) and immune to live issue/milestone counts changing
// between commits — a `--write --live` snapshot would otherwise go stale on every unrelated
// GitHub issue close, with no corresponding STATUS.md edit to fix it. Consequently the committed
// STATUS.md is always generated via plain `--write` (fallback path), never `--write --live`.
//
// Exported functions (for unit tests):
//   collectData(root, opts)               → StatusData   (opts.tryLive?: boolean, default false)
//   buildStatus(data)                     → string
//   buildMilestoneSection(milestones)     → string
//   runCli(root, statusPath, check, opts) → Promise<number>  (0 = ok, 1 = stale/error)
//
// Fail-closed (INV-96): IO/parse errors return 1 rather than producing a partial file. The one
// deliberate exception is the live-milestone fetch: every failure mode there degrades to the
// fallback path rather than failing the whole generator — see fetchLiveMilestones() below.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fmField, readdirSafe, prettify } from './lib/gen-doc-helpers.mjs'
import { isMainModule } from './lib/run-helpers.mjs'
import { ghAvailable, ghJson } from './lib/gh-audit-io.mjs'

// ---------------------------------------------------------------------------
// Types (JSDoc for editor support)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ title: string, openIssues: number, closedIssues: number, dueOn: string | null }} LiveMilestone
 * @typedef {{ issue: string, title: string }} FallbackEpic
 * @typedef {
 *   { source: 'live', items: LiveMilestone[] } |
 *   { source: 'fallback', items: FallbackEpic[] } |
 *   { source: 'unavailable' }
 * } MilestoneData
 */

/**
 * @typedef {{
 *   counts: {Verified: number, Done: number, Partial: number, Missing: number},
 *   partialReqs: string[],
 *   missingReqs: string[],
 *   mission: string,
 *   milestones: MilestoneData,
 *   lastReview: string,
 *   convergenceFile: string | null,
 * }} StatusData
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** First paragraph after `## Vision` heading. */
function extractMission(content) {
  const m = content.match(/##\s+Vision\s*\n\n([^\n]+(?:\n(?!\n)[^\n]+)*)/)
  return m ? m[1].trim() : ''
}

/**
 * Fallback milestone source (#2409): the "**Open epics:**" table in MILESTONES.md, e.g.
 *
 *   **Open epics:**
 *
 *   | Epic  | Title                          | State |
 *   | ----- | ------------------------------ | ----- |
 *   | #1491 | Release-readiness remediation  | OPEN  |
 *
 * Whitespace-tolerant match on the bold marker (prettier may reflow surrounding blank lines).
 * Returns null when the section is absent entirely — nothing to fall back to. Returns [] (not
 * null) when the section exists but every row is CLOSED — a real, non-"unavailable" answer.
 */
function parseOpenEpicsTable(content) {
  const heading = content.match(/\*\*Open epics:\*\*/)
  if (!heading) return null
  const items = []
  let rowIndex = -1
  for (const line of content.slice(heading.index + heading[0].length).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      if (rowIndex >= 0) break // table ended
      continue // still seeking the table's first row
    }
    rowIndex++
    if (rowIndex === 0) continue // header row ("| Epic | Title | State |")
    if (/^\|[\s:-]+\|/.test(trimmed)) continue // separator row ("| --- | --- | --- |")
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 3) continue
    const [issue, title, state] = cells
    if ((state ?? '').toUpperCase() === 'OPEN') items.push({ issue, title })
  }
  return items
}

/**
 * May this script make live GitHub calls? Mirrors src/commands/ship-config.ts's
 * `permitsGitHubCalls` — only an explicit `permitGitHub: true` in arbiter.json permits network
 * calls; an absent/unreadable/malformed config denies. Reimplemented here (not imported) because
 * scripts/ is plain JS with no compiled-src dependency; see CANON-16 survey in the #2409 commit.
 */
function permitsGitHubCallsForScript(root) {
  try {
    const cfgPath = join(root, 'arbiter.json')
    if (!existsSync(cfgPath)) return false
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
    return cfg.permitGitHub === true
    // FAIL-OPEN-INTENT: an unreadable/malformed arbiter.json has not granted permission, so this
    // denies rather than throws — mirrors ship-config.ts's own FAIL-OPEN-INTENT for the same read.
  } catch {
    return false
  }
}

/**
 * Live GitHub milestones (gh api), when permitted and reachable. Never throws: every failure
 * mode (no permission, no `gh` binary, unauthenticated, network down, malformed JSON) degrades to
 * null so the caller falls back to the MILESTONES.md table — a docs generator must never hard-fail
 * because a live network call didn't work (#2409 AC-1).
 */
function fetchLiveMilestones(root) {
  if (!permitsGitHubCallsForScript(root)) return null
  if (!ghAvailable()) return null
  const result = ghJson(['api', 'repos/{owner}/{repo}/milestones?state=open'])
  if (!result.ok) return null
  if (!Array.isArray(result.data)) return null
  // FAIL-OPEN-INTENT: a live response shape we don't recognize degrades to fallback rather than
  // crashing the generator — see the function-level note above.
  try {
    return result.data.map((m) => ({
      title: String(m?.title ?? ''),
      openIssues: Number(m?.open_issues ?? 0),
      closedIssues: Number(m?.closed_issues ?? 0),
      dueOn: typeof m?.due_on === 'string' ? m.due_on.slice(0, 10) : null,
    }))
  } catch {
    return null
  }
}

/**
 * Resolve the milestone section's data source: live (when requested and it succeeds) → fallback
 * (the Open epics table) → unavailable. See the #2409 header note for why `tryLive` is false by
 * default and always false in `--check`.
 * @returns {MilestoneData}
 */
function resolveMilestones(root, milestonesContent, tryLive) {
  if (tryLive) {
    const live = fetchLiveMilestones(root)
    if (live !== null) return { source: 'live', items: live }
  }
  const fallback = parseOpenEpicsTable(milestonesContent)
  if (fallback !== null) return { source: 'fallback', items: fallback }
  return { source: 'unavailable' }
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Collect source data from the three input files.
 * Throws if any required source file is missing or unreadable.
 * @param {string} root
 * @param {{ tryLive?: boolean }} [opts] tryLive: attempt live GitHub milestones first (#2409).
 */
export function collectData(root, opts = {}) {
  const matrixPath = join(root, 'docs', 'internal', 'PRODUCT', 'FEATURE_MATRIX.md')
  // PRD.md stays public (linked from README as outward-facing positioning)
  const prdPath = join(root, 'docs', 'PRODUCT', 'PRD.md')
  const milestonesPath = join(root, 'docs', 'internal', 'PRODUCT', 'MILESTONES.md')

  if (!existsSync(matrixPath)) throw new Error(`FEATURE_MATRIX.md not found: ${matrixPath}`)
  if (!existsSync(prdPath)) throw new Error(`PRD.md not found: ${prdPath}`)
  if (!existsSync(milestonesPath)) throw new Error(`MILESTONES.md not found: ${milestonesPath}`)

  const matrixContent = readFileSync(matrixPath, 'utf-8')
  const prdContent = readFileSync(prdPath, 'utf-8')
  const milestonesContent = readFileSync(milestonesPath, 'utf-8')

  // Count matrix rows by status
  const counts = { Verified: 0, Done: 0, Partial: 0, Missing: 0 }
  const partialReqs = []
  const missingReqs = []
  for (const line of matrixContent.split('\n')) {
    const m = line.match(/\|\s*(REQ-\d+)\s*\|.*?\|\s*(Verified|Done|Partial|Missing)\s*\|/)
    if (!m) continue
    counts[m[2]]++
    if (m[2] === 'Partial') partialReqs.push(m[1])
    if (m[2] === 'Missing') missingReqs.push(m[1])
  }

  const lastReview = fmField(matrixContent, 'last_review') ?? '2026-06-04'
  const mission = extractMission(prdContent)

  const milestones = resolveMilestones(root, milestonesContent, opts.tryLive === true)

  // Convergence report: use most recent by name sort (CONVERGENCE-YYYY-MM.md)
  const convergenceDir = join(root, 'docs', 'internal', 'PRODUCT')
  let convergenceFile = null
  if (existsSync(convergenceDir)) {
    const candidates = readdirSafe(convergenceDir).filter((f) =>
      /^CONVERGENCE-\d{4}-\d{2}\.md$/.test(f),
    )
    if (candidates.length > 0) {
      convergenceFile = candidates.sort().at(-1) ?? null
    }
  }

  return {
    counts,
    partialReqs,
    missingReqs,
    mission,
    milestones,
    lastReview,
    convergenceFile,
  }
}

/**
 * Render the "## Milestones" section for the resolved data source (#2409 AC-1). Never a frozen
 * "complete" block: live/fallback each render a real (possibly empty) table, and the absence of
 * both sources is stated explicitly rather than defaulting to "complete".
 * @param {MilestoneData} milestones
 * @returns {string}
 */
export function buildMilestoneSection(milestones) {
  if (milestones.source === 'live') {
    if (milestones.items.length === 0) {
      return '\n## Milestones\n\n_Source: live GitHub milestones._\n\nNo open milestones.\n'
    }
    const rows = milestones.items
      .map((i) => `| ${i.title} | ${i.openIssues} | ${i.closedIssues} | ${i.dueOn ?? '—'} |`)
      .join('\n')
    return (
      '\n## Milestones\n\n_Source: live GitHub milestones._\n\n' +
      '| Milestone | Open | Closed | Due |\n| --- | --- | --- | --- |\n' +
      `${rows}\n`
    )
  }
  if (milestones.source === 'fallback') {
    if (milestones.items.length === 0) {
      return '\n## Milestones\n\n_Source: MILESTONES.md open epics table (offline fallback)._\n\nNo open epics.\n'
    }
    const rows = milestones.items.map((i) => `| ${i.issue} | ${i.title} |`).join('\n')
    return (
      '\n## Milestones\n\n_Source: MILESTONES.md open epics table (offline fallback)._\n\n' +
      '| Epic | Title |\n| --- | --- |\n' +
      `${rows}\n`
    )
  }
  return '\n## Milestones\n\nmilestones: source unavailable (offline)\n'
}

/**
 * Build the full STATUS.md content from collected data.
 * Content is deterministic: same input → same output (no Date(), no random).
 */
export function buildStatus(data) {
  const total = data.counts.Verified + data.counts.Done + data.counts.Partial + data.counts.Missing

  const partialLine =
    data.partialReqs.length > 0
      ? `\n**Partial** (${data.partialReqs.length}): ${data.partialReqs.join(', ')}\n`
      : ''
  const missingLine =
    data.missingReqs.length > 0
      ? `\n**Missing** (${data.missingReqs.length}): ${data.missingReqs.join(', ')}\n`
      : ''

  const convergenceRow =
    data.convergenceFile !== null
      ? `| [${data.convergenceFile}](${data.convergenceFile}) | Latest convergence audit — gate matrix, parity verdict |\n`
      : ''

  return `---
title: 'STATUS — arbiter living dashboard'
doc_version: '1.0.0'
status: active
last_review: '${data.lastReview}'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/pm', 'kind/product']
related: ['PRODUCT/FEATURE_MATRIX.md', 'PRODUCT/PRD.md', 'INDEX.md']
---

# STATUS — arbiter living dashboard

> Generated from FEATURE_MATRIX.md · MILESTONES.md · PRD.md.
> Refresh: \`node scripts/gen-status.mjs --write\`. Gate: \`node scripts/gen-status.mjs --check\`.

## Mission

${data.mission}

<!-- STATUS_START -->
## Feature Status

| Status | Count |
| -------- | ----- |
| Verified | ${data.counts.Verified} |
| Done | ${data.counts.Done} |
| Partial | ${data.counts.Partial} |
| Missing | ${data.counts.Missing} |
| **Total** | **${total}** |
${partialLine}${missingLine}${buildMilestoneSection(data.milestones)}
## Navigation

| Document | Purpose |
| ---------------------------------------- | ------------------------------------------------------- |
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Product truth RTM — ${total} requirements with evidence |
| [INDEX.md](../../INDEX.md) | Every governance doc in one inventory |
|  [PRD.md](../../PRODUCT/PRD.md) | Product requirements, personas, and governance levels |
${convergenceRow}<!-- STATUS_END -->
`
}

/**
 * Write or check STATUS.md.
 * Returns 0 on success, 1 on stale/error. Does not call process.exit — exported for testing.
 * @param {string} root
 * @param {string} statusPath
 * @param {boolean} check
 * @param {{ tryLive?: boolean }} [opts] tryLive is ALWAYS forced false when check is true (#2409).
 */
export async function runCli(root, statusPath, check, opts = {}) {
  try {
    const tryLive = check ? false : opts.tryLive === true
    const data = collectData(root, { tryLive })
    const generated = await prettify(buildStatus(data), statusPath)
    if (check) {
      const current = existsSync(statusPath) ? readFileSync(statusPath, 'utf-8') : ''
      if (current !== generated) {
        process.stderr.write(
          'docs/internal/PRODUCT/STATUS.md is stale. Run `node scripts/gen-status.mjs --write` and commit the result.\n',
        )
        return 1
      }
      process.stdout.write('docs/internal/PRODUCT/STATUS.md is up to date.\n')
      return 0
    }
    writeFileSync(statusPath, generated)
    process.stdout.write(`Wrote ${statusPath}\n`)
    return 0
  } catch (err) {
    process.stderr.write(`gen-status: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = isMainModule(import.meta.url)

if (isMain) {
  const repoRoot = resolve('.')
  const statusPath = join(repoRoot, 'docs', 'internal', 'PRODUCT', 'STATUS.md')
  const check = process.argv.includes('--check')
  const tryLive = process.argv.includes('--live')
  runCli(repoRoot, statusPath, check, { tryLive })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`gen-status: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
