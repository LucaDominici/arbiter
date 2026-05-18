#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// L1 gate (INV-85): scan kit-authored committed files for forbidden tokens.
// Scoped to src/kit/ and .github/ISSUE_TEMPLATE/ — pre-existing files excluded.
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const LEXICON_PATH = join(ROOT, 'scripts/data/redaction-lexicon.json')
let lexicon
try {
  lexicon = JSON.parse(readFileSync(LEXICON_PATH, 'utf-8'))
} catch (err) {
  process.stderr.write(
    `check-no-redacted-tokens: cannot load lexicon at ${LEXICON_PATH}: ${err.message}\n`,
  )
  process.exit(1)
}

// Scoped to kit-authored files only. src/invariants/ is excluded because the reservation
// comment references token names by design (the comment IS the guard, not a leak).
const SCAN_PREFIXES = ['src/kit/', '.github/ISSUE_TEMPLATE/']

function scanForRedactedTokens(text, lexiconEntries) {
  const matches = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i]
    for (const entry of lexiconEntries) {
      if (!lineContent.includes(entry.token)) continue
      if (entry.allowContext !== undefined && lineContent.includes(entry.allowContext)) continue
      matches.push({ token: entry.token, line: i + 1, lineContent })
    }
  }
  return matches
}

// Use git ls-files so we only scan committed files (excludes gitignored derived.json etc.)
// ARBITER_HOOK_GIT_CWD is set by the pre-commit hook when running from a '#'-free temp dir.
const GIT_CWD = process.env['ARBITER_HOOK_GIT_CWD'] ?? ROOT
const allFiles = execFileSync('git', ['ls-files'], { encoding: 'utf-8', cwd: GIT_CWD })
  .split('\n')
  .filter(Boolean)
  .filter((f) => SCAN_PREFIXES.some((p) => f.startsWith(p)))

let violations = 0

for (const rel of allFiles) {
  const abs = join(ROOT, rel)
  let text
  try {
    text = readFileSync(abs, 'utf-8')
  } catch (err) {
    process.stderr.write(
      `check-no-redacted-tokens: WARN — could not read "${rel}": ${err.message}\n`,
    )
    violations++
    continue
  }
  const matches = scanForRedactedTokens(text, lexicon)
  if (matches.length > 0) {
    for (const m of matches) {
      process.stderr.write(
        `check-no-redacted-tokens: [${rel}:${m.line}] forbidden token "${m.token}": ${m.lineContent.trim()}\n`,
      )
    }
    violations++
  }
}

if (violations > 0) {
  process.stderr.write(
    `\ncheck-no-redacted-tokens: ${violations} file(s) contain forbidden tokens (INV-85).\n`,
  )
  process.exit(1)
} else {
  process.stdout.write('check-no-redacted-tokens: OK\n')
}
