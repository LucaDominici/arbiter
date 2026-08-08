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
// #2035 (TC-4): project-declared invariants (PROJ-NN) join the parity contract
// when --config=arbiter.json is supplied: every always-active PROJ declared in
// governance.projectInvariants MUST be documented, and every PROJ section in
// the doc MUST be declared (no phantom project invariants). Without --config,
// PROJ sections in the doc are accepted (the doc is generated from the config,
// so presence-only toleration matches the arbiter-internal invocation).
//
// Usage: node scripts/check-global-invariants-parity.mjs [--catalog=path] [--doc=path] [--config=path]
// Exit: 0 in parity; 1 on divergence; 2 on invocation error.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const catalogArg = args.find((a) => a.startsWith('--catalog='))
const docArg = args.find((a) => a.startsWith('--doc='))
const configArg = args.find((a) => a.startsWith('--config='))

const root = process.cwd()
const catalogPath = catalogArg
  ? resolve(catalogArg.split('=')[1])
  : resolve(root, 'src/invariants/catalog.ts')
const docPath = docArg ? resolve(docArg.split('=')[1]) : resolve(root, 'GLOBAL_INVARIANTS.md')
const configPath = configArg ? resolve(configArg.split('=')[1]) : null

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

// ─── Doc: collect documented INV + PROJ ids from `### NN:` headings ─────────
const docIds = new Set()
const projDocIds = new Set()
for (const line of docSrc.split('\n')) {
  const invM = line.match(/^###\s+(INV-\d+):/)
  if (invM) docIds.add(invM[1])
  const projM = line.match(/^###\s+(PROJ-\d+):/)
  if (projM) projDocIds.add(projM[1])
}

// ─── #2035 (TC-4): config-declared project invariants (PROJ-NN) ─────────────
// Loaded from arbiter.json when --config is supplied; absent → tolerated.
const configProjectInvariants = []
if (configPath !== null) {
  if (!existsSync(configPath)) {
    process.stderr.write(
      `check-global-invariants-parity: --config=${configPath} does not exist\n`,
    )
    process.exit(2)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `check-global-invariants-parity: invalid JSON in ${configPath} — ${err.message}\n`,
    )
    process.exit(2)
  }
  const declared = parsed?.governance?.projectInvariants
  if (declared !== undefined && !Array.isArray(declared)) {
    process.stderr.write(
      `check-global-invariants-parity: governance.projectInvariants in ${configPath} must be an array\n`,
    )
    process.exit(2)
  }
  if (Array.isArray(declared)) configProjectInvariants.push(...declared)
}

// ─── Forward: every always-active INV must be documented ─────────────────────
const missing = [...alwaysActiveIds].filter((id) => !docIds.has(id)).sort()
// ─── Reverse: every documented INV must exist in the catalog ─────────────────
const phantom = [...docIds].filter((id) => !catalogIds.has(id)).sort()
// ─── #2035 (TC-4): PROJ forward/reverse vs the declared config set ───────────
const declaredAlwaysActiveProj = configProjectInvariants
  .filter((i) => i?.alwaysActive === true)
  .map((i) => i.id)
  .sort()
const missingProj =
  configPath !== null ? declaredAlwaysActiveProj.filter((id) => !projDocIds.has(id)).sort() : []
const phantomProj =
  configPath !== null
    ? [...projDocIds].filter((id) => !configProjectInvariants.some((i) => i?.id === id)).sort()
    : []

if (missing.length === 0 && phantom.length === 0 && missingProj.length === 0 && phantomProj.length === 0) {
  process.stdout.write(
    `check-global-invariants-parity: in parity — ${alwaysActiveIds.size} always-active invariants documented, no phantom rows` +
      (configPath !== null
        ? `, ${declaredAlwaysActiveProj.length} project invariants documented, no phantom PROJ rows`
        : '') +
      '\n',
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
if (missingProj.length > 0) {
  process.stderr.write(
    `check-global-invariants-parity: ${missingProj.length} always-active project invariant(s) MISSING from GLOBAL_INVARIANTS.md (declared in governance.projectInvariants):\n`,
  )
  for (const id of missingProj) process.stderr.write(`  - ${id}\n`)
}
if (phantomProj.length > 0) {
  process.stderr.write(
    `check-global-invariants-parity: ${phantomProj.length} phantom project invariant(s) in GLOBAL_INVARIANTS.md (not declared in governance.projectInvariants):\n`,
  )
  for (const id of phantomProj) process.stderr.write(`  - ${id}\n`)
}
process.exit(1)
