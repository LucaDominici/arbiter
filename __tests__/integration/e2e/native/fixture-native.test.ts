// SPDX-License-Identifier: Apache-2.0
// Wave D (#1042): native-toolchain E2E — prove each library fixture is a real
// project by running its own test runner in a staged tmpdir copy.
// Guard: set VITEST_NATIVE=1 to run. Skipped in PR-fast tier (T1) — covered
// nightly (T4). See docs/SYSTEM/E2E-RUNTIMES.md for tier policy.
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { stageFixture } from '../helpers.js'

const NATIVE = process.env.VITEST_NATIVE === '1'

interface StackDef {
  fixture: string
  cmds: string[][]
}

const STACKS: StackDef[] = [
  {
    fixture: 'ts-library',
    cmds: [
      ['npm', 'ci', '--no-audit', '--no-fund'],
      ['npm', 'test'],
    ],
  },
  {
    fixture: 'python-library',
    cmds: [['pip', 'install', '-e', '.[test]'], ['pytest']],
  },
  {
    fixture: 'go-library',
    cmds: [['go', 'test', './...']],
  },
  {
    fixture: 'java-library-gradle',
    cmds: [['./gradlew', 'test', '--no-daemon']],
  },
  {
    fixture: 'rust-library',
    cmds: [['cargo', 'test', '--frozen']],
  },
]

describe.skipIf(!NATIVE)('native — toolchain smoke tests', () => {
  const staged: string[] = []

  afterEach(() => {
    for (const d of staged.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  for (const { fixture, cmds } of STACKS) {
    it(`${fixture} — native runner exits 0`, { timeout: 300_000 }, () => {
      const dir = stageFixture(fixture)
      staged.push(dir)
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
      }
    })
  }
})
