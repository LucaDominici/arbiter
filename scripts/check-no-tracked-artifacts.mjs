#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Checks that no binary build artifacts (*.tgz, *.tar.gz) are tracked in git.
// CATALOG: Rejected fold-in into check-private-paths-ignored.mjs — that verifies gitignore rules
// CATALOG:   (git check-ignore), not tracked content (git ls-files) — different invariant and axis.
// CATALOG: Rejected fold-in into check-no-redacted-tokens.mjs — content scan, not artifact presence.
// INV-117 (selfOnly): arbiter self-repo must not track binary build artifacts.
// Exit codes per INV-53: 0=PASS, 1=FAIL, 2=ERROR
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const GIT_CWD = process.env['ARBITER_HOOK_GIT_CWD'] ?? ROOT
const BANNED_PATTERNS = ['*.tgz', '*.tar.gz']

let failures = 0
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: GIT_CWD, stdio: 'pipe' })
  for (const pattern of BANNED_PATTERNS) {
    const tracked = execFileSync('git', ['ls-files', pattern], {
      cwd: GIT_CWD,
      encoding: 'utf-8',
    }).trim()
    if (tracked) {
      for (const f of tracked.split('\n').filter(Boolean)) {
        process.stderr.write(`check-no-tracked-artifacts: FAIL — tracked artifact: ${f}\n`)
        failures++
      }
    }
  }
} catch (err) {
  process.stderr.write(
    `check-no-tracked-artifacts: ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}

if (failures > 0) {
  process.exit(1)
}
process.stdout.write('check-no-tracked-artifacts: OK\n')
process.exit(0)
