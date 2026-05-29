#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: gate-pass-log — append a signed entry to .arbiter/gate-pass.jsonl after a gate pass.
// Usage: node scripts/gate-pass-log.mjs [--sha <sha>] [--level <level>] [--signer <signer>]
// Supplemental provenance log only. Does NOT replace gate-pass.json. CI ignores this file
// for skip decisions — it exists solely for arbiter doctor / replay debugging / drift detection.
import { appendFileSync, mkdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'

function getSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function getSigner() {
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function parseArgs(argv) {
  const args = { sha: null, level: 'gate', signer: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sha' && argv[i + 1]) args.sha = argv[++i]
    else if (argv[i] === '--level' && argv[i + 1]) args.level = argv[++i]
    else if (argv[i] === '--signer' && argv[i + 1]) args.signer = argv[++i]
  }
  return args
}

function run() {
  // Error boundary 1: build the entry
  let entry
  try {
    const opts = parseArgs(process.argv.slice(2))
    entry = {
      sha: opts.sha ?? getSha(),
      level: opts.level,
      checks: [],
      signedAt: new Date().toISOString(),
      signer: opts.signer ?? getSigner(),
    }
  } catch (err) {
    // FAIL-OPEN-INTENT: entry construction failure is non-fatal — provenance log is supplemental
    process.stderr.write(`gate-pass-log: could not build entry: ${err.message}\n`)
    return
  }

  // Error boundary 2: append to JSONL
  try {
    const logPath = resolve(process.cwd(), '.arbiter/gate-pass.jsonl')
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, JSON.stringify(entry) + '\n')
  } catch (err) {
    // FAIL-OPEN-INTENT: write failure is non-fatal — provenance log is supplemental
    process.stderr.write(`gate-pass-log: could not write log: ${err.message}\n`)
    return
  }

  // Soft cosign sign-blob (best-effort, never blocks gate)
  try {
    const result = spawnSync('cosign', ['sign-blob', '--yes', '.arbiter/gate-pass.jsonl'], {
      encoding: 'utf-8',
      timeout: 30_000,
    })
    if (result.status !== 0) {
      process.stderr.write(
        // FAIL-OPEN-INTENT: cosign unavailable or failed — provenance log signing is supplemental
        `gate-pass-log: cosign sign-blob failed (non-blocking): ${result.stderr ?? ''}\n`,
      )
    }
  } catch {
    // FAIL-OPEN-INTENT: cosign not installed — non-fatal
  }
}

try {
  run()
} catch (err) {
  process.stderr.write(
    `gate-pass-log: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
