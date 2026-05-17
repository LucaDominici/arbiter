#!/usr/bin/env node
// Gate: verify KNOWLEDGE_MAP.md line counts match actual docs within tolerance. (INV-56, #255)
// Exits 0: all populated entries within tolerance, or no KNOWLEDGE_MAP.md found.
// Exits 1: one or more entries have drifted beyond tolerance.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CWD = process.cwd()
const KM_FILE = join(CWD, 'docs', 'METHOD', 'KNOWLEDGE_MAP.md')
const TOLERANCE = 0.3

if (!existsSync(KM_FILE)) {
  process.stdout.write('  check-knowledge-map: no KNOWLEDGE_MAP.md found — skipping\n')
  process.exit(0)
}

const content = readFileSync(KM_FILE, 'utf-8')

// Parse **Location:** `path` followed by **Lines:** NNN pairs
const ENTRY_PATTERN = /\*\*Location:\*\*\s+`([^`]+)`[^\n]*\n\*\*Lines:\*\*\s+(\d+)/g

const drifted = []
for (const match of content.matchAll(ENTRY_PATTERN)) {
  const filePath = match[1]
  const stored = parseInt(match[2], 10)

  if (stored === 0) continue

  const abs = join(CWD, filePath)
  if (!existsSync(abs)) continue

  const text = readFileSync(abs, 'utf-8')
  const actual = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  const delta = Math.abs(actual - stored) / Math.max(stored, 1)
  if (delta > TOLERANCE) {
    drifted.push({ path: filePath, stored, actual })
  }
}

if (drifted.length === 0) {
  process.stdout.write('  check-knowledge-map: all line counts within tolerance\n')
  process.exit(0)
}

process.stdout
  .write(`  check-knowledge-map: ${drifted.length} drift(s) detected in KNOWLEDGE_MAP.md:
`)
for (const { path, stored, actual } of drifted) {
  process.stdout.write(`    drift: ${path} (stored ${stored}, actual ${actual})
`)
}
process.exit(1)
