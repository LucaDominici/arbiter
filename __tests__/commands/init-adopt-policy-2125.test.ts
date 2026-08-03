// SPDX-License-Identifier: Apache-2.0
// #2125: a governed re-init must use update's adoption policy without silently
// discarding the prior local content.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit as runInitCommand } from '../../src/commands/init.js'

const GOVERNANCE_FILE = 'AGENTS.md'
const SAFETY_FILE = '.claude/hooks/stop-dangerous.mjs'
const NON_ADOPTED_FILE = 'scripts/check-collab-mode-wired.mjs'

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

async function runInit(dir: string): Promise<void> {
  await runInitCommand({
    yes: true,
    tools: 'claude',
    level: 'L2',
    language: 'typescript',
    dir,
    noVerify: true,
  })
}

describe('#2125 init adopts the same force-rendered classes as update', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2125-init-adopt-'))
    initGit(dir)
    await runInit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('adopts governance and safety files with reversible records, while preserving non-adopted and explicitly preserved files', async () => {
    const governancePrior = '# hand-written\n'
    const safetyPrior = '// locally patched safety hook\n'
    const nonAdoptedPrior = '// locally patched ordinary generated file\n'
    const governancePath = join(dir, GOVERNANCE_FILE)
    const safetyPath = join(dir, SAFETY_FILE)
    const nonAdoptedPath = join(dir, NON_ADOPTED_FILE)

    expect(existsSync(governancePath)).toBe(true)
    expect(existsSync(safetyPath)).toBe(true)
    expect(existsSync(nonAdoptedPath)).toBe(true)
    writeFileSync(governancePath, governancePrior)
    writeFileSync(safetyPath, safetyPrior)
    writeFileSync(nonAdoptedPath, nonAdoptedPrior)

    await runInit(dir)

    const governanceAfter = readFileSync(governancePath, 'utf-8')
    const safetyAfter = readFileSync(safetyPath, 'utf-8')
    expect(governanceAfter).not.toBe(governancePrior)
    expect(safetyAfter).not.toBe(safetyPrior)
    expect(readFileSync(nonAdoptedPath, 'utf-8')).toBe(nonAdoptedPrior)

    const overridesDir = join(dir, '.arbiter/evidence/local-overrides')
    const records = readdirSync(overridesDir).map(
      (file) =>
        JSON.parse(readFileSync(join(overridesDir, file), 'utf-8')) as {
          path: string
          priorContent: string
          newContent: string
        },
    )
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: GOVERNANCE_FILE,
          priorContent: governancePrior,
          newContent: governanceAfter,
        }),
        expect.objectContaining({
          path: SAFETY_FILE,
          priorContent: safetyPrior,
          newContent: safetyAfter,
        }),
      ]),
    )

    const preservePrior = '// arbiter:preserve\n# hand-written and deliberately frozen\n'
    writeFileSync(governancePath, preservePrior)
    await runInit(dir)
    expect(readFileSync(governancePath, 'utf-8')).toBe(preservePrior)
  })
})
