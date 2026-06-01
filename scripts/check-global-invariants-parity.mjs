#!/usr/bin/env node
// CATALOG: GLOBAL_INVARIANTS.md <-> catalog.ts coverage parity (INV-110 / CANON-08).
// CATALOG: considered folding into check-catalog-agents-parity.mjs (the AGENTS.md
// CATALOG: parity gate) but rejected — that gate asserts AGENTS.md row presence +
// CATALOG: title match, whereas this asserts the deep-reference companion
// CATALOG: (GLOBAL_INVARIANTS.md) documents every always-active invariant. Different
// CATALOG: target file, different failure mode, so a sibling gate is clearer.
//
// Mirrors the AGENTS.md<->catalog parity gate (CANON-08) for the deep-reference
// companion doc. Two directions:
//   forward — every `alwaysActive: true` invariant in src/invariants/catalog.ts
//             MUST have a `### INV-NN:` section in GLOBAL_INVARIANTS.md (no silent
//             coverage gap, the drift this gate exists to prevent).
//   reverse — every `### INV-NN:` section in GLOBAL_INVARIANTS.md MUST point at an
//             existing catalog entry (no phantom invariants).
//
// GLOBAL_INVARIANTS.md MAY document non-active invariants too (it is a superset of
// the always-active set, bounded above by the catalog) — only missing-active and
// phantom rows fail.
//
// Usage: node scripts/check-global-invariants-parity.mjs [--catalog=path] [--doc=path]
// Exit: 0 in parity; 1 on divergence; 2 on invocation error.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const docArg = args.find((a) => a.startsWith('--doc='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const docPath = docArg ? resolve(docArg.split('=')[1]) : resolve(root, 'GLOBAL_INVARIANTS.md')

let catalogSrc
let docSrc
try {
  catalogSrc = readFileSync(catalogPath, 'utf-8')
  docSrc = readFileSync(docPath, 'utf-8')
} catch (err) {
  process.stderr.write(`check-global-invariants-parity: cannot read input — ${err.message}\n`)
  process.exit(2)
}

// ─── Catalog: collect all INV ids, and the always-active subset ──────────────
// Each catalog entry is an object literal starting with `id: 'INV-NN'`. We scan
// forward from each id to the next `id:`/closing and look for `alwaysActive: true`.
const catalogIds = new Set()
const alwaysActiveIds = new Set()
{
  const lines = catalogSrc.split('\n')
  let currentId = null
  for (const line of lines) {
    const idMatch = line.match(/id:\s*'(INV-\d+)'/)
    if (idMatch) {
      currentId = idMatch[1]
      catalogIds.add(currentId)
      continue
    }
    if (currentId && /alwaysActive:\s*true/.test(line)) {
      alwaysActiveIds.add(currentId)
    }
  }
}

// ─── Doc: collect documented INV ids from `### INV-NN:` headings ─────────────
const docIds = new Set()
for (const line of docSrc.split('\n')) {
  const m = line.match(/^###\s+(INV-\d+):/)
  if (m) docIds.add(m[1])
}

// ─── Forward: every always-active INV must be documented ─────────────────────
const missing = [...alwaysActiveIds].filter((id) => !docIds.has(id)).sort()
// ─── Reverse: every documented INV must exist in the catalog ─────────────────
const phantom = [...docIds].filter((id) => !catalogIds.has(id)).sort()

if (missing.length === 0 && phantom.length === 0) {
  process.stdout.write(
    `check-global-invariants-parity: in parity — ${alwaysActiveIds.size} always-active invariants documented, no phantom rows\n`,
  )
  process.exit(0)
}

if (missing.length > 0) {
  process.stderr.write(
    `check-global-invariants-parity: ${missing.length} always-active invariant(s) MISSING from GLOBAL_INVARIANTS.md:\n`,
  )
  for (const id of missing) process.stderr.write(`  - ${id}\n`)
}
if (phantom.length > 0) {
  process.stderr.write(
    `check-global-invariants-parity: ${phantom.length} phantom invariant(s) in GLOBAL_INVARIANTS.md (no catalog entry):\n`,
  )
  for (const id of phantom) process.stderr.write(`  - ${id}\n`)
}
process.exit(1)
