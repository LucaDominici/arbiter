#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — workflow SHA-pinning drift detector (INV-89)
// Validates that all third-party GitHub Actions references in .github/ are SHA-pinned.
// Exits 0 when all refs are SHA-pinned; exits 1 when tag/branch refs are found.
// Part of the anti-drift validator family (W6).
//
// Usage: node scripts/check-workflow-sha-pinning.mjs [--dir <path>] [--help]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectYamlFiles, parseHelpAndDir } from './lib/workflow-scan.mjs'

const args = process.argv.slice(2)
const { cwd: CWD } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-workflow-sha-pinning.mjs [options]',
    '',
    'Validates that all GitHub Actions references in .github/ are SHA-pinned.',
    'Exits 0 when all refs are SHA-pinned; exits 1 when tag/branch refs are found.',
    '',
    'Options:',
    '  --dir <path>    Root directory to scan (default: cwd)',
    '  --help, -h      Show this help and exit',
    '',
  ].join('\n'),
})

const SHA_RE = /^[0-9a-f]{40}$/
const USES_RE = /^\s*(?:-\s+)?uses:\s+(?:"([^"]+)"|'([^']+)'|(\S+))/

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows')),
  ...collectYamlFiles(join(CWD, '.github', 'actions')),
]

let violations = 0

for (const file of yamlFiles) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch {
    continue
  }
  for (const line of content.split('\n')) {
    const m = USES_RE.exec(line)
    if (!m) continue
    const ref = m[1] ?? m[2] ?? m[3]
    if (!ref || ref.startsWith('.')) continue // local action
    const atIdx = ref.lastIndexOf('@')
    if (atIdx < 0) continue
    const pin = ref.slice(atIdx + 1)
    if (!SHA_RE.test(pin)) {
      process.stderr.write(`[FAIL] non-SHA action reference: ${ref} in ${file}\n`)
      violations++
    }
  }
}

if (violations > 0) {
  process.stderr.write(
    `check-workflow-sha-pinning: FAIL — ${violations} non-SHA-pinned action reference(s) found (INV-89)\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `check-workflow-sha-pinning: OK — all action references are SHA-pinned (INV-89, ${yamlFiles.length} files scanned)\n`,
)
process.exit(0)
