// SPDX-License-Identifier: Apache-2.0
// #2906 — rule [S]: a pinned test changed after RED is replayed as the ORIGINAL at head.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyGreenExecution } from '../../src/evidence/tdd-reexecute.js'
import type { RedExecutionResult } from '../../src/evidence/tdd-reexecute.js'
import type { TddEvidence } from '../../src/evidence/tdd.js'

type TestChange = { class: string; reason?: string; redBlob: string; headBlob: string }
type Result = RedExecutionResult & { testChange?: TestChange }

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}
function gitBlobSha(content: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex')
}
function repo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `arbiter-2906-${prefix}-`))
  dirs.push(dir)
  git(dir, ['init', '--quiet'])
  git(dir, ['config', 'user.name', 'Arbiter Test'])
  git(dir, ['config', 'user.email', 'test.invalid'])
  return dir
}
function put(dir: string, path: string, content: string): void {
  writeFileSync(join(dir, path), content)
  chmodSync(join(dir, path), 0o755)
}
function commit(dir: string, message: string, body?: string): string {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '--quiet', '--allow-empty', '-m', message, ...(body ? ['-m', body] : [])])
  return git(dir, ['rev-parse', 'HEAD'])
}
function evidence(testPath: string, red: string, redBlob: string, log: string, cmd: string[]) {
  const ev: TddEvidence = {
    $schemaVersion: 1,
    task_id: '#2906',
    test_path: testPath,
    test_commit_sha: red,
    test_blob_sha: redBlob,
    test_run_log: log,
    observed_failure: log,
    recorded_at: '2026-09-25T00:00:00.000Z',
    test_command: cmd,
  }
  return ev
}
const shellTest = (cond: string): string =>
  `#!/bin/sh\nout=$(./impl.sh)\nif [ "$out" ${cond} ]; then\n  printf 'PASS: t\\n'\nelse\n  printf 'FAIL: got %s\\n' "$out"\n  exit 1\nfi\n`
const RED_T = shellTest('= 2')
const WEAK_T = shellTest('-gt 0')
const impl = (n: number): string => `#!/bin/sh\nprintf ${n}\n`

/** RED commit: impl prints 0, t.sh asserts = 2. Optional commits run before it. */
function shellRed(prefix: string, before?: (dir: string) => void) {
  const dir = repo(prefix)
  before?.(dir)
  put(dir, 'impl.sh', impl(0))
  put(dir, 't.sh', RED_T)
  const red = commit(dir, 'test: red')
  return { dir, ev: evidence('t.sh', red, gitBlobSha(RED_T), 'FAIL: got 0', ['sh', 't.sh']) }
}
/** Astra counterexample: incomplete fix (prints 1) plus `= 2` weakened to `-gt 0`. */
function astra(dir: string): void {
  put(dir, 'impl.sh', impl(1))
  put(dir, 't.sh', WEAK_T)
  commit(dir, 'fix: partial')
}
const green = (ev: TddEvidence, dir: string): Result => verifyGreenExecution(ev, dir) as Result
const SHELL = { timeout: 15_000 }

