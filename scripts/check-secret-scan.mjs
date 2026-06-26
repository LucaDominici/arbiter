#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — secret pattern drift checker (INV-89)
// Validates that common secret patterns are not present in tracked source files.
// Complements gitleaks; provides fast local check without external tool dependency.
// Exits 0 when no secrets found; exits 1 when potential secrets detected.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-secret-scan.mjs [--dir <path>] [--help]

import { readFileSync } from 'node:fs'
import { join, resolve, extname, basename } from 'node:path'
import { walkRepo } from './lib/glob-walk.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-secret-scan.mjs [options]',
      '',
      'Validates that common secret patterns are not present in tracked source files.',
      'Exits 0 when no secrets found; exits 1 when potential secrets detected.',
      '',
      'Options:',
      '  --dir <path>    Root directory to scan (default: cwd)',
      '  --help, -h      Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const dirArg = args.indexOf('--dir')
const CWD = dirArg >= 0 && args[dirArg + 1] ? resolve(args[dirArg + 1]) : process.cwd()

// Patterns that indicate hardcoded secrets (high-signal, low false-positive)
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'AWS Secret Key',
    re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?[A-Za-z0-9/+]{40}["']?/,
  },
  { name: 'GitHub Token (classic)', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'GitHub Token (fine-grained)', re: /github_pat_[A-Za-z0-9_]{82}/ },
]

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.sh',
  '.env',
])
const IGNORED_FILES = new Set(['.gitleaksignore', 'pii-allowlist.json'])

// Tree-walk + vendor-dir pruning is delegated to the shared hardened helper
// (scripts/lib/glob-walk.mjs): one canonical SKIP_DIRS set plus the lstat /
// skip-symlink cycle guard, replacing this script's own recursive walker
// (#1521). walkRepo yields repo-relative POSIX paths under CWD; we rejoin to
// CWD and apply the secret-scan file allow-list (extension + ignored names).
const files = walkRepo(CWD)
  .map((rel) => join(CWD, rel))
  .filter(
    (full) =>
      !IGNORED_FILES.has(basename(full)) && SCANNED_EXTENSIONS.has(extname(full).toLowerCase()),
  )
let violations = 0

for (const file of files) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }

  // Skip test files and fixtures (may contain dummy secrets for testing)
  if (file.includes('__tests__/') || file.includes('/fixtures/') || file.includes('/test-data/'))
    continue

  for (const { name, re } of SECRET_PATTERNS) {
    const match = re.exec(content)
    if (match) {
      process.stderr.write(
        `[FAIL] potential ${name} found in ${file}: "${match[0].slice(0, 40)}..."\n`,
      )
      violations++
      break // one violation per file
    }
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-secret-scan: FAIL — ${violations} file(s) with potential secrets found (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-secret-scan: OK — no secret patterns found in ${files.length} scanned file(s) (INV-89)\n`,
)
process.exit(0)
