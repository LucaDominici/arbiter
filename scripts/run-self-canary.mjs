#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Self-canary: runs arbiter against its own repo in dry-run mode and checks for drift.
// Usage: node scripts/run-self-canary.mjs --dry-run [--arbiter-bin <path>]
//
// --dry-run           Required. Prevents any real file writes.
// --arbiter-bin <p>   Override the arbiter binary path (for testing).
//
// Exit codes:
//   0 — no drift detected
//   1 — drift detected or error
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const hasDryRun = args.includes('--dry-run')
let arbiterBin = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--arbiter-bin' && i + 1 < args.length) {
    arbiterBin = args[++i]
  }
}

if (!hasDryRun) {
  process.stderr.write(
    'run-self-canary: --dry-run is required. This script must never modify the target repo.\n',
  )
  process.exit(1)
}

// Resolve arbiter binary: prefer explicit override, then dist/cli.js, then npx arbiter
const bin = arbiterBin ?? resolve('dist/cli.js')

// Run arbiter init in dry-run mode
const result = spawnSync('node', [bin, 'init', '--yes', '--brownfield', '--dry-run'], {
  encoding: 'utf-8',
  cwd: resolve('.'),
  timeout: 60000,
})

const combined = (result.stdout ?? '') + (result.stderr ?? '')

if (result.error) {
  process.stderr.write(`run-self-canary: failed to spawn arbiter: ${result.error.message}\n`)
  process.exit(1)
}

if (result.status !== 0) {
  process.stderr.write(
    `run-self-canary: arbiter exited with status ${result.status ?? '(null)'}.\n${combined}`,
  )
  process.exit(1)
}

// Detect drift: [create] and [modify] headers appear only when files would change
const driftLines = combined
  .split('\n')
  .filter((l) => l.includes('[create]') || l.includes('[modify]'))

if (driftLines.length > 0) {
  process.stderr.write(
    `run-self-canary: drift detected — ${driftLines.length} file(s) would change\n`,
  )
  for (const line of driftLines) {
    process.stderr.write(`  ${line}\n`)
  }
  process.exit(1)
}

process.stdout.write('run-self-canary: ok — no drift detected\n')
process.exit(0)
