// SPDX-License-Identifier: Apache-2.0
// TDD RED: #1051 — native fixture runner asserts exit==0 only, no test-count check.
// These unit tests verify each per-stack parser against representative sample outputs.
// RED state: parsers module does not exist yet.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ParseCtx } from '../../../__tests__/integration/e2e/native/parsers.js'
import {
  countGoTests,
  countRustTests,
  countVitestTests,
  countPytestTests,
  countJavaTests,
} from '../../../__tests__/integration/e2e/native/parsers.js'

// --- sample outputs ---

const GO_STDOUT_2TESTS = [
  '{"Time":"2024-01-01T00:00:00Z","Action":"run","Package":"github.com/example/go-library-fixture","Test":"TestAdd"}',
  '{"Time":"2024-01-01T00:00:00Z","Action":"pass","Package":"github.com/example/go-library-fixture","Test":"TestAdd","Elapsed":0.001}',
  '{"Time":"2024-01-01T00:00:00Z","Action":"run","Package":"github.com/example/go-library-fixture","Test":"TestMultiply"}',
  '{"Time":"2024-01-01T00:00:00Z","Action":"pass","Package":"github.com/example/go-library-fixture","Test":"TestMultiply","Elapsed":0.001}',
  '{"Time":"2024-01-01T00:00:00Z","Action":"pass","Package":"github.com/example/go-library-fixture","Elapsed":0.002}',
].join('\n')

const GO_STDOUT_WITH_SUBTESTS = [
  '{"Action":"pass","Package":"pkg","Test":"TestParent","Elapsed":0.001}',
  '{"Action":"pass","Package":"pkg","Test":"TestParent/sub1","Elapsed":0.001}',
  '{"Action":"pass","Package":"pkg","Test":"TestParent/sub2","Elapsed":0.001}',
  '{"Action":"pass","Package":"pkg","Elapsed":0.002}',
].join('\n')

const RUST_STDOUT_2TESTS = `
running 2 tests
test adds_two_numbers ... ok
test multiplies_two_numbers ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`.trimStart()

const RUST_STDOUT_MULTI_BINARY = `
running 2 tests
test lib_test ... ok
test lib_test2 ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


running 1 test
test integration_test ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`.trimStart()

const VITEST_JSON_2TESTS = JSON.stringify({
  testResults: [
    {
      assertionResults: [{ status: 'passed', title: 'adds two' }],
      status: 'passed',
    },
  ],
  numPassedTests: 2,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  success: true,
})

const PYTEST_XML_2TESTS = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="0" skipped="0" tests="2" time="0.123">
    <testcase classname="tests.test_math" name="test_add" time="0.001"/>
    <testcase classname="tests.test_math" name="test_multiply" time="0.001"/>
  </testsuite>
</testsuites>`

const PYTEST_XML_WITH_SKIPPED = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="0" skipped="1" tests="3" time="0.200">
    <testcase classname="tests.test_math" name="test_add" time="0.001"/>
    <testcase classname="tests.test_math" name="test_multiply" time="0.001"/>
    <testcase classname="tests.test_math" name="test_skipped" time="0.000">
      <skipped message="skipped"/>
    </testcase>
  </testsuite>
</testsuites>`

const SUREFIRE_XML_2TESTS = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.MathTest" tests="2" skipped="0" errors="0" failures="0" time="0.123">
  <testcase classname="com.example.MathTest" name="testAdd" time="0.001"/>
  <testcase classname="com.example.MathTest" name="testMultiply" time="0.001"/>
