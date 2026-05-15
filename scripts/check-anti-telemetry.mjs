#!/usr/bin/env node
// Anti-telemetry assertion (#642): scans dist/ + src/templates/ for network call patterns.
// Cross-references against suppressions/telemetry-allowlist.json.
// Fails if any match is not in the allowlist.
//
// Usage: node scripts/check-anti-telemetry.mjs [--dir=<path>]
// Requires: dist/ to exist (run npm run build first in CI)
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, relative } from 'node:path'

const root = process.cwd()

const PATTERNS = [
  'fetch(',
  'http.request(',
  'https.request(',
  'axios',
  'segment.',
  'amplitude.',
  'mixpanel',
  'posthog',
  'sentry',
  'bugsnag',
]

// dist/templates/ is a verbatim copy of src/templates/ — scan src/templates/ only to avoid
// duplicate matches that would break allowlist path prefix checks.
const SCAN_DIRS = [
  { dir: 'dist', excludeDirs: ['templates'] },
  { dir: 'src/templates', excludeDirs: [] },
]

function loadAllowlist() {
  const allowlistPath = resolve(root, 'suppressions/telemetry-allowlist.json')
  if (!existsSync(allowlistPath)) return []
  try {
    return JSON.parse(readFileSync(allowlistPath, 'utf-8'))
  } catch (err) {
    process.stderr.write(
      `[check-anti-telemetry] ERROR: failed to parse suppressions/telemetry-allowlist.json: ${err instanceof Error ? err.message : String(err)}\nCheck the file for JSON syntax errors.\n`,
    )
    process.exit(2)
  }
}

function grep(pattern, dir, excludeDirs = []) {
  const absDir = resolve(root, dir)
  if (!existsSync(absDir)) return []

  const args = ['-rn', '--include=*', '-F']
  for (const ex of excludeDirs) {
    args.push(`--exclude-dir=${ex}`)
  }
  args.push(pattern, absDir)

  const result = spawnSync('grep', args, {
    encoding: 'utf-8',
  })

  if (result.error) {
    process.stderr.write(
      `[check-anti-telemetry] ERROR: grep spawn failed for pattern "${pattern}" in ${dir}: ${result.error.message}\n`,
    )
    process.exit(2)
  }

  if (result.status === 2) {
    process.stderr.write(
      `[check-anti-telemetry] ERROR: grep scan error for pattern "${pattern}" in ${dir}: ${result.stderr ?? ''}\n`,
    )
    process.exit(2)
  }

  if (!result.stdout) return []

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const colonIdx = line.indexOf(':')
      const file = line.slice(0, colonIdx)
      return { pattern, file: relative(root, file), line }
    })
}

const allowlist = loadAllowlist()

function isAllowed(match) {
  return allowlist.some(
    (entry) => match.pattern === entry.pattern && match.file.startsWith(entry.file),
  )
}

const violations = []

for (const { dir, excludeDirs } of SCAN_DIRS) {
  for (const pattern of PATTERNS) {
    const matches = grep(pattern, dir, excludeDirs)
    for (const match of matches) {
      if (!isAllowed(match)) {
        violations.push(match)
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `[check-anti-telemetry] FAIL: ${violations.length} unlisted network pattern(s) found:\n`,
  )
  for (const v of violations) {
    process.stderr.write(`  ${v.file}: pattern "${v.pattern}"\n`)
  }
  process.stderr.write(
    '\nTo suppress a legitimate match, add an entry to suppressions/telemetry-allowlist.json.\n' +
      'See PRIVACY.md for the allowlist format and anti-telemetry pledge.\n',
  )
  process.exit(1)
}

const scannedDirs = SCAN_DIRS.map(({ dir }) => dir).join(', ')
process.stdout.write(
  `[check-anti-telemetry] PASS: scanned ${scannedDirs} — no unlisted network patterns\n`,
)
process.exit(0)
