#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// L1 gate: assert that private paths are correctly gitignored.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

// Paths that MUST be gitignored (exit 0 from git check-ignore)
const MUST_IGNORE = [
  '.arbiter/private/work-kit-source/x.md',
  '.arbiter/private/REDACTION-LEXICON.md',
  'docs/internal/KIT-GOLD-STANDARD.md',
  'src/kit/derived.json',
]

// Paths that must NOT be gitignored (committed)
const MUST_NOT_IGNORE = ['scripts/data/redaction-lexicon.json', '.kit-removals.log']

let failures = 0

for (const p of MUST_IGNORE) {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT, stdio: 'pipe' })
  } catch {
    process.stderr.write(
      `check-private-paths-ignored: FAIL — "${p}" should be gitignored but is not\n`,
    )
    failures++
  }
}

for (const p of MUST_NOT_IGNORE) {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: ROOT, stdio: 'pipe' })
    process.stderr.write(
      `check-private-paths-ignored: FAIL — "${p}" is gitignored but must be committed\n`,
    )
    failures++
  } catch (err) {
    if (err.status === 1) {
      // Expected: not ignored — correct
    } else {
      process.stderr.write(
        `check-private-paths-ignored: FAIL — git check-ignore error for "${p}": ${err.message}\n`,
      )
      failures++
    }
  }
}

if (failures > 0) {
  process.stderr.write(`\ncheck-private-paths-ignored: ${failures} violation(s)\n`)
  process.exit(1)
} else {
  process.stdout.write('check-private-paths-ignored: OK\n')
}
