#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-25 / #1039 — silent-green guard for named test-category scripts.
// CATALOG: Detects --passWithNoTests in test:* package.json scripts and CI
// CATALOG: workflow run steps. No existing check-*.mjs script covers the
// CATALOG: anti-pattern of test jobs that silently pass on an empty directory;
// CATALOG: check-workflow-test-integrity.mjs validates workflow structure but
// CATALOG: not this specific flag. Justified as a distinct script.
// A4 (#1039): Forbid --passWithNoTests in named test-category scripts.
// A test:* script that silently passes when no tests exist is a lie — it masks
// test infrastructure rot. This script enforces that all test-category scripts
// in package.json and CI workflows run their tests or fail loudly.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

try {
  const violations = []

  // ── package.json: any test:* script containing --passWithNoTests ────────────
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  const scripts = pkg.scripts ?? {}
  for (const [name, cmd] of Object.entries(scripts)) {
    // The canonical `test` script (what `npm test` runs) is just as much a
    // test-category script as any `test:*` sibling — a bare
    // `"test": "vitest run --passWithNoTests"` silently passes on an empty
    // suite, which is the exact lie this guard exists to catch.
    if ((name === 'test' || name.startsWith('test:')) && cmd.includes('--passWithNoTests')) {
      violations.push(`  package.json scripts.${name}: ${cmd}`)
    }
  }

  // ── CI workflows: any run step containing --passWithNoTests ─────────────────
  const workflowDir = '.github/workflows'
  if (existsSync(workflowDir)) {
    for (const file of readdirSync(workflowDir)) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue
      const path = join(workflowDir, file)
      const content = readFileSync(path, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('--passWithNoTests')) {
          violations.push(`  ${path}:${i + 1}: ${lines[i].trim()}`)
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('check-no-passwithnotests: found --passWithNoTests in test-category scripts:')
    for (const v of violations) {
      console.error(v)
    }
    console.error(
      '\n  --passWithNoTests makes test jobs silently pass when no tests exist.' +
        '\n  Either populate the test directory or remove the script.' +
        '\n  See INV-25 and Wave A (#1039).',
    )
    process.exit(1)
  }

  console.log('check-no-passwithnotests: OK')
} catch (err) {
  console.error(`check-no-passwithnotests: unexpected error: ${err.message}`)
  process.exit(1)
}
