#!/usr/bin/env node
// INV-51 / CANON-08: catalog ↔ AGENTS.md parity (bidirectional, #485).
// Every catalog INV-NN must appear in AGENTS.md with matching title, AND every
// **INV-NN:** / **CANON-NN:** row in AGENTS.md must point at an existing
// catalog / CANON.md entry (no phantom rows).
//
// Usage: node scripts/check-catalog-agents-parity.mjs \
//   [--catalog=path] [--agents=path] [--canon=path]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const agentsArg = args.find((a) => a.startsWith('--agents='))
const canonArg = args.find((a) => a.startsWith('--canon='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const agentsPath = agentsArg ? resolve(agentsArg.split('=')[1]) : resolve(root, 'AGENTS.md')
const canonPath = canonArg ? resolve(canonArg.split('=')[1]) : resolve(root, 'docs/SYSTEM/CANON.md')

const catalogSrc = readFileSync(catalogPath, 'utf-8')
const agentsSrc = readFileSync(agentsPath, 'utf-8')
// CANON.md is optional — only required for the CANON reverse loop. If absent,
// the script behaves as before (INV-only parity).
let canonSrc = ''
try {
  canonSrc = readFileSync(canonPath, 'utf-8')
} catch {
  canonSrc = ''
}

// Extract {id, title} pairs from catalog.ts.
// IDs are always single-quoted; titles may use single or double quotes, and may
// span two lines. The single-line and multi-line paths both try single-quoted
// first, then double-quoted, so a title containing the OTHER quote flavor
// round-trips correctly (#486).
const catalogEntries = new Map()
let currentId = null
let titlePending = false
for (const line of catalogSrc.split('\n')) {
  const idMatch = line.match(/id:\s*'(INV-\d+)'/)
  if (idMatch) {
    currentId = idMatch[1]
    titlePending = false
    continue
  }
  if (currentId) {
    if (titlePending) {
      // Mirror the single-line path: try ' then " so an embedded quote of the
      // opposite flavor doesn't truncate the title.
      const t = line.match(/^\s*'([^']+)'/) ?? line.match(/^\s*"([^"]+)"/)
      if (t) {
        catalogEntries.set(currentId, t[1])
        currentId = null
        titlePending = false
      }
      continue
    }
    if (/title:\s*$/.test(line.trimEnd())) {
      titlePending = true
      continue
    }
    const titleMatch = line.match(/title:\s*'([^']+)'/) ?? line.match(/title:\s*"([^"]+)"/)
    if (titleMatch) {
      catalogEntries.set(currentId, titleMatch[1])
      currentId = null
    }
  }
}
// Guard: titlePending still set at EOF means title could not be parsed
if (titlePending && currentId) {
  console.error(`[check-catalog-agents-parity] ERROR: could not parse title for ${currentId}`)
  process.exit(2)
}

// Extract {id, title} pairs from AGENTS.md: format is **INV-NN:** title
const agentsInvEntries = new Map()
for (const m of agentsSrc.matchAll(/\*\*(INV-\d+):\*\*\s*(.+)/g)) {
  agentsInvEntries.set(m[1], m[2].trim())
}

// Extract **CANON-NN:** ids from AGENTS.md (no title-parity check today; CANON
// titles in AGENTS.md, when present, are informal cross-references).
const agentsCanonIds = new Set()
for (const m of agentsSrc.matchAll(/\*\*(CANON-\d+):\*\*/g)) {
  agentsCanonIds.add(m[1])
}

// Extract `## CANON-NN` headings from CANON.md.
const canonIds = new Set()
for (const m of canonSrc.matchAll(/^##\s+(CANON-\d+)\b/gm)) {
  canonIds.add(m[1])
}

let violations = 0

// Forward: every catalog INV must be in AGENTS.md with matching title.
for (const [id, catalogTitle] of catalogEntries) {
  const agentsTitle = agentsInvEntries.get(id)
  if (!agentsTitle) {
    console.log(`  MISSING from AGENTS.md: ${id}`)
    violations++
    continue
  }
  if (agentsTitle !== catalogTitle) {
    console.log(`  TITLE MISMATCH: ${id}`)
    console.log(`    catalog: ${catalogTitle}`)
    console.log(`    agents:  ${agentsTitle}`)
    violations++
  }
}

// Reverse (#485): every **INV-NN:** in AGENTS.md must have a catalog entry.
for (const id of agentsInvEntries.keys()) {
  if (!catalogEntries.has(id)) {
    console.log(`  ORPHAN in AGENTS.md: ${id} (no entry in catalog)`)
    violations++
  }
}

// Reverse (#485): every **CANON-NN:** in AGENTS.md must have a `## CANON-NN`
// heading in CANON.md. If CANON.md is missing entirely the check is skipped
// (canonSrc is the empty string, so we only flag when canonSrc was loaded).
if (canonSrc) {
  for (const id of agentsCanonIds) {
    if (!canonIds.has(id)) {
      console.log(`  ORPHAN in AGENTS.md: ${id} (no heading in CANON.md)`)
      violations++
    }
  }
}

if (violations > 0) {
  console.log(
    `[check-catalog-agents-parity] FAIL: ${violations} parity violation(s) between catalog/CANON.md and AGENTS.md`,
  )
  process.exit(1)
}
console.log(
  `[check-catalog-agents-parity] OK — ${catalogEntries.size} catalog IDs and ${agentsCanonIds.size} CANON refs in AGENTS.md verified (bidirectional)`,
)
