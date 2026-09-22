// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyGreenExecution } from '../../src/evidence/tdd-reexecute.js'
import type { TddEvidence } from '../../src/evidence/tdd.js'

const dirs: string[] = []
const originalPath = process.env.PATH
const originalHookGitCwd = process.env.ARBITER_HOOK_GIT_CWD

function fixture(
  testPath: string,
  testRunLog: string,
  testCommand: string[],
  test_blob_sha?: string,
): TddEvidence {
  return {
    $schemaVersion: 1,
    task_id: '#2820',
    test_path: testPath,
    test_commit_sha: 'a'.repeat(40),
    test_run_log: testRunLog,
    observed_failure: testRunLog,
    recorded_at: '2026-09-22T00:00:00.000Z',
    test_command: testCommand,
    ...(test_blob_sha === undefined ? {} : { test_blob_sha }),
  }
}

function gitBlobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex')
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function gradleFixture(dir: string, xml: string | null, existingXml?: string): TddEvidence {
  const testPath = 'src/test/java/RecordedTest.java'
  mkdirSync(join(dir, 'src/test/java'), { recursive: true })
  writeFileSync(join(dir, testPath), 'class RecordedTest {}\n')
  mkdirSync(join(dir, 'build/test-results/test'), { recursive: true })
  if (existingXml !== undefined) {
    writeFileSync(join(dir, 'build/test-results/test/TEST-recorded.xml'), existingXml)
  }
  const xmlWrite =
    xml === null
      ? ''
      : `mkdir -p build/test-results/test\nprintf '%s' ${JSON.stringify(xml)} > build/test-results/test/TEST-recorded.xml\n`
  writeFileSync(
    join(dir, 'gradlew'),
    `#!/bin/sh
count=0
if [ -f replays ]; then count=$(cat replays); fi
printf '%s' $((count + 1)) > replays
${xmlWrite}printf '%s\\n' 'BUILD SUCCESSFUL'\n`,
  )
  chmodSync(join(dir, 'gradlew'), 0o755)
  return fixture(
    testPath,
    'BUILD FAILED',
    ['./gradlew', 'test'],
    gitBlobSha(readFileSync(join(dir, testPath), 'utf8')),
  )
}

afterEach(() => {
  process.env.PATH = originalPath
  if (originalHookGitCwd === undefined) delete process.env.ARBITER_HOOK_GIT_CWD
  else process.env.ARBITER_HOOK_GIT_CWD = originalHookGitCwd
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe.sequential('verifyGreenExecution real runner output', () => {
  it('rejects a skipped Vitest RED test even when an unrelated test passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-vitest-'))
    dirs.push(dir)
    const testPath = 'skip.test.ts'
    const runnerPath = 'vitest-output.mjs'
    writeFileSync(
      join(dir, testPath),
      "import { it, expect } from 'vitest'\nit.skip('recorded RED', () => expect(1).toBe(2))\nit('unrelated', () => expect(1).toBe(1))\n",
    )
    writeFileSync(
      join(dir, runnerPath),
      "process.stdout.write('Tests  1 passed | 1 \\u001b[2mskipped\\u001b[22m (2)\\n')\n",
    )
    const result = verifyGreenExecution(
      fixture(
        testPath,
        `FAIL ${testPath}\n1 test failed`,
        ['node', runnerPath],
        gitBlobSha(readFileSync(join(dir, testPath), 'utf8')),
      ),
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
      fixture(
        testPath,
        'TAP version 13\n# tests 1\n# pass 0\n# fail 1',
        ['node', '--test', testPath],
        gitBlobSha(readFileSync(join(dir, testPath), 'utf8')),
      ),
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
      fixture(
        testPath,
        '--- FAIL: TestGreen (0.00s)',
        ['go', 'test', './'],
        gitBlobSha(readFileSync(join(dir, testPath), 'utf8')),
      ),
      dir,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Go test was skipped/)
  })

  it('rejects an unrelated passing replacement at the recorded test path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-content-'))
    dirs.push(dir)
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir')
    const testPath = 'recorded.test.ts'
    const recordedContent =
      "import { it, expect } from 'vitest'\nit('recorded RED', () => expect(1).toBe(2))\n"
    writeFileSync(
      join(dir, testPath),
      `${recordedContent}it('unrelated', () => expect(1).toBe(1))\n`,
    )
    const result = verifyGreenExecution(
      fixture(
        testPath,
        `FAIL ${testPath}\n1 test failed`,
        ['npx', 'vitest', 'run', testPath],
        gitBlobSha(recordedContent),
      ),
      dir,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/content|blob|recorded RED test/i)
  })

  it('derives RED content for legacy receipts without test_blob_sha', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-legacy-content-'))
    dirs.push(dir)
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir')
    git(dir, ['init', '--quiet'])
    git(dir, ['config', 'user.name', 'Arbiter Test'])
    git(dir, ['config', 'user.email', 'test.invalid'])
    const testPath = 'recorded.test.ts'
    writeFileSync(
      join(dir, testPath),
      "import { it, expect } from 'vitest'\nit('recorded RED', () => expect(1).toBe(2))\n",
    )
    git(dir, ['add', testPath])
    git(dir, ['commit', '--quiet', '-m', 'record RED test'])
    const redCommit = git(dir, ['rev-parse', 'HEAD'])
    const replay = join(dir, 'replay')
    mkdirSync(replay)
    symlinkSync(resolve('node_modules'), join(replay, 'node_modules'), 'dir')
    writeFileSync(
      join(replay, testPath),
      "import { it, expect } from 'vitest'\nit('unrelated', () => expect(1).toBe(1))\n",
    )
    process.env.ARBITER_HOOK_GIT_CWD = dir

    const result = verifyGreenExecution(
      {
        $schemaVersion: 1,
        task_id: '#2820',
        test_path: testPath,
        test_commit_sha: redCommit,
        test_run_log: `FAIL ${testPath}\n1 test failed`,
        observed_failure: `FAIL ${testPath}`,
        recorded_at: '2026-09-22T00:00:00.000Z',
        test_command: ['npx', 'vitest', 'run', testPath],
      },
      replay,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/content|blob|recorded RED test/i)
  })

  it('accepts one fresh passing Gradle/JUnit result from the replay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-green-gradle-pass-'))
    dirs.push(dir)
    const result = verifyGreenExecution(
      gradleFixture(
        dir,
        '<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase classname="RecordedTest" name="passes"/></testsuite>',
      ),
      dir,
    )
    expect(result).toEqual({ ok: true })
    expect(readFileSync(join(dir, 'replays'), 'utf8')).toBe('1')
  })

  it.each([
    [
      'stale',
      null,
      '<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase/></testsuite>',
    ],
    ['zero', '<testsuite tests="0" failures="0" errors="0" skipped="0"/>', undefined],
    [
      'skipped',
      '<testsuite tests="1" failures="0" errors="0" skipped="1"><testcase><skipped/></testcase></testsuite>',
      undefined,
    ],
    [
      'failing',
      '<testsuite tests="1" failures="1" errors="0" skipped="0"><testcase><failure/></testcase></testsuite>',
      undefined,
    ],
  ])('rejects %s Gradle/JUnit XML and never replays twice', (kind, xml, existingXml) => {
    const dir = mkdtempSync(join(tmpdir(), `arbiter-green-gradle-${kind}-`))
    dirs.push(dir)
    const result = verifyGreenExecution(gradleFixture(dir, xml, existingXml ?? undefined), dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(new RegExp(kind === 'stale' ? 'fresh' : kind, 'i'))
    expect(readFileSync(join(dir, 'replays'), 'utf8')).toBe('1')
  })
})
