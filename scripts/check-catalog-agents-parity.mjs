#!/usr/bin/env node
// INV-51: Every catalog INV-NN must appear in AGENTS.md (CANON-08) with matching title.
// Usage: node scripts/check-catalog-agents-parity.mjs [--catalog=path] [--agents=path]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const agentsArg = args.find((a) => a.startsWith('--agents='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const agentsPath = agentsArg ? resolve(agentsArg.split('=')[1]) : resolve(root, 'AGENTS.md')

const catalogSrc = readFileSync(catalogPath, 'utf-8')
const agentsSrc = readFileSync(agentsPath, 'utf-8')

// Extract {id, title} pairs from catalog.ts
// IDs are always single-quoted; titles may use single or double quotes, and may span two lines
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
      const t = line.match(/['"]([^'"]+)['"]/)
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

// Extract {id, title} pairs from AGENTS.md: format is **INV-NN:** title
const agentsEntries = new Map()
for (const m of agentsSrc.matchAll(/\*\*(INV-\d+):\*\*\s*(.+)/g)) {
  agentsEntries.set(m[1], m[2].trim())
}

let violations = 0

for (const [id, catalogTitle] of catalogEntries) {
  const agentsTitle = agentsEntries.get(id)
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

if (violations > 0) {
  console.log(
    `[check-catalog-agents-parity] FAIL: ${violations} catalog invariant(s) absent or mismatched in AGENTS.md`,
  )
  process.exit(1)
}
console.log(
  `[check-catalog-agents-parity] OK — all ${catalogEntries.size} catalog IDs present with matching titles in AGENTS.md`,
)
