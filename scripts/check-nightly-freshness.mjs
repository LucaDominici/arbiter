#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-nightly-freshness.mjs
// INV-93 gate: verify that the nightly CI stamp artifact is within the freshness window.
//
// Usage: node scripts/check-nightly-freshness.mjs [--artifact=<path>] [--max-age-hours=<n>]
//
// Exit codes:
//   0 — artifact absent (vacuous pass) OR artifact timestamp within max-age-hours
//   1 — artifact present but timestamp older than max-age-hours, OR invalid artifact
//
// Arguments:
//   --artifact=<path>       Path to the nightly stamp JSON file
//                           (default: .arbiter/nightly/last-run.json)
//   --max-age-hours=<n>     Maximum allowed age in hours (default: 26)
//   --help                  Print usage and exit 0
//
// Stamp file format:
//   { "timestamp": "<ISO 8601 string>" }
//
// Produced by the 06-nightly.yml evidence-collect job (or manually for testing).

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
      'Usage: node scripts/check-nightly-freshness.mjs [options]',
      '',
      'Options:',
      '  --artifact=<path>      Path to nightly stamp JSON (default: .arbiter/nightly/last-run.json)',
      '  --max-age-hours=<n>    Maximum allowed age in hours (default: 26)',
      '  --help                 Print this help and exit 0',
      '',
      'Exit codes:',
      '  0  artifact absent (vacuous pass) or timestamp within max-age-hours',
      '  1  artifact present but stale, or invalid artifact format',
    ].join('\n') + '\n',
  )
  process.exit(0)
}

const artifactArg = args.find((a) => a.startsWith('--artifact='))
const maxAgeArg = args.find((a) => a.startsWith('--max-age-hours='))

const artifactPath = artifactArg
  ? resolve(artifactArg.split('=')[1])
  : resolve(repoRoot, '.arbiter', 'nightly', 'last-run.json')

const maxAgeHours = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : 26

// ─── Vacuous pass ─────────────────────────────────────────────────────────────

if (!existsSync(artifactPath)) {
  process.stdout.write(
    `[check-nightly-freshness] OK — no artifact found at ${artifactPath} (vacuous pass — nightly not yet configured)\n`,
  )
  process.exit(0)
}

// ─── Read and validate artifact ───────────────────────────────────────────────

let raw
try {
  raw = readFileSync(artifactPath, 'utf-8')
} catch (err) {
  process.stdout.write(`[check-nightly-freshness] FAIL — could not read artifact: ${err.message}\n`)
  process.exit(1)
}

let artifact
try {
  artifact = JSON.parse(raw)
} catch {
  process.stdout.write(
    `[check-nightly-freshness] FAIL — artifact is not valid JSON: ${artifactPath}\n`,
  )
  process.exit(1)
}

if (!artifact.timestamp || typeof artifact.timestamp !== 'string') {
  process.stdout.write(
    `[check-nightly-freshness] FAIL — artifact missing required "timestamp" field: ${artifactPath}\n`,
  )
  process.exit(1)
}

const ts = new Date(artifact.timestamp)
if (isNaN(ts.getTime())) {
  process.stdout.write(
    `[check-nightly-freshness] FAIL — artifact "timestamp" is not a valid ISO date: ${artifact.timestamp}\n`,
  )
  process.exit(1)
}

// ─── Freshness check ─────────────────────────────────────────────────────────

const ageMs = Date.now() - ts.getTime()
const ageHours = ageMs / (1000 * 60 * 60)

if (ageHours > maxAgeHours) {
  process.stdout.write(
    `[check-nightly-freshness] FAIL — nightly artifact is stale: ${ageHours.toFixed(1)}h old (max: ${maxAgeHours}h)\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `[check-nightly-freshness] OK — nightly artifact is fresh: ${ageHours.toFixed(1)}h old (max: ${maxAgeHours}h)\n`,
)
process.exit(0)