describe.sequential('GREEN gate Test-Amend rule [S] (#2906)', () => {
  it('AC-1 accepts a structural change when the original passes 3/3 at head', SHELL, () => {
    const { dir, ev } = shellRed('ac1')
    const headT = `${RED_T}printf 'PASS: extra\\n'\n`
    put(dir, 'impl.sh', impl(2))
    put(dir, 't.sh', headT)
    commit(dir, 'fix: impl')
    const result = green(ev, dir)
    expect(result.reason).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.testChange).toEqual({
      class: 'structural',
      redBlob: gitBlobSha(RED_T),
      headBlob: gitBlobSha(headT),
    })
  })

  it('AC-1 still requires the changed head test to pass', SHELL, () => {
    const { dir, ev } = shellRed('ac1-headfail')
    put(dir, 't.sh', `${RED_T}printf 'FAIL: extra\\n'\nexit 1\n`)
    commit(dir, 'test: add failing assertion')
    const result = green(ev, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/emitted a failure verdict|still fails/)
  })

  it('AC-2/AC-5 refuses the Astra counterexample without a trailer', SHELL, () => {
    const { dir, ev } = shellRed('ac2-astra')
    astra(dir)
    const head7 = git(dir, ['rev-parse', 'HEAD']).slice(0, 7)
    const cur7 = gitBlobSha(WEAK_T).slice(0, 7)
    const result = green(ev, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('E_SPEC_TEST_CONFLICT')
    expect(result.reason).toContain(`original t.sh@${gitBlobSha(RED_T).slice(0, 7)}`)
    expect(result.reason).toContain(`FAILS at ${head7} (3/3)`)
    expect(result.reason).toContain(`no Test-Amend trailer binds blob ${cur7}`)
    expect(result.reason).toContain('restore the original test and fix the code')
  })

  it('AC-2 accepts the same change with a binding Test-Amend trailer', SHELL, () => {
    const { dir, ev } = shellRed('ac2-trailer')
    astra(dir)
    const trailer = `Test-Amend: ${gitBlobSha(WEAK_T).slice(0, 7)} AC-1 range until impl completes`
    expect(trailer.length).toBeLessThanOrEqual(100)
    commit(dir, 'chore: amend pinned test', trailer)
    const result = green(ev, dir)
    expect(result.reason).toBeUndefined()
    expect(result.testChange).toEqual({
      class: 'test-amend',
      reason: 'AC-1 range until impl completes',
      redBlob: gitBlobSha(RED_T),
      headBlob: gitBlobSha(WEAK_T),
    })
  })

  it.each([
    ['blob it does not bind', () => `Test-Amend: ${gitBlobSha('other\n').slice(0, 7)} AC-1 other`],
    ['prefix shorter than 7', (cur: string) => `Test-Amend: ${cur.slice(0, 6)} AC-1 short`],
    ['empty reason', (cur: string) => `Test-Amend: ${cur.slice(0, 7)}`],
  ])(
    'AC-2 refuses a trailer with a %s',
    (_kind, trailer) => {
      const { dir, ev } = shellRed('ac2-bad')
      astra(dir)
      commit(dir, 'chore: amend pinned test', trailer(gitBlobSha(WEAK_T)))
      const result = green(ev, dir)
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('E_SPEC_TEST_CONFLICT')
    },
    15_000,
  )

  it('AC-2 refuses a trailer that bound an earlier amendment', SHELL, () => {
    const { dir, ev } = shellRed('ac2-superseded')
    const v1 = WEAK_T.replace('PASS: t', 'PASS: t v1')
    put(dir, 'impl.sh', impl(1))
    put(dir, 't.sh', v1)
    commit(dir, 'fix: partial', `Test-Amend: ${gitBlobSha(v1).slice(0, 7)} AC-1 first`)
    put(dir, 't.sh', WEAK_T)
    commit(dir, 'test: edit again')
    const result = green(ev, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('E_SPEC_TEST_CONFLICT')
  })

  it('AC-2 ignores a trailer committed before the RED commit', SHELL, () => {
    const cur7 = gitBlobSha(WEAK_T).slice(0, 7)
    const { dir, ev } = shellRed('ac2-prered', (d) => {
      commit(d, 'chore: early', `Test-Amend: ${cur7} AC-1 predates RED`)
    })
    astra(dir)
    const result = green(ev, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('E_SPEC_TEST_CONFLICT')
  })

  it('AC-3 never counts a zero-work original run as a pass', SHELL, () => {
    const dir = repo('ac3-zero')
    // The original exits 0 with no PASS verdict once impl prints 2.
    const zeroT = `#!/bin/sh\n[ "$(./impl.sh)" = 2 ] && exit 0\nprintf 'FAIL: got %s\\n' "$(./impl.sh)"\nexit 1\n`
    put(dir, 'impl.sh', impl(0))
    put(dir, 't.sh', zeroT)
    const red = commit(dir, 'test: red')
    put(dir, 'impl.sh', impl(2))
    put(dir, 't.sh', RED_T)
    commit(dir, 'fix: impl')
    const ev = evidence('t.sh', red, gitBlobSha(zeroT), 'FAIL: got 0', ['sh', 't.sh'])
    const result = green(ev, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('E_SPEC_TEST_CONFLICT')
    expect(result.reason).toContain('(3/3)')
  })

  it('AC-3 refuses mixed original results as nondeterministic', SHELL, () => {
    const dir = repo('ac3-mixed')
    const counterDir = mkdtempSync(join(tmpdir(), 'arbiter-2906-counter-'))
    dirs.push(counterDir)
    const counter = join(counterDir, 'n')
    const altT = `#!/bin/sh\nn=$(( $(cat ${counter} 2>/dev/null || echo 0) + 1 ))\nprintf '%s' "$n" > ${counter}\n[ $((n % 2)) -eq 0 ] && { printf 'PASS: t\\n'; exit 0; }\nprintf 'FAIL: odd %s\\n' "$n"\nexit 1\n`
    put(dir, 't.sh', altT)
    const red = commit(dir, 'test: red')
    put(dir, 't.sh', "#!/bin/sh\nprintf 'PASS: t\\n'\n")
    commit(dir, 'test: replace')
    const ev = evidence('t.sh', red, gitBlobSha(altT), 'FAIL: odd 1', ['sh', 't.sh'])
    const result = green(ev, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('E_SPEC_TEST_CONFLICT')
    expect(result.reason).toContain('nondeterministic')
    expect(result.reason).toContain('(1/3 pass)')
  })

  it('AC-5 accepts a structural change in a Vitest fixture', { timeout: 60_000 }, () => {
    const dir = repo('ac5-vitest')
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir')
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
    writeFileSync(join(dir, 'impl.js'), 'export const impl = () => 0\n')
    const redT =
      "import { expect, it } from 'vitest'\nimport { impl } from './impl.js'\nit('two', () => expect(impl()).toBe(2))\n"
    writeFileSync(join(dir, 'recorded.test.ts'), redT)
    const red = commit(dir, 'test: red')
    const headT = `${redT}it('extra', () => expect(1).toBe(1))\n`
    writeFileSync(join(dir, 'impl.js'), 'export const impl = () => 2\n')
    writeFileSync(join(dir, 'recorded.test.ts'), headT)
    commit(dir, 'fix: impl')
    const ev = evidence(
      'recorded.test.ts',
      red,
      gitBlobSha(redT),
      'FAIL recorded.test.ts\n1 test failed',
      ['npx', 'vitest', 'run', 'recorded.test.ts'],
    )
    const result = green(ev, dir)
    expect(result.reason).toBeUndefined()
    expect(result.testChange).toEqual({
      class: 'structural',
      redBlob: gitBlobSha(redT),
      headBlob: gitBlobSha(headT),
    })
  })
})