</testsuite>`

function ctx(opts: Partial<ParseCtx> = {}): ParseCtx {
  return { stdout: '', stderr: '', cwd: tmpdir(), ...opts }
}

describe('#1051 — native stack parsers', () => {
  const staged: string[] = []

  afterEach(() => {
    for (const d of staged.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  // --- Go ---
  describe('countGoTests', () => {
    it('counts top-level passed tests', () => {
      expect(countGoTests(ctx({ stdout: GO_STDOUT_2TESTS }))).toBe(2)
    })
    it('returns 0 for empty output', () => {
      expect(countGoTests(ctx({ stdout: '' }))).toBe(0)
    })
    it('excludes subtests (TestParent/sub* should not count)', () => {
      // GO_STDOUT_WITH_SUBTESTS has TestParent (top) + TestParent/sub1 + TestParent/sub2
      expect(countGoTests(ctx({ stdout: GO_STDOUT_WITH_SUBTESTS }))).toBe(1)
    })
    it('skips non-JSON lines (panic output, fmt.Println in TestMain)', () => {
      // go test -json may emit non-JSON on panic; parser skips them to avoid false failure
      const mixedOutput = [
        '{"Action":"run","Package":"pkg","Test":"TestA"}',
        'panic: something went wrong',
        '{"Action":"pass","Package":"pkg","Test":"TestA","Elapsed":0.001}',
      ].join('\n')
      expect(countGoTests(ctx({ stdout: mixedOutput }))).toBe(1)
    })
  })

  // --- Rust ---
  describe('countRustTests', () => {
    it('counts passed tests from single binary', () => {
      expect(countRustTests(ctx({ stdout: RUST_STDOUT_2TESTS }))).toBe(2)
    })
    it('sums across multiple binary summaries', () => {
      expect(countRustTests(ctx({ stdout: RUST_STDOUT_MULTI_BINARY }))).toBe(3)
    })
    it('returns 0 for empty output (no tests ran)', () => {
      expect(countRustTests(ctx({ stdout: '' }))).toBe(0)
    })
  })

  // --- Vitest JSON ---
  describe('countVitestTests', () => {
    it('reads numPassedTests from JSON reporter output', () => {
      expect(countVitestTests(ctx({ stdout: VITEST_JSON_2TESTS }))).toBe(2)
    })
    it('throws on malformed JSON after the first {', () => {
      expect(() => countVitestTests(ctx({ stdout: '{ broken' }))).toThrow()
    })
    it('returns 0 for empty stdout', () => {
      expect(countVitestTests(ctx({ stdout: '' }))).toBe(0)
    })
    it('tolerates npm script-echo preamble before JSON', () => {
      const withPreamble = `> vitest run --reporter=json\n\n${VITEST_JSON_2TESTS}`
      expect(countVitestTests(ctx({ stdout: withPreamble }))).toBe(2)
    })
  })

  // --- pytest JUnit XML ---
  describe('countPytestTests', () => {
    it('counts tests from JUnit XML', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-pytest-'))
      staged.push(cwd)
      writeFileSync(join(cwd, 'results.xml'), PYTEST_XML_2TESTS)
      expect(countPytestTests(ctx({ cwd }))).toBe(2)
    })
    it('subtracts skipped from total', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-pytest-'))
      staged.push(cwd)
      writeFileSync(join(cwd, 'results.xml'), PYTEST_XML_WITH_SKIPPED)
      expect(countPytestTests(ctx({ cwd }))).toBe(2) // 3 - 1 skipped
    })
    it('throws when results.xml is absent', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-pytest-'))
      staged.push(cwd)
      expect(() => countPytestTests(ctx({ cwd }))).toThrow()
    })
  })

  // --- Java Surefire XML ---
  describe('countJavaTests', () => {
    it('sums tests from Surefire XML files', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-java-'))
      staged.push(cwd)
      mkdirSync(join(cwd, 'build', 'test-results', 'test'), { recursive: true })
      writeFileSync(
        join(cwd, 'build', 'test-results', 'test', 'TEST-MathTest.xml'),
        SUREFIRE_XML_2TESTS,
      )
      expect(countJavaTests(ctx({ cwd }))).toBe(2)
    })
    it('returns 0 when build/test-results/test/ does not exist', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-java-'))
      staged.push(cwd)
      expect(countJavaTests(ctx({ cwd }))).toBe(0)
    })
    it('sums across multiple XML files', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-java-'))
      staged.push(cwd)
      mkdirSync(join(cwd, 'build', 'test-results', 'test'), { recursive: true })
      writeFileSync(
        join(cwd, 'build', 'test-results', 'test', 'TEST-MathTest.xml'),
        SUREFIRE_XML_2TESTS,
      )
      writeFileSync(
        join(cwd, 'build', 'test-results', 'test', 'TEST-MoreTest.xml'),
        SUREFIRE_XML_2TESTS,
      )
      expect(countJavaTests(ctx({ cwd }))).toBe(4)
    })
    it('throws on malformed Surefire XML missing tests= attribute', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'arbiter-java-'))
      staged.push(cwd)
      mkdirSync(join(cwd, 'build', 'test-results', 'test'), { recursive: true })
      writeFileSync(
        join(cwd, 'build', 'test-results', 'test', 'TEST-Broken.xml'),
        `<?xml version="1.0"?><testsuite name="broken"/>`,
      )
      expect(() => countJavaTests(ctx({ cwd }))).toThrow(/Surefire XML.*malformed|tests=/)
    })
  })
})
