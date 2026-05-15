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

const SCAN_DIRS = ['dist', 'src/templates']

function loadAllowlist() {
  const allowlistPath = resolve(root, 'suppressions/telemetry-allowlist.json')
  if (!existsSync(allowlistPath)) return []
  return JSON.parse(readFileSync(allowlistPath, 'utf-8'))
}

function grep(pattern, dir) {
  const absDir = resolve(root, dir)
  if (!existsSync(absDir)) return []

  const result = spawnSync('grep', ['-rn', '--include=*', '-F', pattern, absDir], {
    encoding: 'utf-8',
  })

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

for (const dir of SCAN_DIRS) {
  for (const pattern of PATTERNS) {
    const matches = grep(pattern, dir)
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

process.stdout.write(
  `[check-anti-telemetry] PASS: scanned ${SCAN_DIRS.join(', ')} — no unlisted network patterns\n`,
)
process.exit(0)
