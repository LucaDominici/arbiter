#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: INV-118 enforcement. Detects proforma (no-assertion) test methods in TypeScript/JavaScript
// CATALOG:   test files. Recognized assertions: expect(, assert., toBe(, toEqual(, toThrow(,
// CATALOG:   toHaveLength(, toContain(, assertThat, verify(. Bypass via
// CATALOG:   `// anti-proforma-exempt: <rationale>` comment. Bypass counter alarmed above 5% threshold.
// CATALOG: Rejected fold-in into check-test-naming.mjs (naming convention gate, different axis).
// CATALOG: Rejected fold-in into check-no-skipped-tests.mjs (skipped tests, not proforma tests).
// Exit codes per INV-53: 0=PASS/WARN (warn-default), 1=FAIL (--enforce), 2=ERROR
// Usage: node scripts/check-anti-proforma.mjs [--dir=<path>] [--enforce] [--help]

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkRepo } from './lib/glob-walk.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const HELP = `Usage: node scripts/check-anti-proforma.mjs [options]

Detects proforma test methods (no real assertions) in TypeScript/JavaScript test files.
Warn-default (exit 0) unless --enforce is set.

Options:
  --dir=<path>     Directory to scan for test files (default: repo root)
  --enforce        Promote to hard-block (exit 1) on violations
  --help, -h       Show this help and exit

Bypass:
  Add // anti-proforma-exempt: <rationale> in the test block to exclude it.
  Bypass ratio > 5% triggers EXEMPT-THRESHOLD warning.

Recognized assertion patterns:
  expect(   assert.   toBe(   toEqual(   toThrow(   toHaveLength(
  toContain(   assertThat   verify(   should.   toMatch(   toBeNull(`

const ASSERTION_PATTERNS = [
  /expect\s*\(/,
  /assert\./,
  /toBe\s*\(/,
  /toEqual\s*\(/,
  /toThrow\s*\(/,
  /toHaveLength\s*\(/,
  /toContain\s*\(/,
  /assertThat/,
  /verify\s*\(/,
  /should\./,
  /toMatch\s*\(/,
  /toBeNull\s*\(/,
  /toBeDefined\s*\(/,
  /toBeUndefined\s*\(/,
  /toBeGreaterThan\s*\(/,
  /toBeLessThan\s*\(/,
  /toHaveProperty\s*\(/,
  /toHaveBeenCalled\s*\(/,
  /toHaveBeenCalledWith\s*\(/,
  /toStrictEqual\s*\(/,
  /toBeInstanceOf\s*\(/,
]

const TEST_BLOCK_PATTERN = /^\s*(?:it|test)\s*\(/
const EXEMPT_COMMENT_PATTERN = /\/\/\s*anti-proforma-exempt:/i

/**
 * Returns true if the filename is a test file.
 */
function isTestFile(name) {
  return (
    name.endsWith('.test.ts') ||
    name.endsWith('.spec.ts') ||
    name.endsWith('.test.js') ||
    name.endsWith('.spec.js') ||
    name.endsWith('.test.mjs') ||
    name.endsWith('.spec.mjs')
  )
}

/**
 * Parse CLI arguments. Handles both --dir=<value> and --dir <value> forms.
 */
function parseArgs() {
  const raw = process.argv.slice(2)
  let dir = ROOT
  let enforce = false
  let help = false

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--enforce') {
      enforce = true
    } else if (arg.startsWith('--dir=')) {
      dir = resolve(arg.slice('--dir='.length))
    } else if (arg === '--dir' && i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
      dir = resolve(raw[i + 1])
      i++
    }
  }

  return { dir, enforce, help }
}

/**
 * Collect test files under `dir` via the shared, cycle-safe walker (#1521). walkRepo's SKIP_DIRS
 * already prune node_modules/.git/dist/build/coverage/.coverage.
 */
function collectTestFiles(dir) {
  const files = []
  for (const rel of walkRepo(dir)) {
    if (isTestFile(rel.slice(rel.lastIndexOf('/') + 1))) files.push(join(dir, rel))
  }
  return files
}

/**
 * Extract test blocks from file content.
 * Returns array of { lineNo, blockContent, exemptComment }.
 */
function extractTestBlocks(content) {
  const lines = content.split('\n')
  const blocks = []

  // Check for file-level exemption (a comment not preceded by a test() call on the same or next line)
  const fileLevelExempt = lines.some((l, idx) => {
    if (!EXEMPT_COMMENT_PATTERN.test(l)) return false
    // Check that this line is NOT immediately before a test block (which would be block-level)
    const nextLine = lines[idx + 1] ?? ''
    return !TEST_BLOCK_PATTERN.test(nextLine)
  })

  for (let i = 0; i < lines.length; i++) {
    if (!TEST_BLOCK_PATTERN.test(lines[i])) continue

    // Check if exemption comment is on the preceding line or current line
    const prevLine = i > 0 ? lines[i - 1] : ''
    const currentLine = lines[i]
    const hasExemptComment =
      fileLevelExempt ||
      EXEMPT_COMMENT_PATTERN.test(prevLine) ||
      EXEMPT_COMMENT_PATTERN.test(currentLine)

    // Collect the test block body (find matching braces)
    let depth = 0
    let blockContent = ''
    let started = false

    for (let j = i; j < Math.min(lines.length, i + 200); j++) {
      const line = lines[j]
      for (const ch of line) {
        if (ch === '{') {
          depth++
          started = true
        } else if (ch === '}') {
          depth--
        }
      }
      blockContent += line + '\n'
      if (started && depth === 0) break
    }

    blocks.push({ lineNo: i + 1, blockContent, exemptComment: hasExemptComment })
  }

  return blocks
}

/**
 * Check if block content contains a recognized assertion.
 */
function hasAssertion(blockContent) {
  return ASSERTION_PATTERNS.some((pat) => pat.test(blockContent))
}

function main() {
  const { dir, enforce, help } = parseArgs()

  if (help) {
    process.stdout.write(HELP + '\n')
    process.exit(0)
  }

  const testFiles = collectTestFiles(dir)

  let totalTests = 0
  let proformaViolations = 0
  let exemptTests = 0

  for (const file of testFiles) {
    let content
    try {
      content = readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    const blocks = extractTestBlocks(content)
    for (const block of blocks) {
      totalTests++
      if (block.exemptComment) {
        exemptTests++
        continue
      }
      if (!hasAssertion(block.blockContent)) {
        proformaViolations++
        process.stderr.write(
          `[anti-proforma] PROFORMA: ${file}:${block.lineNo} — test block has no recognized assertion\n`,
        )
      }
    }
  }

  // Bypass threshold alarm
  if (totalTests > 0 && exemptTests / totalTests > 0.05) {
    process.stderr.write(
      `[anti-proforma] EXEMPT-THRESHOLD: ${exemptTests}/${totalTests} tests are exempt (${Math.round((exemptTests / totalTests) * 100)}% > 5% threshold)\n`,
    )
  }

  if (proformaViolations > 0) {
    process.stderr.write(
      `[anti-proforma] ${proformaViolations} proforma test(s) found (no real assertions).\n`,
    )
    if (enforce) {
      process.exit(1)
    }
  }

  // Warn-default: exit 0 regardless of violations (unless --enforce)
  process.exit(0)
}

try {
  main()
} catch (err) {
  process.stderr.write(
    `[anti-proforma] ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}
