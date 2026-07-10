// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3): `--preset` must be a self-sufficient non-interactive fast path.
// Before this fix, resolveConfig's interactive/non-interactive branch only checked
// `options.yes || recipe !== undefined` — a bare `--preset industrial-grade` (no
// `--yes`) still fell through to the interactive wizard, forcing users to pass both
// flags to get a one-shot preset init. `runWizard` is mocked to throw so the test
// fails loudly (red) if the interactive path is ever entered for a preset-only call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/wizard/prompts.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/wizard/prompts.js')>(
    '../../src/wizard/prompts.js',
  )
  return {
    ...actual,
    runWizard: vi.fn(() => {
      throw new Error('runWizard must not be called when --preset is provided without --yes')
    }),
  }
})

import { runWizard } from '../../src/wizard/prompts.js'
import { runInit } from '../../src/commands/init.js'

const mockRunWizard = vi.mocked(runWizard)

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbiter-init-preset-fast-path-'))
  vi.clearAllMocks()
  // Silence dry-run preview stdout noise (not asserted on).
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      scripts: { build: 'tsc', test: 'vitest run', lint: 'eslint .' },
      devDependencies: { typescript: '^5.0.0', eslint: '^9.0.0', prettier: '^3.0.0' },
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('runInit — --preset fast path (no --yes required)', () => {
  it('takes the non-interactive path for --preset industrial-grade alone', async () => {
    await runInit({
      tools: 'claude',
      level: undefined,
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      preset: 'industrial-grade',
    })
    expect(mockRunWizard).not.toHaveBeenCalled()
  })

  it('takes the non-interactive path for --preset solo-homelab alone', async () => {
    await runInit({
      tools: 'claude',
      level: undefined,
      dir,
      dryRun: true,
      brownfield: false,
      noVerify: true,
      quiet: true,
      preset: 'solo-homelab',
    })
    expect(mockRunWizard).not.toHaveBeenCalled()
  })

  it('still uses the interactive wizard when no --yes/--recipe/--preset is given', async () => {
    await expect(
      runInit({
        tools: 'claude',
        level: undefined,
        dir,
        dryRun: true,
        brownfield: false,
        noVerify: true,
        quiet: true,
      }),
    ).rejects.toThrow('runWizard must not be called')
    expect(mockRunWizard).toHaveBeenCalledTimes(1)
  })
})
