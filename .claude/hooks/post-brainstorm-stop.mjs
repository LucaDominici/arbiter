#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// UserPromptSubmit: block /task commands while brainstorm-active marker exists.
// Purpose: enforce terminal-state of brainstorming skill (#699) — user must
//          explicitly clear the marker before implementation can begin.
// Marker: .arbiter/brainstorm-active (auto-expires after 24h via mtime).
// Never blocks non-/task prompts. Always exits 0 on read errors.
import { readFileSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

let prompt = ''
try {
  const raw = readFileSync(0, 'utf-8')
  prompt = JSON.parse(raw)?.prompt ?? ''
} catch {
  process.exit(0)
}

// Only gate /task commands
if (!prompt.trimStart().startsWith('/task')) process.exit(0)

const markerPath = join(process.cwd(), '.arbiter', 'brainstorm-active')
if (!existsSync(markerPath)) process.exit(0)

// Auto-expire after 24h (clock-skew tolerant: use absolute diff)
try {
  const mtime = statSync(markerPath).mtime.getTime()
  if (Math.abs(Date.now() - mtime) > TWENTY_FOUR_HOURS_MS) {
    unlinkSync(markerPath)
    process.exit(0)
  }
} catch (e) {
  if (e.code === 'ENOENT') process.exit(0) // Marker vanished between check and stat — allow
  process.stderr.write(
    `[brainstorm-gate] ERROR: could not stat marker (${e.code ?? e.message}) — blocking\n`,
  )
  process.exit(2)
}

process.stderr.write(
  `[brainstorm-gate] BLOCKED: brainstorm session still active.\n` +
    `  Marker: ${markerPath}\n` +
    `  Clear it first:  rm "${markerPath}"\n` +
    `  Then retry your /task command.\n`,
)
process.exit(2)
