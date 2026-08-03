#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// L1 gate: assert that private paths are correctly gitignored.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
// ARBITER_HOOK_GIT_CWD is set by the pre-commit hook when running from a '#'-free temp dir.
const GIT_CWD = process.env['ARBITER_HOOK_GIT_CWD'] ?? ROOT

// Paths that MUST be gitignored (exit 0 from git check-ignore)
const MUST_IGNORE = [
  '.arbiter/private/work-kit-source/x.md',
  '.arbiter/private/REDACTION-LEXICON.md',
  'docs/internal/KIT-GOLD-STANDARD.md',
  // Self-declared maintainer-private ("not committed to the public repository") and
  // carries reporter-contact details. #2053: named explicitly so the blanket
  // docs/internal/ rule can be narrowed without un-privating this file.
  'docs/internal/coc-enforcement-runbook.md',
  'src/kit/derived.json',
]

// Paths that must NOT be gitignored (committed).
// #2053: docs/internal/ was blanket-ignored, so every NEW authored ADR/METHOD/SYSTEM doc
// silently never entered git history (a plain `git add -A` dropped it with no warning).
// The two probe paths below are deliberately NON-EXISTENT and UNTRACKED: `git check-ignore`
// reports a tracked file as not-ignored regardless of the rules, so only an untracked
// path actually exercises the ignore rule. They are the ratchet that keeps the rule
// narrowed to the genuinely-private files listed in MUST_IGNORE above.
const MUST_NOT_IGNORE = [
  'scripts/data/redaction-lexicon.json',
  '.kit-removals.log',
  'docs/internal/ADR/999-new-adr-probe.md',
  'docs/internal/METHOD/NEW_METHOD_DOC_PROBE.md',
]

let failures = 0

for (const p of MUST_IGNORE) {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: GIT_CWD, stdio: 'pipe' })
  } catch {
    process.stderr.write(
      `check-private-paths-ignored: FAIL — "${p}" should be gitignored but is not\n`,
    )
    failures++
  }
}

for (const p of MUST_NOT_IGNORE) {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: GIT_CWD, stdio: 'pipe' })
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
