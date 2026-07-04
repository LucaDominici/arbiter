#!/usr/bin/env node
// Gate: SSOT_CORE_SET.md integrity — two complementary directions.
//   INV-54  (#255): every file LISTED in SSOT_CORE_SET.md exists on disk (forward).
//   INV-108 (#1100): every doc that QUALIFIES as a canonical SSOT doc is LISTED
//                    (reverse / exhaustiveness). The qualifying predicate lives in
//                    scripts/gen-ssot-core.mjs (selectSsotDocs) so the generator
//                    that writes the list and this gate that audits it cannot
//                    diverge.
// Exits 0: all listed files exist AND every qualifying doc is listed (or no
//          SSOT_CORE_SET.md found — bootstrap mode).
// Exits 1: a listed file is missing, OR a qualifying doc is unlisted.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { selectSsotDocs } from './gen-ssot-core.mjs'

const SSOT_FILE = join(process.cwd(), 'docs', 'internal', 'METHOD', 'SSOT_CORE_SET.md')

if (!existsSync(SSOT_FILE)) {
  process.stdout.write('  check-ssot-core: no SSOT_CORE_SET.md found — skipping (bootstrap mode)\n')
  process.exit(0)
}

const content = readFileSync(SSOT_FILE, 'utf-8')

// Match bullet items with backtick-quoted paths: - `path/to/file.md` — ...
const PATH_ITEM = /^[ \t]*-[ \t]+`([^`]+)`/gm

const listed = new Set()
const missing = []
let m
while ((m = PATH_ITEM.exec(content)) !== null) {
  const filePath = m[1]
  listed.add(filePath)
  if (!existsSync(join(process.cwd(), filePath))) {
    missing.push(filePath)
  }
}

// INV-108: every qualifying doc on disk must appear in the listed set.
// Fail-closed (INV-96): a walk/parse error must fail the gate, not crash with a
// raw stack trace or silently pass.
let unlisted
try {
  unlisted = selectSsotDocs(process.cwd())
    .map((r) => r.relPath)
    .filter((p) => !listed.has(p))
} catch (err) {
  process.stderr.write(
    `  check-ssot-core: failed to compute qualifying SSOT docs (INV-108): ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}

if (missing.length === 0 && unlisted.length === 0) {
  process.stdout.write(
    '  check-ssot-core: all SSOT_CORE_SET entries exist + inventory exhaustive\n',
  )
  process.exit(0)
}

if (missing.length > 0) {
  process.stdout.write(
    `  check-ssot-core: ${missing.length} missing file(s) listed in SSOT_CORE_SET.md (INV-54):\n`,
  )
  for (const f of missing) process.stdout.write(`    missing: ${f}\n`)
}

if (unlisted.length > 0) {
  process.stdout.write(
    `  check-ssot-core: ${unlisted.length} qualifying doc(s) absent from SSOT_CORE_SET.md (INV-108):\n`,
  )
  for (const f of unlisted) process.stdout.write(`    qualifying-but-unlisted: ${f}\n`)
  process.stdout.write('    Run `node scripts/gen-ssot-core.mjs` and commit the result.\n')
}

process.exit(1)
