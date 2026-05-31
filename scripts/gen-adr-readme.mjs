#!/usr/bin/env node
// Generates docs/ADR/README.md from docs/ADR/NNN-*.md per-file SSOT.
// Usage:
//   node scripts/gen-adr-readme.mjs          # write
//   node scripts/gen-adr-readme.mjs --check  # exit 1 if out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const ADR_DIR = join(root, 'docs', 'ADR')
const README_PATH = join(ADR_DIR, 'README.md')
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

const STATIC_HEADER = `---
title: 'Architectural Decision Records'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/adr']
related: []
---

# Architectural Decision Records

This directory contains the Architectural Decision Records (ADRs) for the Arbiter project. Each ADR captures a significant design decision, its context, rationale, and consequences.

> **SSOT:** \`docs/ADR/\` is the canonical ADR source (since Wave 2, 2026-05-31).
> \`docs/SYSTEM/DECISIONS.md\` is a frozen legacy log; do not append to it.

## Process

1. Create \`NNN-short-title.md\` in this directory (next free number after 074)
2. Copy from \`ADR-000_template.md\`
3. Set \`canonical_id\` to the 3-digit number
4. Run \`node scripts/gen-adr-readme.mjs\` to refresh this index
5. Status: \`proposed\` → \`active\` after review; \`superseded\` with a note when replaced

## Index

`

const generated = STATIC_HEADER + tableHeader + '\n' + tableRows.join('\n') + '\n'

if (CHECK) {
  const current = existsSync(README_PATH) ? readFileSync(README_PATH, 'utf-8') : ''
  if (current !== generated) {
    process.stdout.write(
      '  gen-adr-readme: README.md is out of date — run node scripts/gen-adr-readme.mjs\n',
    )
    process.exit(1)
  }
  process.stdout.write(`  gen-adr-readme: README.md is up to date (${rows.length} ADRs)\n`)
  process.exit(0)
}

writeFileSync(README_PATH, generated, 'utf-8')
process.stdout.write(`  gen-adr-readme: wrote README.md (${rows.length} ADRs)\n`)
