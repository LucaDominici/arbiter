// SPDX-License-Identifier: Apache-2.0
// #1051 — per-stack structured-output parsers.
// Each function returns the number of tests that passed (≥ 1 means the suite is real).
// Prefer structured formats (JSONL, JUnit XML, JSON reporter) over freeform stdout.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ParseCtx {
  stdout: string
  stderr: string
  cwd: string
}

// Go: parse JSONL from `go test -json ./...`.
// Count only top-level passed tests (no "/" in Test name — subtests excluded).
export function countGoTests(ctx: ParseCtx): number {
  const { stdout } = ctx
  if (!stdout.trim()) return 0
  let count = 0
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: { Action?: string; Test?: string }
    try {
      entry = JSON.parse(trimmed) as { Action?: string; Test?: string }
    } catch {
      // FAIL-OPEN-INTENT: go test -json may emit non-JSON lines on panic or fmt.Println in TestMain; skip them.
      continue
    }
    if (entry.Action === 'pass' && entry.Test != null && !entry.Test.includes('/')) {
      count++
    }
  }
  return count
}

// Rust: sum passed counts from all `test result: ok. N passed` summary lines.
// Cargo runs lib/bin/integration/doctest as separate processes — each emits its own summary.
export function countRustTests(ctx: ParseCtx): number {
  let count = 0
  for (const match of ctx.stdout.matchAll(/^test result:\s+ok\.\s+(\d+)\s+passed/gm)) {
    count += parseInt(match[1]!, 10)
  }
  return count
}

// Vitest: read numPassedTests from `vitest --reporter=json` stdout.
// Trim to first '{' to tolerate any npm script-echo preamble on stdout.
export function countVitestTests(ctx: ParseCtx): number {
  const { stdout } = ctx
  const jsonStart = stdout.indexOf('{')
  if (jsonStart < 0) return 0
  const parsed = JSON.parse(stdout.slice(jsonStart)) as { numPassedTests?: number }
  return parsed.numPassedTests ?? 0
}

// pytest: read tests and skipped from JUnit XML written to <cwd>/results.xml.
// Throws if results.xml is absent (no silent zero on missing output).
export function countPytestTests(ctx: ParseCtx): number {
  const xmlPath = join(ctx.cwd, 'results.xml')
  const content = readFileSync(xmlPath, 'utf-8')
  const suiteTag = content.match(/<testsuite\b[^>]*>/)
  if (!suiteTag) return 0
  const testsAttr = suiteTag[0].match(/\btests="(\d+)"/)
  if (!testsAttr) {
    throw new Error(
      `results.xml has <testsuite> without tests= attribute — likely a pytest collection error`,
    )
  }
  const tests = parseInt(testsAttr[1]!, 10)
  const skipped = parseInt(suiteTag[0].match(/\bskipped="(\d+)"/)?.[1] ?? '0', 10)
  return tests - skipped
}

// Java: sum `tests` attribute across all Surefire XML files in build/test-results/test/.
// Returns 0 (not ENOENT) when the directory does not exist — Gradle may skip test output
// when no tests are compiled.
export function countJavaTests(ctx: ParseCtx): number {
  const testResultsDir = join(ctx.cwd, 'build', 'test-results', 'test')
  let files: string[]
  try {
    files = readdirSync(testResultsDir).filter((f) => f.startsWith('TEST-') && f.endsWith('.xml'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }
  let count = 0
  for (const file of files) {
    const content = readFileSync(join(testResultsDir, file), 'utf-8')
    const match = content.match(/<testsuite\b[^>]*tests="(\d+)"/)
    if (!match) {
      throw new Error(
        `Surefire XML ${file} has no <testsuite tests="N"> attribute — file may be malformed or truncated`,
      )
    }
    count += parseInt(match[1]!, 10)
  }
  return count
}
