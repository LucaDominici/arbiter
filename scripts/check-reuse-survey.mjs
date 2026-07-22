#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-70 enforcement (minimal, advisory). Scans a git range for commits that ADD a new
// CATALOG:   file under src/ or scripts/ and verifies the range documents the CANON-16
// CATALOG:   existing-code survey via the marker "Existing Code Survey:" (defined in
// CATALOG:   src/templates/root/docs/METHOD/REUSE_REGISTRY_SPEC.md). A marker grep, not a semantic
// CATALOG:   parser — the first mechanical proxy for INV-70, wired as runWarnCheck (advisory)
// CATALOG:   pending the start-warn→promote decision (#2044 item c). Skips (exit 0) when the range
// CATALOG:   is unresolvable (e.g. origin/main unavailable), same fail-open posture as
// CATALOG:   check-commit-footer-rationale.mjs's git-unavailable branch.
// Exit codes per INV-53: 0=PASS/skip, 1=survey marker missing (advisory when run via runWarnCheck).
// Usage: node scripts/check-reuse-survey.mjs [--range=<ref>] [--test-marker=<text>] [--help]
import { execFileSync } from 'node:child_process'

const SURVEY_MARKER = 'Existing Code Survey:'
const SOURCE_PREFIXES = ['src/', 'scripts/']

const HELP = `Usage: node scripts/check-reuse-survey.mjs [options]

Warns when a commit in the range adds a new file under src/ or scripts/ without documenting
the CANON-16 existing-code survey (INV-70). The survey is recorded with the marker
"${SURVEY_MARKER} ..." in a commit message or the PR body.

Options:
  --range=<ref>        Git range to scan (default: origin/main..HEAD)
  --test-marker=<text> Validate whether <text> carries the survey marker (for testing); exit 0/1
  --help, -h           Show this help and exit`

function parseArgs(argv) {
  const get = (name) => {
    const flag = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
    if (flag === undefined) return undefined
    const eq = flag.indexOf('=')
    return eq === -1 ? '' : flag.slice(eq + 1)
  }
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    range: get('range') || 'origin/main..HEAD',
    testMarker: get('test-marker'),
  }
}

function isNewSourceFile(path) {
  return SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

// Net-added files across the range. Returns null (loud skip) when the range cannot be resolved:
// an unresolvable range (origin/main unavailable, shallow clone) must skip this advisory INV-70
// proxy, never block — same posture as check-commit-footer-rationale's git-unavailable branch.
function addedFiles(range) {
  try {
    return execFileSync('git', ['diff', '--name-status', '--diff-filter=A', range], {
      encoding: 'utf-8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t').pop())
  } catch {
    process.stderr.write(
      `[reuse-survey] WARN: git diff failed for range '${range}' — origin/main may be unavailable. Skipping.\n`,
    )
    return null
  }
}

// Commit messages across the range; only ever loosens the survey requirement, so an unreadable
// log surfaces a WARN and yields '' — the check errs toward WARNING, never a false green.
function rangeMessages(range) {
  try {
    return execFileSync('git', ['log', '--format=%B', range], { encoding: 'utf-8' })
  } catch {
    process.stderr.write(
      `[reuse-survey] WARN: git log failed for range '${range}' — treating messages as empty.\n`,
    )
    return ''
  }
}

function main() {
  const { help, range, testMarker } = parseArgs(process.argv.slice(2))

  if (help) {
    process.stdout.write(HELP + '\n')
    process.exit(0)
  }

  // --test-marker mode: classify a single message string (for tests).
  if (testMarker !== undefined) {
    if (testMarker.includes(SURVEY_MARKER)) {
      process.stdout.write('[reuse-survey] VALID: survey marker present\n')
      process.exit(0)
    }
    process.stderr.write('[reuse-survey] SURVEY-MISSING: no survey marker in message\n')
    process.exit(1)
  }

  const added = addedFiles(range)
  if (added === null) process.exit(0) // addedFiles already surfaced the WARN

  const newSource = added.filter(isNewSourceFile)
  if (newSource.length === 0) {
    process.stdout.write('[reuse-survey] PASS — no new src/ or scripts/ files in range\n')
    process.exit(0)
  }

  if (rangeMessages(range).includes(SURVEY_MARKER)) {
    process.stdout.write(
      `[reuse-survey] PASS — ${newSource.length} new source file(s), survey documented\n`,
    )
    process.exit(0)
  }

  process.stderr.write(
    `[reuse-survey] SURVEY-MISSING: ${newSource.length} new file(s) under src/ or scripts/ added ` +
      `without a documented existing-code survey (INV-70):\n`,
  )
  for (const f of newSource) process.stderr.write(`  new file: ${f}\n`)
  process.stderr.write(
    `  Record the CANON-16 survey in a commit message or PR body, e.g.\n` +
      `    ${SURVEY_MARKER} checked REUSE_REGISTRY, no similar entry.\n`,
  )
  process.exit(1)
}

// Top-level fail-closed guard (INV-96): any unexpected error aborts the gate, never a silent pass.
try {
  main()
} catch (err) {
  process.stderr.write(
    `[reuse-survey] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}
