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
// ARBITER_HOOK_GIT_CWD is set by the pre-commit/pre-push hooks when running from a '#'-free
// temp dir (rsync'd there because a path containing '#' — e.g. a `task/#NNN-*` worktree —
// breaks vitest). Every file body MUST be resolved against this SAME root, never against ROOT
// (the script's own location) — ROOT
// stays reserved for the script's own on-disk assets (the lexicon above), which do not move
// with the tree under scan. Reading via ROOT here previously scanned the LISTED tree's file
// names against a DIFFERENT tree's content: silently wrong when both trees are copies of the
// same repo (the two file sets mostly coincide, so nearly every read used to succeed against
// the wrong version — a false pass with no warning, worse than the two-tree case throwing;
// see #2514).
const GIT_CWD = process.env['ARBITER_HOOK_GIT_CWD'] ?? ROOT
const allFiles = execFileSync('git', ['ls-files'], { encoding: 'utf-8', cwd: GIT_CWD })
  .split('\n')
  .filter(Boolean)
  .filter((f) => SCAN_PREFIXES.some((p) => f.startsWith(p)))

let violations = 0

for (const rel of allFiles) {
  const abs = join(GIT_CWD, rel)
  let text
  try {
    text = readFileSync(abs, 'utf-8')
  } catch (err) {
    // Fail-closed, not a silent skip: a git-tracked file this secret scanner cannot read is
    // treated as a violation, matching check-no-tracked-artifacts.mjs's stated policy for
    // this same GIT_CWD-vs-ROOT axis ("a non-git CWD is an ERROR, never a silent PASS —
    // NO-DATA≠PASS"). The prior "WARN" label was misleading: it already counted toward
    // `violations` below, so it was never actually a non-blocking warning.
    process.stderr.write(
      `check-no-redacted-tokens: FAIL — could not read "${rel}", treated as a violation (fail-closed): ${err.message}\n`,
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
