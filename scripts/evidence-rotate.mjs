#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — evidence harness rotation (#91)
// Keeps the last N evidence runs in .evidence/, removes older ones.
// Usage: node scripts/evidence-rotate.mjs
import { readdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE_DIR = '.evidence'
const KEEP_LAST = 5

if (!existsSync(EVIDENCE_DIR)) {
  process.stdout.write(`[evidence-rotate] ${EVIDENCE_DIR}/ not found — nothing to rotate\n`)
  process.exit(0)
}

// Collect run directories (direct children only, sorted by name ascending)
const entries = readdirSync(EVIDENCE_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

if (entries.length <= KEEP_LAST) {
  process.stdout.write(
    `[evidence-rotate] ${entries.length} run(s) — within limit of ${KEEP_LAST}, nothing removed\n`,
  )
  process.exit(0)
}

const toRemove = entries.slice(0, entries.length - KEEP_LAST)
for (const name of toRemove) {
  const fullPath = join(EVIDENCE_DIR, name)
  rmSync(fullPath, { recursive: true, force: true })
  process.stdout.write(`[evidence-rotate] removed ${fullPath}\n`)
}
process.stdout.write(`[evidence-rotate] kept last ${KEEP_LAST} run(s)\n`)
