#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/gen-status.mjs
// Generate docs/internal/PRODUCT/STATUS.md — living product dashboard derived from
// FEATURE_MATRIX.md, MILESTONES.md, and PRD.md.
//
// Usage:
//   node scripts/gen-status.mjs           # regenerate (--write is default)
//   node scripts/gen-status.mjs --write   # same as above
//   node scripts/gen-status.mjs --check   # fail (exit 1) if STATUS.md is stale
//
// Exported functions (for unit tests):
//   collectData(root)               → StatusData
//   buildStatus(data)               → string
//   runCli(root, statusPath, check) → Promise<number>  (0 = ok, 1 = stale/error)
//
// Fail-closed (INV-96): IO/parse errors return 1 rather than producing a partial file.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fmField, readdirSafe, prettify } from './lib/gen-doc-helpers.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

// ---------------------------------------------------------------------------
// Types (JSDoc for editor support)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   counts: {Verified: number, Done: number, Partial: number, Missing: number},
 *   partialReqs: string[],
 *   missingReqs: string[],
 *   mission: string,
 *   currentMilestone: string | null,
 *   openMilestones: string[],
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

/** Parse milestone entries: returns array of {title, done}.
 *  Only includes headings that start with "M<digits>" (actual milestones, not section headers). */
function parseMilestones(content) {
  const results = []
  for (const line of content.split('\n')) {
    const m = line.match(/^##\s+(M\d+\b.*)$/)
    if (!m) continue
    const raw = m[1].trim()
    // Match any common done/shipped marker variant
    const done = /[✅✓]/.test(raw) || /\b(DONE|SHIPPED)\b/.test(raw)
    const title = raw.replace(/\s*[✅✓]\s*(DONE|SHIPPED|)\s*/g, '').trim()
    results.push({ title, done })
  }
  return results
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Collect source data from the three input files.
 * Throws if any required source file is missing or unreadable.
 */
export function collectData(root) {
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

  const milestones = parseMilestones(milestonesContent)
  const openMilestones = milestones.filter((m) => !m.done).map((m) => m.title)
  const currentMilestone = openMilestones[0] ?? null

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
    currentMilestone,
    openMilestones,
    lastReview,
    convergenceFile,
  }
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

  const milestoneSection =
    data.currentMilestone !== null
      ? `\n## Current Milestone\n\n${data.currentMilestone}\n`
      : '\n## Current Milestone\n\nAll milestones complete.\n'

  const roadmapSection =
    data.openMilestones.length > 0
      ? `\n## Open Milestones\n\n${data.openMilestones.map((m) => `- ${m}`).join('\n')}\n`
      : '\n## Open Milestones\n\nNone — all milestones complete.\n'

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
${partialLine}${missingLine}${milestoneSection}${roadmapSection}
## Navigation

| Document | Purpose |
| ---------------------------------------- | ------------------------------------------------------- |
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Product truth RTM — ${total} requirements with evidence |
| [INDEX.md](../../INDEX.md) | Every governance doc in one inventory |
| [PRD.md](PRD.md) | Product requirements, personas, and governance levels |
${convergenceRow}<!-- STATUS_END -->
`
}

/**
 * Write or check STATUS.md.
 * Returns 0 on success, 1 on stale/error. Does not call process.exit — exported for testing.
 */
export async function runCli(root, statusPath, check) {
  try {
    const data = collectData(root)
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
  runCli(repoRoot, statusPath, check)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`gen-status: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
