#!/usr/bin/env node
// INV-51 / CANON-08: catalog ↔ AGENTS.md parity (bidirectional, #485).
// Every catalog INV-NN must appear in AGENTS.md with matching title, AND every
// **INV-NN:** / **CANON-NN:** row in AGENTS.md must point at an existing
// catalog / CANON.md entry (no phantom rows).
//
// Usage: node scripts/check-catalog-agents-parity.mjs \
//   [--catalog=path] [--agents=path] [--canon=path]
import { readFileSync, existsSync } from 'node:fs'
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
// canonPath is only resolved when --canon is explicitly passed OR when running against real
// repo files (no --catalog/--agents override). Fixture-only tests skip canon checks entirely.
const canonPath =
  canonArg != null
    ? resolve(canonArg.split('=')[1])
    : catalogArg == null && agentsArg == null
      ? resolve(root, 'docs/internal/SYSTEM/CANON.md')
      : null

const catalogSrc = readFileSync(catalogPath, 'utf-8')
const agentsSrc = readFileSync(agentsPath, 'utf-8')
// CANON.md is optional — only loaded when explicitly requested or when using real repo files.
let canonSrc = ''
if (canonPath != null) {
  try {
    canonSrc = readFileSync(canonPath, 'utf-8')
  } catch {
    canonSrc = ''
  }
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

// Retired tombstones (status: 'retired') are kept in the catalog only for
// ID-stability (#1244) — they enforce nothing and must not appear as live rows
// in AGENTS.md (#1570). Drop them from the forward requirement (don't demand a
// row) and exempt them from the reverse orphan check (don't flag a leftover row).
// Each catalog entry is an object literal starting with `id: 'INV-NN'`; we scan
// from each id to the next to find its `status: 'retired'` marker.
const retiredIds = new Set()
{
  const idRe = /id:\s*'(INV-\d+)'/g
  const marks = []
  let mm
  while ((mm = idRe.exec(catalogSrc)) !== null) marks.push({ id: mm[1], at: mm.index })
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : catalogSrc.length
    if (/status:\s*'retired'/.test(catalogSrc.slice(marks[i].at, end))) retiredIds.add(marks[i].id)
  }
}
for (const id of retiredIds) catalogEntries.delete(id)

// Extract {id, title} pairs from AGENTS.md: format is **INV-NN:** title
const agentsInvEntries = new Map()
for (const m of agentsSrc.matchAll(/\*\*(INV-\d+):\*\*\s*(.+)/g)) {
  agentsInvEntries.set(m[1], m[2].trim())
}

// Extract {id, title} from AGENTS.md: format is **CANON-NN:** title (#1158).
const agentsCanonEntries = new Map()
for (const m of agentsSrc.matchAll(/\*\*(CANON-\d+):\*\*\s*(.+)/g)) {
  agentsCanonEntries.set(m[1], m[2].trim())
}
const agentsCanonIds = agentsCanonEntries

// Extract {id, title} from CANON.md headings: `## CANON-NN — title` (#1158).
const canonEntries = new Map()
for (const m of canonSrc.matchAll(/^##\s+(CANON-\d+)\b\s*[—-]+\s*(.+)/gm)) {
  canonEntries.set(m[1], m[2].trim())
}
const canonIds = canonEntries

let violations = 0

// Forward: every catalog INV must be in AGENTS.md with matching title.
for (const [id, catalogTitle] of catalogEntries) {
  const agentsTitle = agentsInvEntries.get(id)
  if (!agentsTitle) {
    process.stdout.write(`  MISSING from AGENTS.md: ${id}
`)
    violations++
    continue
  }
  if (agentsTitle !== catalogTitle) {
    process.stdout.write(`  TITLE MISMATCH: ${id}
`)
    process.stdout.write(`    catalog: ${catalogTitle}
`)
    process.stdout.write(`    agents:  ${agentsTitle}
`)
    violations++
  }
}

// Reverse (#485): every **INV-NN:** in AGENTS.md must have a catalog entry.
// A leftover row for a retired tombstone is exempt (#1570) — it has a real
// catalog entry, just one we deliberately dropped from the live set above.
for (const id of agentsInvEntries.keys()) {
  if (!catalogEntries.has(id) && !retiredIds.has(id)) {
    process.stdout.write(`  ORPHAN in AGENTS.md: ${id} (no entry in catalog)
`)
    violations++
  }
}

// Reverse (#485): every **CANON-NN:** in AGENTS.md must have a `## CANON-NN`
// heading in CANON.md. If CANON.md is missing entirely the check is skipped
// (canonSrc is the empty string, so we only flag when canonSrc was loaded).
if (canonSrc) {
  for (const id of agentsCanonIds.keys()) {
    if (!canonIds.has(id)) {
      process.stdout.write(`  ORPHAN in AGENTS.md: ${id} (no heading in CANON.md)
`)
      violations++
    }
  }
}

// Forward (#1148): every `## CANON-NN` heading in CANON.md must have a
// `**CANON-NN:**` row in AGENTS.md. The previous reverse loop only caught
// phantom refs — this closes the gap where all Canon rules could be absent.
if (canonSrc) {
  for (const id of canonIds.keys()) {
    if (!agentsCanonIds.has(id)) {
      process.stdout.write(`  MISSING from AGENTS.md: ${id}\n`)
      violations++
    }
  }
}

// Title parity (#1158): for every CANON-NN present in both, the AGENTS.md row
// title must match the CANON.md heading title — keeps the summary in sync with
// canon, mirroring the INV-NN title-parity check above.
if (canonSrc) {
  for (const [id, canonTitle] of canonEntries) {
    const agentsTitle = agentsCanonEntries.get(id)
    if (agentsTitle !== undefined && agentsTitle !== canonTitle) {
      process.stdout.write(`  CANON TITLE MISMATCH: ${id}\n`)
      process.stdout.write(`    canon:  ${canonTitle}\n`)
      process.stdout.write(`    agents: ${agentsTitle}\n`)
      violations++
    }
  }
}

// E5 (#1947): agent-write-classes.json ↔ .claude/agents/*.md parity — every
// classified agent name must have a real agent file (no phantom entry feeding
// pre-spawn-worktree-guard.mjs a stale classification). Real-repo-files mode only.
if (catalogArg == null && agentsArg == null) {
  const writeClassesPath = resolve(root, '.claude/agents/agent-write-classes.json')
  try {
    const classes = JSON.parse(readFileSync(writeClassesPath, 'utf-8')).classes ?? {}
    for (const name of Object.keys(classes)) {
      if (!existsSync(resolve(root, `.claude/agents/${name}.md`))) {
        process.stdout.write(
          `  ORPHAN in agent-write-classes.json: ${name} (no .claude/agents/${name}.md)\n`,
        )
        violations++
      }
    }
  } catch {
    // agent-write-classes.json is optional (E5 implement-but-not-activated) — absence is not a violation.
  }
}

if (violations > 0) {
  process.stdout.write(
    `[check-catalog-agents-parity] FAIL: ${violations} parity violation(s) between catalog/CANON.md and AGENTS.md\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `[check-catalog-agents-parity] OK — ${catalogEntries.size} catalog IDs and ${canonIds.size} CANON refs verified (bidirectional)\n`,
)
