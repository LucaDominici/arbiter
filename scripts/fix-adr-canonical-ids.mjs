#!/usr/bin/env node
// One-time: populate canonical_id in all docs/ADR/NNN-*.md files + fix 041-044 titles.
// Usage: node scripts/fix-adr-canonical-ids.mjs [--dry-run]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ADR_DIR = resolve('docs', 'ADR')
const DRY_RUN = process.argv.includes('--dry-run')
const NUMBERED = /^(\d{3})-(.+)\.md$/

// Title fixes for mis-titled 041-044 files
const TITLE_FIXES = {
  '041': 'ADR-041: Task Workflow via /task Slash Command',
  '042': 'ADR-042: Three-Tier Gate System (L1/L2/L3)',
  '043': 'ADR-043: Docs Site Information Architecture',
  '044': 'ADR-044: Docs Site Versioning Strategy',
}
const H1_FIXES = {
  '041': '# ADR-041: Task Workflow via /task Slash Command',
  '042': '# ADR-042: Three-Tier Gate System (L1/L2/L3)',
  '043': '# ADR-043: Docs Site Information Architecture',
  '044': '# ADR-044: Docs Site Versioning Strategy',
}
const OLD_H1 = {
  '041': '# ADR-001: Task Workflow via /task Slash Command',
  '042': '# ADR-002: Three-Tier Gate System (L1/L2/L3)',
  '043': '# ADR-003: Docs Site Information Architecture',
  '044': '# ADR-004: Docs Site Versioning Strategy',
}

try {
  const files = readdirSync(ADR_DIR)
    .filter((f) => NUMBERED.test(f))
    .sort()
  let patched = 0
  let titleFixed = 0

  for (const file of files) {
    const match = NUMBERED.exec(file)
    if (match === null) continue
    const num = match[1]
    const path = join(ADR_DIR, file)
    let text = readFileSync(path, 'utf-8')
    let changed = false

    // Patch canonical_id if empty or wrong
    const canonicalMatch = /^(canonical_id:\s*)['"]([^'"]*)['"]/m.exec(text)
    if (canonicalMatch !== null) {
      const current = canonicalMatch[2]
      if (current !== num) {
        text = text.replace(/^(canonical_id:\s*)['"][^'"]*['"]/m, `$1'${num}'`)
        changed = true
      }
    }

    // Fix title field for 041-044
    if (num in TITLE_FIXES) {
      const wrongTitle = text.match(/^title: '.*ADR-00[1-4].*'/m)
      if (wrongTitle !== null) {
        text = text.replace(/^(title: ').*(')/m, `$1${TITLE_FIXES[num]}'`)
        changed = true
        titleFixed++
      }
      // Fix H1 heading
      if (num in OLD_H1 && text.includes(OLD_H1[num])) {
        text = text.replace(OLD_H1[num], H1_FIXES[num])
        changed = true
      }
    }

    if (changed) {
      if (DRY_RUN) {
        process.stdout.write(`  [dry-run] would patch: ${file}\n`)
      } else {
        writeFileSync(path, text, 'utf-8')
        process.stdout.write(`  patched: ${file}\n`)
      }
      patched++
    }
  }

  process.stdout.write(`\nPatched: ${patched} files (${titleFixed} title fixes)\n`)
} catch (err) {
  process.stdout.write(`  fix-adr-canonical-ids: fatal — ${err.message}\n`)
  process.exit(1)
}
