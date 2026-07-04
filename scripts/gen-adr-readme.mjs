#!/usr/bin/env node
// Generates docs/internal/ADR/README.md and docs/internal/SYSTEM/DECISIONS.md from
// docs/internal/ADR/NNN-*.md per-file SSOT.
// Usage:
//   node scripts/gen-adr-readme.mjs          # write both files
//   node scripts/gen-adr-readme.mjs --check  # exit 1 if either is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const ADR_DIR = join(root, 'docs', 'internal', 'ADR')
const README_PATH = join(ADR_DIR, 'README.md')
const DECISIONS_PATH = join(root, 'docs', 'internal', 'SYSTEM', 'DECISIONS.md')
const CHECK = process.argv.includes('--check')
const NUMBERED = /^(\d{3})-(.+)\.md$/

function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text)
  if (match === null) return {}
  const fm = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fm[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return fm
}

/** Extract a one-line summary from ADR body (first sentence of Decision section). */
function extractSummary(text) {
  const m = /\*\*Decisions?:\*\*\s*([^\n]+)/.exec(text)
  if (m !== null) {
    const s = m[1].replace(/[*`]/g, '').trim()
    return s.length > 110 ? s.slice(0, 107) + '...' : s
  }
  return ''
}

try {
  const files = readdirSync(ADR_DIR)
    .filter((f) => NUMBERED.test(f))
    .sort()

  const rows = []
  for (const file of files) {
    const match = NUMBERED.exec(file)
    if (match === null) continue
    const num = match[1]
    const text = readFileSync(join(ADR_DIR, file), 'utf-8')
    const fm = parseFrontmatter(text)
    const rawTitle = (fm['title'] ?? file).replace(/^ADR-\d+[:\s—–-]+/, '').trim()
    const status = fm['status'] === 'active' ? 'Accepted' : (fm['status'] ?? 'Accepted')
    const date = fm['last_review'] ?? ''
    const summary = extractSummary(text)
    rows.push({ num, file, title: rawTitle, status, date, summary })
  }

  // Use the most recent ADR date as the digest's last_review (deterministic, not new Date())
  const latestDate = [...rows.map((r) => r.date)].filter(Boolean).sort().at(-1) ?? '2026-01-01'

  // Calculate column widths for alignment
  const maxTitle = Math.max(5, ...rows.map((r) => `[${r.title}](${r.file})`.length))
  const maxStatus = Math.max(6, ...rows.map((r) => r.status.length))
  const maxSummary = Math.max(7, ...rows.map((r) => r.summary.length))

  function pad(s, n) {
    return s + ' '.repeat(Math.max(0, n - s.length))
  }

  const tableHeader = [
    `| ${'#'.padEnd(4)} | ${pad('Title', maxTitle)} | ${pad('Status', maxStatus)} | Date       | ${pad('Summary', maxSummary)} |`,
    `| ${'-'.repeat(4)} | ${'-'.repeat(maxTitle)} | ${'-'.repeat(maxStatus)} | ---------- | ${'-'.repeat(maxSummary)} |`,
  ].join('\n')

  const tableRows = rows.map((r) => {
    const link = `[${r.title}](${r.file})`
    return `| ${r.num} | ${pad(link, maxTitle)} | ${pad(r.status, maxStatus)} | ${r.date} | ${r.summary} |`
  })

  // ── README.md ──────────────────────────────────────────────────────────────
  // Use latestDate (derived from ADR frontmatter) for deterministic --check.
  // new Date() would cause the --check gate to fail every day after a write.
  const README_HEADER = `---
title: 'Architectural Decision Records'
doc_version: '1.0.0'
status: active
last_review: '${latestDate}'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# Architectural Decision Records

This directory contains the Architectural Decision Records (ADRs) for the Arbiter project. Each ADR captures a significant design decision, its context, rationale, and consequences.

> **SSOT:** \`docs/ADR/\` is the canonical ADR source (since Wave 2, 2026-05-31).
> \`docs/SYSTEM/DECISIONS.md\` is a generated digest — do not edit it directly.

## Process

1. Create \`NNN-short-title.md\` in this directory (next free number after ${rows.length > 0 ? rows[rows.length - 1].num : '076'})
2. Copy from \`ADR-000_template.md\`
3. Set \`canonical_id\` to the 3-digit number
4. Run \`node scripts/gen-adr-readme.mjs\` to refresh this index and DECISIONS.md digest
5. Status: \`proposed\` → \`active\` after review; \`superseded\` with a note when replaced

## Index

`

  const generatedReadme = README_HEADER + tableHeader + '\n' + tableRows.join('\n') + '\n'

  // ── DECISIONS.md digest (deterministic — uses latest ADR date, not new Date()) ──
  const digestRows = rows.map((r) => {
    const link = `[${r.title}](../ADR/${r.file})`
    return `| ${r.num} | ${link} | ${r.status} | ${r.date} |`
  })

  const DECISIONS_DIGEST = `---
title: 'Architectural Decision Records — Generated Digest'
doc_version: '1.0.0'
status: generated
last_review: '${latestDate}'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# Architectural Decision Records — Generated Digest

> **GENERATED — do not edit.** Run \`node scripts/gen-adr-readme.mjs\` to regenerate.
> Canonical ADR source: \`docs/ADR/\` — see [docs/ADR/README.md](../ADR/README.md) for the full index.
> Historical prose log preserved in git history prior to consolidation (2026-06-02).

## ADR Index

| # | Title | Status | Date |
|---|-------|--------|------|
${digestRows.join('\n')}
`

  if (CHECK) {
    let failures = 0

    const currentReadme = existsSync(README_PATH) ? readFileSync(README_PATH, 'utf-8') : ''
    if (currentReadme !== generatedReadme) {
      process.stdout.write(
        '  gen-adr-readme: README.md is out of date — run node scripts/gen-adr-readme.mjs\n',
      )
      failures++
    } else {
      process.stdout.write(`  gen-adr-readme: README.md is up to date (${rows.length} ADRs)\n`)
    }

    const currentDecisions = existsSync(DECISIONS_PATH) ? readFileSync(DECISIONS_PATH, 'utf-8') : ''
    if (currentDecisions !== DECISIONS_DIGEST) {
      process.stdout.write(
        '  gen-adr-readme: DECISIONS.md digest is out of date — run node scripts/gen-adr-readme.mjs\n',
      )
      failures++
    } else {
      process.stdout.write(`  gen-adr-readme: DECISIONS.md digest is up to date\n`)
    }

    // process.exit(1) = drift (INV-53); fail-closed audit requires literal exit(1)
    if (failures > 0) process.exit(1)
    process.exit(0)
  }

  writeFileSync(README_PATH, generatedReadme, 'utf-8')
  process.stdout.write(`  gen-adr-readme: wrote README.md (${rows.length} ADRs)\n`)

  writeFileSync(DECISIONS_PATH, DECISIONS_DIGEST, 'utf-8')
  process.stdout.write(`  gen-adr-readme: wrote DECISIONS.md digest\n`)
} catch (err) {
  // Exit 2 = invocation/fatal error (INV-53: 0=PASS, 1=FAIL/drift, 2=ERROR)
  process.stdout.write(`  gen-adr-readme: fatal — ${err.message}\n`)
  process.exit(2)
}
