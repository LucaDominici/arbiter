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
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveGatesForFiles, parsePlanFilesManifest } from './lib/gate-derivation.mjs'
import { inspectGateContract } from './lib/gate-contract.mjs'
import { isMainModule, readRegularFileSync } from './lib/run-helpers.mjs'

/** Pure: plan file contents -> derived gates, or null if not anchorable yet. */
export function derivePlanGates(planBody, contract = undefined) {
  const files = parsePlanFilesManifest(planBody)
  if (files === null || files.length === 0) return null
  return deriveGatesForFiles(files, undefined, contract)
}

function main() {
  const [, , root, planPath] = process.argv
  if (!root || !planPath) {
    console.error('usage: derive-plan-gates.mjs <root> <planPath>')
    process.exit(2)
  }
  // Strip a `plan.md#acceptance`-style fragment the same way check-acceptance.mjs's readPlan()
  // and task.ts's checkAcceptancePlanGate call site do, so a fragment-qualified reference resolves
  // to the real file instead of silently SKIPping (which would then block plan->red, the opposite
  // of advisory, once checkPlanDerivedGates starts requiring a fresh derivedGates).
  const withoutFragment = planPath.split('#')[0]
  const abs = withoutFragment.startsWith('/') ? withoutFragment : join(root, withoutFragment)
  if (!existsSync(abs)) {
    console.log('SKIP derive-plan-gates: plan file not written yet')
    return
  }
  const gates = derivePlanGates(readRegularFileSync(abs, 'utf-8'), inspectGateContract(root))
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
  // Atomic write (temp file + rename), same pattern as record-journey-evidence.mjs / done-evidence.mjs —
  // a crash mid-write must not leave status.json truncated, matching task-state.ts's atomicWrite for
  // the same file.
  const tmpPath = `${statusPath}.${process.pid}.tmp`
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmpPath, statusPath)
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
