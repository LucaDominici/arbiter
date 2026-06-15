#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — gold report generator (#1375). Renders an updatable GOLD-REPORT.md from the
// deterministic doc-set audit (scripts/check-doc-set.mjs) plus a placeholder for the
// code-quality gold engine (tracked in #1373). Numbers come from code, never from an AI.
//
// Exit codes: 0 = wrote/ok, 1 = stale/error.
//
// Usage:
//   node scripts/gold-report.mjs            # (re)write GOLD-REPORT.md
//   node scripts/gold-report.mjs --check    # exit 1 if committed GOLD-REPORT.md is stale
//   node scripts/gold-report.mjs --out P    # write to a different path
//   node scripts/gold-report.mjs --help

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/gold-report.mjs [--check] [--out PATH] [--help]',
      '',
      'Renders an updatable GOLD-REPORT.md from the deterministic doc-set audit.',
      '  --check     exit 1 if the committed report is stale vs the current audit',
      '  --out PATH  output path (default GOLD-REPORT.md)',
      '  --help, -h  show this help',
      '',
    ].join('\n'),
  )
  process.exit(0)
}
const CWD = process.cwd()
const optOut = () => {
  const i = args.indexOf('--out')
  return i >= 0 && args[i + 1] ? args[i + 1] : 'GOLD-REPORT.md'
}
const OUT = optOut()
const GEN_PREFIX = '<!-- generated:' // volatile line (HTML comment), excluded from --check

function audit() {
  const raw = execFileSync('node', ['scripts/check-doc-set.mjs', '--json'], { cwd: CWD })
  return JSON.parse(raw.toString())
}

/** Code-computed gold-audit engine output (#1373) — null if the engine/registry is absent. */
function goldAudit() {
  try {
    const raw = execFileSync('node', ['scripts/gold-audit.mjs', '--json'], { cwd: CWD })
    const text = raw.toString().trim()
    // The engine emits clean JSON to stdout; a SKIP line (no registry) is not JSON.
    if (!text.startsWith('{')) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Render a GitHub-Flavored-Markdown table with prettier-compatible column padding (so the
 * generated GOLD-REPORT.md passes `prettier --check` without a post-format step). Each column
 * is padded to its widest cell; the separator row uses `-` repeated to the same width.
 */
function gfmTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length), 3),
  )
  const fmt = (cells) => `| ${cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ')} |`
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`
  return [fmt(headers), sep, ...rows.map(fmt)].join('\n')
}

/** Render the code-quality gold-engine section from the deterministic gold-audit payload. */
function renderCodeQuality(g) {
  if (!g) {
    return [
      '## Code-quality gold engine',
      '',
      '_Registry absent — add `standards/gold-registry.yml` and run `node scripts/gold-audit.mjs`._',
      '',
    ].join('\n')
  }
  const dimEntries = Object.entries(g.dimensions)
  const dimTable = dimEntries.length
    ? gfmTable(
        ['Dimension', 'Score', 'Y-checks'],
        dimEntries.map(([id, d]) => [id, `${d.score}%`, String(d.y)]),
      )
    : '_No dimensions scored._'
  const riskyNote =
    g.riskyCount > 0
      ? `**False-gap meta-gate: ${g.riskyCount} RISKY check(s) — scoring is suppressed until resolved.**`
      : 'False-gap meta-gate: clean (0 RISKY checks).'
  return [
    '## Code-quality gold engine',
    '',
    `**Score: ${g.score}% · Y ${g.yCount}/${g.totals.checks} checks** ` +
      `(N ${g.totals.n} · P ${g.totals.p} · NA ${g.totals.na} · NV ${g.totals.nv}).`,
    '',
    riskyNote,
    '',
    dimTable,
    '',
    'Engine: `node scripts/gold-audit.mjs` (registry-driven, code-computed, deterministic — no AI). ' +
      'No-regress gate: `node scripts/gold-audit.mjs --check`.',
    '',
  ].join('\n')
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: CWD }).toString().trim()
  } catch {
    return 'unknown'
  }
}

function render(a) {
  const t = a.totals
  const docScore = t.applicable ? ((t.present / t.applicable) * 100).toFixed(1) : '0.0'
  const gaps = [
    ...a.missingMandatory.map((p) => `| ${p} | mandatory | MISSING |`),
    ...a.missingRecommended.map((p) => `| ${p} | recommended | missing |`),
  ]
  const gapTable = gaps.length
    ? ['| Doc | Tier | Status |', '| --- | --- | --- |', ...gaps].join('\n')
    : '_No gaps — every applicable doc is present._'
  return [
    '# Gold Report — arbiter',
    '',
    `${GEN_PREFIX} ${new Date().toISOString()} @ ${gitHead()} — regenerate with: node scripts/gold-report.mjs ; numbers are code-computed (no AI) -->`,
    '',
    '## Documentation (gold doc-set)',
    '',
    `**Score: ${t.present}/${t.applicable} applicable docs present (${docScore}%).** ` +
      `Mandatory gaps: ${t.missingMandatory} · recommended gaps: ${t.missingRecommended} · n/a (overlay off): ${t.na}.`,
    '',
    `Manifest: \`${a.manifest}\` · overlays: ${a.profile.overlays.length ? a.profile.overlays.join(', ') : '(none)'}`,
    '',
    gapTable,
    '',
    'Refresh / scaffold missing docs: `node scripts/check-doc-set.mjs --generate`.',
    '',
    renderCodeQuality(goldAudit()),
  ].join('\n')
}

/** Strip the volatile generated-line so --check compares only substantive content. */
function substantive(s) {
  return s
    .split('\n')
    .filter((l) => !l.startsWith(GEN_PREFIX))
    .join('\n')
}

function main() {
  const content = render(audit())
  const outAbs = join(CWD, OUT)
  if (args.includes('--check')) {
    if (!existsSync(outAbs)) {
      process.stderr.write(
        `gold-report: ${OUT} is missing. Run \`node scripts/gold-report.mjs\`.\n`,
      )
      return 1
    }
    const current = readFileSync(outAbs, 'utf-8')
    if (substantive(current) !== substantive(content)) {
      process.stderr.write(
        `gold-report: ${OUT} is stale. Run \`node scripts/gold-report.mjs\` and commit.\n`,
      )
      return 1
    }
    process.stdout.write(`gold-report: ${OUT} is up to date.\n`)
    return 0
  }
  writeFileSync(outAbs, content)
  process.stdout.write(`gold-report: wrote ${OUT}\n`)
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`gold-report: unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}
