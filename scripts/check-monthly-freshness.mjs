#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-monthly-freshness.mjs
// INV-82 gate: verify that the monthly CI stamp artifact is within the freshness window.
//
// Usage: node scripts/check-monthly-freshness.mjs [--artifact=<path>] [--max-age-days=<n>]
//
// Exit codes:
//   0 — artifact absent (vacuous pass) OR artifact timestamp within max-age-days
//   1 — artifact present but timestamp older than max-age-days, OR invalid artifact
//
// Arguments:
//   --artifact=<path>       Path to the monthly stamp JSON file
//                           (default: .arbiter/monthly/last-run.json)
//   --max-age-days=<n>      Maximum allowed age in days (default: 32)
//   --help                  Print usage and exit 0
//
// Stamp file format:
//   { "timestamp": "<ISO 8601 string>" }
//
// Produced by the 08-monthly.yml evidence-collect job (or manually for testing).

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--help')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-monthly-freshness.mjs [options]',
      '',
      'Options:',
      '  --artifact=<path>      Path to monthly stamp JSON (default: .arbiter/monthly/last-run.json)',
      '  --max-age-days=<n>     Maximum allowed age in days (default: 32)',
      '  --help                 Print this help and exit 0',
      '',
      'Exit codes:',
      '  0  artifact absent (vacuous pass) or timestamp within max-age-days',
      '  1  artifact present but stale, or invalid artifact format',
    ].join('\n') + '\n',
  )
  process.exit(0)
}

const artifactArg = args.find((a) => a.startsWith('--artifact='))
const maxAgeDaysArg = args.find((a) => a.startsWith('--max-age-days='))

const artifactPath = artifactArg
  ? resolve(artifactArg.split('=')[1])
  : resolve(repoRoot, '.arbiter', 'monthly', 'last-run.json')

const maxAgeDays = maxAgeDaysArg ? parseInt(maxAgeDaysArg.split('=')[1], 10) : 32

// ─── Vacuous pass ─────────────────────────────────────────────────────────────

if (!existsSync(artifactPath)) {
  process.stdout.write(
    `[check-monthly-freshness] OK — no artifact found at ${artifactPath} (vacuous pass — monthly not yet configured)\n`,
  )
  process.exit(0)
}

// ─── Read and validate artifact ───────────────────────────────────────────────

let raw
try {
  raw = readFileSync(artifactPath, 'utf-8')
} catch (err) {
  process.stdout.write(`[check-monthly-freshness] FAIL — could not read artifact: ${err.message}\n`)
  process.exit(1)
}

let artifact
try {
  artifact = JSON.parse(raw)
} catch {
  process.stdout.write(
    `[check-monthly-freshness] FAIL — artifact is not valid JSON: ${artifactPath}\n`,
  )
  process.exit(1)
}

if (!artifact.timestamp || typeof artifact.timestamp !== 'string') {
  process.stdout.write(
    `[check-monthly-freshness] FAIL — artifact missing required "timestamp" field: ${artifactPath}\n`,
  )
  process.exit(1)
}

const ts = new Date(artifact.timestamp)
if (isNaN(ts.getTime())) {
  process.stdout.write(
    `[check-monthly-freshness] FAIL — artifact "timestamp" is not a valid ISO date: ${artifact.timestamp}\n`,
  )
  process.exit(1)
}

// ─── Freshness check ─────────────────────────────────────────────────────────

const ageMs = Date.now() - ts.getTime()
const ageDays = ageMs / (1000 * 60 * 60 * 24)

if (ageDays > maxAgeDays) {
  process.stdout.write(
    `[check-monthly-freshness] FAIL — monthly artifact is stale: ${ageDays.toFixed(1)}d old (max: ${maxAgeDays}d)\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `[check-monthly-freshness] OK — monthly artifact is fresh: ${ageDays.toFixed(1)}d old (max: ${maxAgeDays}d)\n`,
)
process.exit(0)
