// SPDX-License-Identifier: Apache-2.0
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyGreenExecution } from '../../src/evidence/tdd-reexecute.js'
import type { TddEvidence } from '../../src/evidence/tdd.js'

const dirs: string[] = []
const originalPath = process.env.PATH

function fixture(testPath: string, testRunLog: string, testCommand: string[]): TddEvidence {
  return {
    $schemaVersion: 1,
    task_id: '#2820',
    test_path: testPath,
    test_commit_sha: 'a'.repeat(40),
    test_run_log: testRunLog,
    observed_failure: testRunLog,
    recorded_at: '2026-09-22T00:00:00.000Z',
    test_command: testCommand,
  }
}

afterEach(() => {
  process.env.PATH = originalPath
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe.sequential('verifyGreenExecution real runner output', () => {
  it('rejects a skipped Vitest RED test even when an unrelated test passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-vitest-'))
    dirs.push(dir)
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir')
    const testPath = 'skip.test.ts'
    writeFileSync(
      join(dir, testPath),
      "import { it, expect } from 'vitest'\nit.skip('recorded RED', () => expect(1).toBe(2))\nit('unrelated', () => expect(1).toBe(1))\n",
    )
    const result = verifyGreenExecution(
      fixture(testPath, `FAIL ${testPath}\n1 test failed`, ['npx', 'vitest', 'run', testPath]),
      dir,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/skipped/i)
  })

  it('accepts a successful Node TAP run whose summary says skipped zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-tap-'))
    dirs.push(dir)
    const testPath = 'pass.test.js'
    writeFileSync(
      join(dir, testPath),
      "const test = require('node:test')\nconst assert = require('node:assert')\ntest('passes', () => assert.equal(1, 1))\n",
    )
    const result = verifyGreenExecution(
      fixture(testPath, 'TAP version 13\n# tests 1\n# pass 0\n# fail 1', [
        'node',
        '--test',
        testPath,
      ]),
      dir,
    )
    expect(result).toEqual({ ok: true })
  })

  it('adds Go JSON reporting and rejects a sole skipped test', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-go-'))
    dirs.push(dir)
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    const go = join(bin, 'go')
    writeFileSync(
      go,
      '#!/bin/sh\ncase " $* " in *\' -json \'*) printf \'%s\\n\' \'{"Action":"run","Test":"TestGreen"}\' \'{"Action":"skip","Test":"TestGreen"}\' \'{"Action":"pass"}\';; *) printf \'ok\\n\';; esac\n',
    )
    chmodSync(go, 0o755)
    process.env.PATH = `${bin}:${originalPath ?? ''}`
    const testPath = 'main_test.go'
    writeFileSync(join(dir, testPath), 'package example')
    const result = verifyGreenExecution(
      fixture(testPath, '--- FAIL: TestGreen (0.00s)', ['go', 'test', './']),
      dir,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Go test was skipped/)
  })
})
