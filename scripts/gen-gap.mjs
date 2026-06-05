#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/gen-gap.mjs
// Generate docs/PRODUCT/GAP.md — derived view of what is incomplete,
// unenforced, or parked. Ordered v1-blockers first.
//
// Usage:
//   node scripts/gen-gap.mjs           # regenerate (--write is default)
//   node scripts/gen-gap.mjs --write   # same as above
//   node scripts/gen-gap.mjs --check   # fail (exit 1) if GAP.md is stale
//
// Exported functions (for unit tests):
//   parseUnenforceable(stdout)          → EnforcementGap[]
//   collectData(root)                   → GapData
//   buildGap(data)                      → string
//   runCli(root, gapPath, check)        → Promise<number>  (0 = ok, 1 = stale/error)
//
// Fail-closed (INV-96): IO/parse errors return 1 rather than producing a partial file.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Types (JSDoc for editor support)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   id: string,
 *   area: string,
 *   status: 'Partial'|'Missing',
 *   missing: string,
 *   issue: string,
 *   severity: 'high'|'medium',
 *   blocksV1: boolean,
 * }} FeatureGap
 */

/**
 * @typedef {{
 *   signal: string,
 *   doc: string,
 *   line: number,
 *   severity: 'medium',
 *   blocksV1: false,
 * }} EnforcementGap
 */

/**
 * @typedef {{
 *   issue: string,
 *   title: string,
 *   status: string,
 *   severity: 'low',
 *   blocksV1: false,
 * }} KnownDebt
 */

/**
 * @typedef {{
 *   featureGaps: FeatureGap[],
 *   enforcementGaps: EnforcementGap[],
 *   knownDebt: KnownDebt[],
 *   lastReview: string,
 * }} GapData
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract frontmatter field from markdown content. */
function fmField(content, key) {
  const m = content.match(new RegExp(`${key}:\\s*['"]?([^'"\\n]+)['"]?`))
  return m ? m[1].trim() : null
}

/** Safe readdirSync wrapper — returns [] if directory is unreadable. */
function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Parse `[UNENFORCEABLE] signal — doc:line` lines from constraint-scan stdout.
 * Separator is em-dash U+2014, not a hyphen — a hyphen regex silently zeroes the section.
 * @param {string} stdout
 * @returns {Array<{signal: string, doc: string, line: number}>}
 */
export function parseUnenforceable(stdout) {
  const gaps = []
  for (const line of stdout.split('\n')) {
    // U+2014 em-dash between signal and doc:line
    const m = line.match(/^\[UNENFORCEABLE\]\s+(.+?)\s+—\s+(.+?):(\d+)$/)
    if (!m) continue
    gaps.push({ signal: m[1].trim(), doc: m[2].trim(), line: parseInt(m[3], 10) })
  }
  return gaps
}

/**
 * Parse the "## Residual Follow-Up Issue Summary" table from a convergence file.
 * @param {string} content
 * @returns {KnownDebt[]}
 */
