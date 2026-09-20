#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// derive-plan-gates.mjs — computes and persists plan-time derived gates (#2773) at anchor time.
//
// Invoked as a subprocess from runTaskInit (arbiter lifecycle start --plan <path>), mirroring
// the checkAcceptancePlanGate subprocess pattern in task.ts: a Node ESM dynamic import cannot
// run synchronously from that call site, so the pure derivation in scripts/lib/gate-derivation.mjs
// stays on the .mjs side end to end. checkPlanDerivedGates (check-acceptance.mjs) recomputes from
// the same manifest at plan->red and refuses the transition if this drifted from a re-anchor
// (e.g. the plan's files: list was edited without re-running lifecycle start).
//
// Advisory at anchor time: a plan not yet written, or without a files: manifest, is a SKIP here
// (exit 0) — the red-phase gate is the actual enforcement point and fails closed if derivedGates
// is still missing when the task tries to enter red.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveGatesForFiles, parsePlanFilesManifest } from './lib/gate-derivation.mjs'
import { isMainModule, readRegularFileSync } from './lib/run-helpers.mjs'

/** Pure: plan file contents -> derived gates, or null if not anchorable yet. */
export function derivePlanGates(planBody) {
  const files = parsePlanFilesManifest(planBody)
  if (files === null || files.length === 0) return null
  return deriveGatesForFiles(files)
}

function main() {
  const [, , root, planPath] = process.argv
  if (!root || !planPath) {
    console.error('usage: derive-plan-gates.mjs <root> <planPath>')
    process.exit(2)
  }
  const abs = planPath.startsWith('/') ? planPath : join(root, planPath)
  if (!existsSync(abs)) {
    console.log('SKIP derive-plan-gates: plan file not written yet')
    return
  }
  const gates = derivePlanGates(readRegularFileSync(abs, 'utf-8'))
  if (gates === null) {
    console.log('SKIP derive-plan-gates: no `files:` manifest in plan frontmatter yet')
    return
  }
  const statusPath = join(root, '.claude', '.task', 'status.json')
  if (!existsSync(statusPath)) {
    console.log('SKIP derive-plan-gates: no active task state')
    return
  }
  const state = JSON.parse(readRegularFileSync(statusPath, 'utf-8'))
  state.derivedGates = gates
  // Match writeUnifiedState's serialization (task-state.ts) so a later TS read/write is a no-op diff.
  writeFileSync(statusPath, JSON.stringify(state, null, 2) + '\n')
  console.log(`derive-plan-gates: wrote ${gates.length} derived gate(s)`)
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(`derive-plan-gates: ${err?.message ?? err}`)
    process.exit(1)
  }
}
