// SPDX-License-Identifier: Apache-2.0
// TDD regression test for #2436 AC-1: `.stryker-tmp/` — the scratch sandbox an
// interrupted Stryker mutation-testing run leaves behind — must be ignored by the
// format gate, so a badly formatted file left there can never turn `prettier
// --check .` red again.
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
/** Resolve prettier binary path relative to the worktree, not the sandbox. */
const PRETTIER_BIN = join(root, 'node_modules', '.bin', 'prettier')
const SANDBOX_REL = join('.stryker-tmp', 'regression-2436')
const SANDBOX_ABS = join(root, SANDBOX_REL)

function prettierCheck(target: string): { status: number; output: string } {
  const result = spawnSync(PRETTIER_BIN, ['--check', target], { cwd: root, encoding: 'utf-8' })
  return { status: result.status ?? 1, output: (result.stdout ?? '') + (result.stderr ?? '') }
}

afterEach(() => {
  // Clean up only this test's own sandbox subdirectory — never the wider
  // .stryker-tmp/ tree, which may hold another (real) mutation run's state.
  rmSync(SANDBOX_ABS, { recursive: true, force: true })
})

describe('format gate ignores .stryker-tmp/ (#2436 AC-1)', () => {
  it('prettier --check stays green for a badly formatted file under .stryker-tmp/', () => {
    mkdirSync(join(SANDBOX_ABS, 'sandbox-ZAPOFG', 'examples', 'go-library'), { recursive: true })
    writeFileSync(
      join(SANDBOX_ABS, 'sandbox-ZAPOFG', 'examples', 'go-library', 'AGENTS.md'),
      '#    Badly   Formatted\n\n*  item one\n*    item two\n',
    )

    const { status, output } = prettierCheck(SANDBOX_REL)
    expect(status, `expected prettier --check to ignore ${SANDBOX_REL}, got:\n${output}`).toBe(0)
  })
})