function parseConvergenceDebt(content) {
  /** @type {KnownDebt[]} */
  const debt = []
  const section = content.match(/## Residual Follow-Up Issue Summary\n([\s\S]*?)(?=\n##|$)/)
  if (!section) return debt
  const lines = section[1].split('\n')
  let headerSeen = false
  for (const line of lines) {
    if (!headerSeen) {
      if (line.includes('| Issue |')) {
        headerSeen = true
      }
      continue
    }
    if (/^\|\s*-+\s*\|/.test(line)) continue
    const m = line.match(/^\|\s*(#\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/)
    if (!m) continue
    debt.push({
      issue: m[1].trim(),
      title: m[2].trim(),
      status: m[3].trim(),
      severity: 'low',
      blocksV1: false,
    })
  }
  return debt
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Collect source data for the GAP register.
 * Throws if FEATURE_MATRIX.md is missing (fail-closed INV-96).
 * Constraint-scan, convergence, and evidence sources are optional — return [] on failure.
 * @param {string} root
 * @returns {GapData}
 */
export function collectData(root) {
  const matrixPath = join(root, 'docs', 'PRODUCT', 'FEATURE_MATRIX.md')
  if (!existsSync(matrixPath)) throw new Error(`FEATURE_MATRIX.md not found: ${matrixPath}`)
  const matrixContent = readFileSync(matrixPath, 'utf-8')

  // Parse FEATURE_MATRIX rows — emit gap for Partial/Missing only
  /** @type {FeatureGap[]} */
  const featureGaps = []
  for (const line of matrixContent.split('\n')) {
    // feature_id | capability | kit_dims | level | status | code_ref | test_ref | doc_ref | issue_ref | note
    const m = line.match(
      /^\|\s*(REQ-\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|\s*(Partial|Missing)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/,
    )
    if (!m) continue
    const status = /** @type {'Partial'|'Missing'} */ (m[5])
    featureGaps.push({
      id: m[1].trim(),
      area: m[2].trim(),
      status,
      missing: m[10].trim(),
      issue: m[9].trim(),
      severity: status === 'Missing' ? 'high' : 'medium',
      blocksV1: status === 'Missing',
    })
  }

  const lastReview = fmField(matrixContent, 'last_review') ?? '2026-06-04'

  // Constraint scan — optional; empty array if script absent or errors
  /** @type {EnforcementGap[]} */
  const enforcementGaps = []
  try {
    const scanScript = join(root, 'scripts', 'check-constraint-scan.mjs')
    if (existsSync(scanScript)) {
      const result = spawnSync('node', [scanScript, '--enforce=false'], {
        encoding: 'utf-8',
        timeout: 60_000,
      })
      if (result.stdout) {
        for (const gap of parseUnenforceable(result.stdout)) {
          enforcementGaps.push({ ...gap, severity: 'medium', blocksV1: false })
        }
      }
    }
  } catch {
    // optional source — silently skip
  }

  // Known debt from the latest convergence file (optional)
  /** @type {KnownDebt[]} */
  const knownDebt = []
  const productDir = join(root, 'docs', 'PRODUCT')
  if (existsSync(productDir)) {
    const candidates = readdirSafe(productDir).filter((f) =>
      /^CONVERGENCE-\d{4}-\d{2}\.md$/.test(f),
    )
    if (candidates.length > 0) {
      const latest = candidates.sort().at(-1)
      if (latest) {
        try {
          const content = readFileSync(join(productDir, latest), 'utf-8')
          knownDebt.push(...parseConvergenceDebt(content))
        } catch {
          // optional — skip
        }
      }
    }
  }

  // Known debt from .arbiter/evidence/*/tech-debt.json (sorted for determinism)
  const evidenceDir = join(root, '.arbiter', 'evidence')
  if (existsSync(evidenceDir)) {
    for (const entry of readdirSafe(evidenceDir).sort()) {
      const debtPath = join(evidenceDir, entry, 'tech-debt.json')
      if (!existsSync(debtPath)) continue
      try {
        const json = JSON.parse(readFileSync(debtPath, 'utf-8'))
        if (Array.isArray(json.issues)) {
          for (const issue of json.issues) {
            knownDebt.push({
              issue: `#${issue}`,
              title: `Tech debt #${issue}`,
              status: 'Open',
              severity: 'low',
              blocksV1: false,
            })
          }
        }
      } catch {
        // malformed — skip
      }
    }
  }

  return { featureGaps, enforcementGaps, knownDebt, lastReview }
}

/**
 * Build the full GAP.md content from collected data.
 * Content is deterministic: same input → same output (no Date(), no random).
 * @param {GapData} data
 * @returns {string}
 */
export function buildGap(data) {
  const blockers = data.featureGaps.filter((g) => g.blocksV1)
  const allFeatureGaps = [...data.featureGaps].sort((a, b) => {
    if (a.blocksV1 !== b.blocksV1) return a.blocksV1 ? -1 : 1
    return a.id.localeCompare(b.id)
  })

  const v1BlockersSection =
    blockers.length > 0
      ? blockers
          .map(
            (g) =>
              `| ${g.id} | ${g.area} | ${g.status} | ${g.issue || '—'} | ${g.missing || '—'} |`,
          )
          .join('\n')
      : '_No v1-blocking gaps._'

  const featureGapsRows =
    allFeatureGaps.length > 0
      ? allFeatureGaps
          .map(
            (g) =>
              `| ${g.id} | ${g.area} | ${g.status} | ${g.severity} | ${g.blocksV1 ? 'yes' : 'no'} | ${g.issue || '—'} | ${g.missing || '—'} |`,
          )
          .join('\n')
      : '_No feature gaps._'

  const enforcementRows =
    data.enforcementGaps.length > 0
      ? data.enforcementGaps.map((g) => `| ${g.signal} | ${g.doc}:${g.line} | medium |`).join('\n')
      : '_No unenforceable constraints._'

  const knownDebtRows =
    data.knownDebt.length > 0
      ? data.knownDebt
          .map((d) => `| ${d.issue} | ${d.title} | ${d.status} | ${d.severity} |`)
          .join('\n')
      : '_No known debt._'

  return `---
title: 'GAP — arbiter gap register'
doc_version: '1.0.0'
status: active
last_review: '${data.lastReview}'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/pm', 'kind/product']
related: ['PRODUCT/FEATURE_MATRIX.md', 'PRODUCT/STATUS.md', 'INDEX.md']
---

# GAP — arbiter gap register

> Generated from FEATURE_MATRIX.md · constraint-scan · convergence reports.
> Refresh: \`node scripts/gen-gap.mjs --write\`. Gate: \`node scripts/gen-gap.mjs --check\`.

<!-- GAP_START -->

## v1 Blockers

${
  blockers.length > 0
    ? `| feature_id | capability | status | issue | missing |
| --- | --- | --- | --- | --- |
${v1BlockersSection}`
    : 'No v1-blocking gaps.'
}

## Feature Gaps

| feature_id | capability | status | severity | blocks_v1 | issue | missing |
| --- | --- | --- | --- | --- | --- | --- |
${featureGapsRows}

## Enforcement Gaps

| constraint | location | severity |
| --- | --- | --- |
${enforcementRows}

## Known Debt

| issue | title | status | severity |
| --- | --- | --- | --- |
${knownDebtRows}

<!-- GAP_END -->
`
}

/**
 * Format raw markdown via prettier with the project config (same as `npx prettier --write`).
 * resolveConfig(filepath) walks up from filepath to find .prettierrc — project config applied,
 * tmpdir tests get defaults (no .prettierrc found → null → empty config).
 */
async function prettify(raw, filepath) {
  const { format, resolveConfig } = await import('prettier')
  const config = (await resolveConfig(filepath)) ?? {}
  return format(raw, { ...config, parser: 'markdown' })
}

/**
 * Write or check GAP.md.
 * Returns 0 on success, 1 on stale/error. Does not call process.exit — exported for testing.
 * @param {string} root
 * @param {string} gapPath
 * @param {boolean} check
 * @returns {Promise<number>}
 */
export async function runCli(root, gapPath, check) {
  try {
    const data = collectData(root)
    const generated = await prettify(buildGap(data), gapPath)
    if (check) {
      const current = existsSync(gapPath) ? readFileSync(gapPath, 'utf-8') : ''
      if (current !== generated) {
        process.stderr.write(
          'docs/PRODUCT/GAP.md is stale. Run `node scripts/gen-gap.mjs --write` and commit the result.\n',
        )
        return 1
      }
      process.stdout.write('docs/PRODUCT/GAP.md is up to date.\n')
      return 0
    }
    writeFileSync(gapPath, generated)
    process.stdout.write(`Wrote ${gapPath}\n`)
    return 0
  } catch (err) {
    process.stderr.write(`gen-gap: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const repoRoot = resolve('.')
  const gapPath = join(repoRoot, 'docs', 'PRODUCT', 'GAP.md')
  const check = process.argv.includes('--check')
  runCli(repoRoot, gapPath, check)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`gen-gap: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
