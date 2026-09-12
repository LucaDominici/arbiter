#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/regen.mjs — `npm run regen`: the fixer IS the checker in write mode.
//
// Root cause (gate-throughput audit, 2026-07-23): check-all.mjs validates
// several DERIVED/GENERATED artifacts by running their generator in
// --check/read-only mode, but nobody re-runs the SAME generator in write mode
// first — so the gate fails on stale derived state unrelated to the feature
// actually being worked on. This is that missing step: build once (also
// closes the dist-staleness class, #2089), then run every generator's write
// command from scripts/lib/derived-artifacts.mjs.
//
// Usage: npm run regen
import { execFileSync } from 'node:child_process'
import { DERIVED_ARTIFACTS, REGEN_PHASES } from './lib/derived-artifacts.mjs'
import { isMainModule } from './lib/run-helpers.mjs'

/**
 * Ordered plan: `npm run build` first, then every artifact's writeCmd grouped by REGEN_PHASES
 * (source → produce → index → consume, #2568) so doc consumers see the docs this same run produced.
 * Registry order is preserved inside a phase; a missing or unknown phase is refused.
 */
export function buildPlan(artifacts = DERIVED_ARTIFACTS) {
  for (const a of artifacts) {
    if (!REGEN_PHASES.includes(a.phase)) {
      throw new Error(`derived artifact "${a.name}" has no valid phase (${REGEN_PHASES.join('|')})`)
    }
  }
  const ordered = REGEN_PHASES.flatMap((phase) => artifacts.filter((a) => a.phase === phase))
  return [
    { name: 'build', cmd: 'npm', args: ['run', 'build'] },
    ...ordered.map((a) => ({ name: a.name, cmd: a.writeCmd[0], args: a.writeCmd.slice(1) })),
  ]
}

const isMain = isMainModule(import.meta.url)
if (isMain) {
  try {
    for (const { name, cmd, args } of buildPlan()) {
      process.stdout.write(`\n> regen: ${name}\n`)
      execFileSync(cmd, args, { stdio: 'inherit' })
    }
    process.stdout.write(`\nregen: ${DERIVED_ARTIFACTS.length} derived artifact(s) refreshed.\n`)
  } catch (err) {
    process.stderr.write(`regen: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}
