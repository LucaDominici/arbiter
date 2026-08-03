// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../../src/commands/init.js'

function createGoFixture(brownfield: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-init-brownfield-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'go.mod'), 'module example.com/fixture\n\ngo 1.24\n')
  writeFileSync(join(dir, 'main.go'), 'package main\n\nfunc main() {}\n')

  if (brownfield) {
    writeFileSync(join(dir, 'main_test.go'), 'package main\n')
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
    writeFileSync(join(dir, '.golangci.yml'), 'version: "2"\n')
  }

  return dir
}

async function captureInitOutput(dir: string, brownfield: boolean): Promise<string> {
  let output = ''
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    output += String(chunk)
    return true
  })

  try {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L1',
      dir,
      dryRun: false,
      brownfield,
      noVerify: true,
      quiet: true,
      force: brownfield,
      force: brownfield,
    })
  } finally {
    stdoutSpy.mockRestore()
  }

  return output
}

describe('runInit brownfield detection (#2134)', () => {
  const dirs: string[] = []

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('proposes baseline capture before Done! for a detected brownfield repository', async () => {
    const dir = createGoFixture(true)
    dirs.push(dir)

    const output = await captureInitOutput(dir, false)
    const proposal = output.indexOf('Existing project detected (tests, CI workflows, lint config).')
    const done = output.indexOf('Done!')

    expect(proposal).toBeGreaterThanOrEqual(0)
    expect(done).toBeGreaterThan(proposal)
    expect(output).toContain('re-run with --brownfield')
    expect(output).toContain('node scripts/capture-debt-baseline.mjs')
  })

  it('does not propose brownfield capture for a bare synthetic fixture', async () => {
    const dir = createGoFixture(false)
    dirs.push(dir)

    const output = await captureInitOutput(dir, false)

    expect(output).not.toContain('Existing project detected')
  })

  it('does not duplicate the proposal when --brownfield is explicit', async () => {
    const dir = createGoFixture(true)
    dirs.push(dir)

    const output = await captureInitOutput(dir, true)

    expect(output).not.toContain('Existing project detected')
  })
})
