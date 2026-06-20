// SPDX-License-Identifier: Apache-2.0
// Wave D (#1042): native-toolchain E2E — prove each library fixture is a real
// project by running its own test runner in a staged tmpdir copy.
// Guard: set VITEST_NATIVE=1 to run. Skipped in PR-fast tier (T1) — covered
// nightly (T4). See docs/SYSTEM/E2E-RUNTIMES.md for tier policy.
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { missingBinaries, stageFixture } from '../helpers.js'
import type { ParseCtx } from './parsers.js'
import {
  countGoTests,
  countJavaTests,
  countPytestTests,
  countRustTests,
  countVitestTests,
} from './parsers.js'

const NATIVE = process.env.VITEST_NATIVE === '1'

interface StackDef {
  fixture: string
  /** Toolchain binaries the stack's native runner needs on PATH. */
  bins: string[]
  cmds: string[][]
  assertTests: (ctx: ParseCtx) => number
}

const STACKS: StackDef[] = [
  {
    fixture: 'ts-library',
    bins: ['npm'],
    cmds: [
      ['npm', 'ci', '--no-audit', '--no-fund'],
      ['npm', 'test', '--', '--reporter=json'],
    ],
    assertTests: countVitestTests,
  },
  {
    fixture: 'python-library',
    bins: ['pip', 'pytest'],
    cmds: [
      ['pip', 'install', '-e', '.[test]'],
      ['pytest', '--junit-xml=results.xml'],
    ],
    assertTests: countPytestTests,
  },
  {
    fixture: 'go-library',
    bins: ['go'],
    cmds: [['go', 'test', '-json', './...']],
    assertTests: countGoTests,
  },
  {
    fixture: 'java-library-gradle',
    bins: ['java'],
    cmds: [['./gradlew', 'test', '--no-daemon']],
    assertTests: countJavaTests,
  },
  {
    fixture: 'rust-library',
    bins: ['cargo'],
    cmds: [['cargo', 'test', '--frozen']],
    assertTests: countRustTests,
  },
]

describe.skipIf(!NATIVE)('native — toolchain smoke tests', () => {
  const staged: string[] = []

  afterEach(() => {
    for (const d of staged.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  for (const { fixture, bins, cmds, assertTests } of STACKS) {
    // Missing toolchain on this runner → visible SKIP (the twin bake-e2e-native
    // matrix job installs the toolchain and tests the stack for real). #1459.
    it.skipIf(missingBinaries(bins).length > 0)(
      `${fixture} — native runner exits 0 and collects ≥1 test`,
      { timeout: 300_000 },
      () => {
        const dir = stageFixture(fixture)
        staged.push(dir)
        let lastStdout = ''
        let lastStderr = ''
        for (const cmd of cmds) {
          const [bin, ...args] = cmd
          if (bin == null) throw new Error(`[${fixture}] empty cmd in STACKS`)
          const result = spawnSync(bin, args, { cwd: dir, encoding: 'utf-8' })
          if (result.error != null) {
            throw new Error(`[${fixture}] failed to spawn '${bin}': ${result.error.message}`)
          }
          expect(
            result.status,
            `[${fixture}] ${bin} ${args.join(' ')} exited ${String(result.status)}:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
          ).toBe(0)
          lastStdout = result.stdout
          lastStderr = result.stderr
        }
        const count = assertTests({ stdout: lastStdout, stderr: lastStderr, cwd: dir })
        expect(
          count,
          `[${fixture}] assertTests returned ${count} — fixture may have zero tests collected (cwd: ${dir})`,
        ).toBeGreaterThanOrEqual(1)
      },
    )
  }
})
