// SPDX-License-Identifier: Apache-2.0
// Regression for a virgin `arbiter init -y` run: the scaffolded project has a
// tsconfig.json (and a generated test importing vitest) but `npm install` has
// not run yet, so node_modules does not exist. Before the fix, the tsc:noEmit
// build probe reported `status: 'failed'` (npx bootstrap noise or "cannot find
// module 'vitest'" — neither is a real TypeScript error in the user's code),
// which made `runToolchainVerify` abort `arbiter init` with a misleading hint
// ("Fix TypeScript errors or install: npm install --save-dev typescript" — the
// package is already a declared devDependency; the actual fix is `npm install`).
//
// Uses a REAL temp directory (unmocked `existsSync`) so the node_modules-missing
// branch in runBuildProbe is exercised exactly as `arbiter init` exercises it —
// only `runCli` (the node/npm version probes) is mocked, to stay hermetic.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {},
}))

import { runCli } from '../../src/utils/run-cli.js'
import { runProbes } from '../../src/compatibility/probe.js'

const mockRunCli = runCli as MockInstance

describe('runProbes — virgin `arbiter init -y` (node_modules not yet installed)', () => {
  let dir: string

  beforeEach(() => {
    vi.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'arbiter-virgin-init-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'virgin-test' }))
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    // Deliberately NO node_modules directory.
    mockRunCli.mockImplementation((cmd: string) => {
      if (cmd === 'node') return { stdout: 'v22.0.0', stderr: '', exitCode: 0, durationMs: 5 }
      if (cmd === 'npm') return { stdout: '10.0.0', stderr: '', exitCode: 0, durationMs: 5 }
      throw new Error(`unexpected runCli invocation in this test: ${cmd}`)
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects typescript stack from the bare package.json', () => {
    const report = runProbes(dir)
    expect(report.stack).toBe('typescript')
  })

  it('skips (not fails) the tsc:noEmit build probe, and never shells out to npx', () => {
    const report = runProbes(dir)
    const tscProbe = report.probes.find((p) => p.tool === 'tsc:noEmit')
    expect(tscProbe?.status).toBe('skipped')
    expect(tscProbe?.reason).toBe(
      'node-modules-missing: run `npm install`, then `arbiter validate` to verify',
    )
    expect(mockRunCli).not.toHaveBeenCalledWith('npx', expect.anything(), expect.anything())
  })

  it('does NOT abort verification (hasFailures=false) — `arbiter init` must complete', () => {
    const report = runProbes(dir)
    expect(report.hasFailures).toBe(false)
  })
})
