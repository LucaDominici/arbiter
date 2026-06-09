#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CATALOG: Permission-test root-guard gate. Aggregates the policy that any test
// CATALOG: which makes a path unreadable (chmod 0o000) and asserts the resulting
// CATALOG: read FAILS must guard on `process.getuid?.() === 0` — because CI
// CATALOG: runners may execute as root, which ignores permission bits, so the
// CATALOG: read succeeds and the test fails ONLY in CI (a local<->CI divergence).
// CATALOG: No sibling check-* script inspects test bodies for this hazard
// CATALOG: (check-no-skipped-tests guards .skip; check-fail-closed-audit guards
// CATALOG: gate scripts, not tests), so this cannot fold into an existing gate.
//
// Exits 0: every chmod-to-unreadable test site has a root guard within range.
// Exits 1: an unguarded site exists (would pass locally, fail as root in CI).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TESTS_DIR = join(REPO_ROOT, '__tests__')
const GUARD_WINDOW = 6 // lines above the chmod within which the root guard must appear
const GUARD_RE = /process\.getuid\?\.\(\)\s*===\s*0/
// chmod to an unreadable mode: 0o000, octal/decimal 0, or the string '0o000'.
const UNREADABLE_CHMOD_RE = /chmod(?:Sync)?\([^,]+,\s*(0o0+|0|'0o000')\s*\)/

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry)) out.push(full)
  }
  return out
}

function main() {
  const violations = []
  for (const file of walk(TESTS_DIR, [])) {
    const lines = readFileSync(file, 'utf-8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!UNREADABLE_CHMOD_RE.test(lines[i])) continue
      const from = Math.max(0, i - GUARD_WINDOW)
      const guarded = lines.slice(from, i + 1).some((l) => GUARD_RE.test(l))
      if (!guarded) {
        violations.push(
          `${file.replace(REPO_ROOT + '/', '')}:${i + 1}: chmod-to-unreadable without a 'process.getuid?.() === 0' guard within ${GUARD_WINDOW} lines above`,
        )
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      'check-perm-test-guards: FAIL — permission tests that pass locally but fail as root in CI:\n',
    )
    for (const v of violations) process.stderr.write(`  - ${v}\n`)
    process.stderr.write(
      '  Fix: add `if (process.getuid?.() === 0) return` before the chmod (see __tests__/utils/safe-read.test.ts).\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    'check-perm-test-guards: OK (all chmod-to-unreadable tests are root-guarded)\n',
  )
  process.exit(0)
}

try {
  main()
} catch (err) {
  // Fail closed: an unexpected scan error must block the gate, never silently pass.
  process.stderr.write(`check-perm-test-guards: unexpected error: ${err?.stack ?? err}\n`)
  process.exit(1)
}
