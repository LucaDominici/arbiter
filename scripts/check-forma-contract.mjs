#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: enforces the shared schema contract with the forma repository (schemas/CONTRACT.json):
// CATALOG: every arbiter-owned schema hashes to its pinned sha256, and every schema arbiter vendors
// CATALOG: from forma (schemas/vendor/) matches the pin too — so a shared shape cannot be changed
// CATALOG: on one side and stay green. When a sibling forma checkout is present it additionally
// CATALOG: proves the two copies of the manifest are byte-identical and that forma's real files
// CATALOG: still hash to the pin; when it is absent that half SKIPS loudly rather than silently.
// CATALOG: rejected fold-in into check-id-registry.mjs because that gate governs arbiter's internal
// CATALOG: identifier ontology; this one governs a cross-repository boundary with a different owner,
// CATALOG: a different failure mode (drift between two checkouts) and a different remedy (re-pin).
// CATALOG: rejected fold-in into check-drift.mjs because that gate compares generated output against
// CATALOG: its templates inside this repo; nothing there models a schema owned by another project.
//
// scripts/check-forma-contract.mjs
// L1 gate (INV-143): the arbiter <-> forma schema contract holds.
//
// Usage: node scripts/check-forma-contract.mjs [--dir <repo>] [--sibling <path-to-forma>]
// Exit: 0 pass, 1 violation, 2 error (INV-53).
//
// Exports for unit tests: sha256Of, checkContract

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const CONTRACT_REL = join('schemas', 'CONTRACT.json')
const VENDOR_DIR = join('schemas', 'vendor')
const THIS_REPO = 'arbiter'
const SIBLING_REPO = 'forma'

export function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * @returns {{ violations: string[], notes: string[] }}
 */
/** What this repo OWNS must still hash to its pin. */
function ownedViolations(entry, root) {
  if (entry.owner !== THIS_REPO) return []
  const owned = join(root, entry.ownerPath)
  if (!existsSync(owned)) return [`${entry.id}: owned schema ${entry.ownerPath} is missing`]
  const actual = sha256Of(owned)
  if (actual === entry.sha256) return []
  return [
    `${entry.id}: ${entry.ownerPath} hashes ${actual.slice(0, 12)}… but the contract pins ` +
      `${entry.sha256.slice(0, 12)}… — re-pin in BOTH repos' CONTRACT.json, or revert the edit`,
  ]
}

/** What this repo VENDORS must still match the shape its owner defines. */
function vendoredViolations(entry, root) {
  if (!(entry.consumers || []).includes(THIS_REPO)) return []
  const vendored = join(root, VENDOR_DIR, `${entry.id}.schema.json`)
  if (!existsSync(vendored)) {
    return [
      `${entry.id}: declared vendored by ${THIS_REPO} but ${VENDOR_DIR}/${entry.id}.schema.json is absent`,
    ]
  }
  const actual = sha256Of(vendored)
  if (actual === entry.sha256) return []
  return [
    `${entry.id}: vendored copy hashes ${actual.slice(0, 12)}… but the contract pins ` +
      `${entry.sha256.slice(0, 12)}… — the copy drifted from the shape ${entry.owner} owns`,
  ]
}

/** With both checkouts on disk: the manifests must be identical and the sibling's files unmoved. */
function siblingViolations(contract, contractPath, siblingRoot) {
  const out = []
  const siblingContract = join(siblingRoot, 'lib', 'schema', 'CONTRACT.json')
  if (readFileSync(siblingContract, 'utf-8') !== readFileSync(contractPath, 'utf-8')) {
    out.push(
      `the two copies of CONTRACT.json differ (${CONTRACT_REL} vs ${SIBLING_REPO}/lib/schema/CONTRACT.json) — ` +
        `the contract is only a contract while both sides hold the same text`,
    )
  }
  for (const entry of contract.schemas) {
    if (entry.owner !== SIBLING_REPO) continue
    const real = join(siblingRoot, entry.ownerPath)
    if (!existsSync(real)) {
      out.push(`${entry.id}: ${SIBLING_REPO}/${entry.ownerPath} is missing`)
      continue
    }
    const actual = sha256Of(real)
    if (actual === entry.sha256) continue
    out.push(
      `${entry.id}: ${SIBLING_REPO}'s live ${entry.ownerPath} hashes ${actual.slice(0, 12)}… but the ` +
        `contract pins ${entry.sha256.slice(0, 12)}… — ${SIBLING_REPO} changed a shared shape without re-pinning`,
    )
  }
  return out
}

/**
 * @returns {{ violations: string[], notes: string[] }}
 */
export function checkContract(root, siblingRoot) {
  const violations = []
  const notes = []
  const contractPath = join(root, CONTRACT_REL)
  const contract = JSON.parse(readFileSync(contractPath, 'utf-8'))

  for (const entry of contract.schemas) {
    violations.push(...ownedViolations(entry, root), ...vendoredViolations(entry, root))
  }

  // The cross-checkout half needs both repos on disk. Absent, it SKIPS OUT LOUD: a check that
  // quietly does nothing is the failure this whole contract exists to prevent.
  if (!siblingRoot || !existsSync(join(siblingRoot, 'lib', 'schema', 'CONTRACT.json'))) {
    notes.push(
      `SKIP cross-checkout half: no ${SIBLING_REPO} checkout beside this one. Owner-side pins were ` +
        `still verified; ${SIBLING_REPO}'s own gate verifies its half.`,
    )
    return { violations, notes }
  }
  violations.push(...siblingViolations(contract, contractPath, siblingRoot))
  notes.push(`cross-checkout half ran against ${siblingRoot}`)
  return { violations, notes }
}

function main() {
  const argv = process.argv.slice(2)
  const dirIdx = argv.indexOf('--dir')
  const root = dirIdx === -1 ? resolve(scriptDir, '..') : resolve(argv[dirIdx + 1])
  const sibIdx = argv.indexOf('--sibling')
  const sibling = sibIdx === -1 ? resolve(root, '..', SIBLING_REPO) : resolve(argv[sibIdx + 1])

  if (!existsSync(join(root, CONTRACT_REL))) {
    process.stderr.write(`check-forma-contract: ERROR — ${CONTRACT_REL} not found under ${root}\n`)
    return 2
  }
  let result
  try {
    result = checkContract(root, sibling)
  } catch (err) {
    process.stderr.write(`check-forma-contract: ERROR — ${err.message}\n`)
    return 2
  }
  for (const n of result.notes) process.stdout.write(`  check-forma-contract: ${n}\n`)
  if (result.violations.length > 0) {
    process.stderr.write(`check-forma-contract: FAIL — ${result.violations.length} violation(s)\n`)
    for (const v of result.violations) process.stderr.write(`  - ${v}\n`)
    return 1
  }
  process.stdout.write(`check-forma-contract: PASS — schema contract holds with ${SIBLING_REPO}\n`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main())
  } catch (err) {
    process.stderr.write(`check-forma-contract: ERROR — unexpected: ${err.message}\n`)
    process.exit(1)
  }
}
