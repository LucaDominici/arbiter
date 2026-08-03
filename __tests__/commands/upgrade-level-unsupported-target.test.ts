// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runUpgradeLevel } from '../../src/commands/upgrade-level.js'
import { ArbiterError } from '../../src/utils/errors.js'
import { loadConfig } from '../../src/utils/config.js'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function writeArbiterConfig(dir: string, governanceLevel: 'L1' | 'L2'): void {
  writeFileSync(
    join(dir, 'arbiter.json'),
    JSON.stringify(
      {
        version: '0.1',
        tools: ['claude'],
        governanceLevel,
        useGitHub: false,
        archetype: 'library',
        architectureStyle: 'none',
        isMultiTenant: false,
        hasDatabase: false,
        hasPublicApi: false,
      },
      null,
      2,
    ) + '\n',
  )
}

function spawn(args: string[], cwd: string): { stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], { cwd, encoding: 'utf-8', timeout: 30_000 })
  return { stderr: result.stderr ?? '', status: result.status ?? 1 }
}

describe('runUpgradeLevel unsupported grace transitions (#2201)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upgrade-level-unsupported-'))
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects L2→L3 with E_GRACE_NOT_SUPPORTED and leaves arbiter.json byte-identical', async () => {
    writeArbiterConfig(dir, 'L2')
    const configPath = join(dir, 'arbiter.json')
    const before = readFileSync(configPath, 'utf-8')

    const error = await runUpgradeLevel({ dir, target: 'L3' }).then(
      () => undefined,
      (reason: unknown) => reason,
    )

    expect.soft(error).toBeInstanceOf(ArbiterError)
    expect.soft(error).toMatchObject({
      code: 'E_GRACE_NOT_SUPPORTED',
    })
    expect.soft(readFileSync(configPath, 'utf-8')).toBe(before)
  })

  it('rejects L1→L3 with E_GRACE_NOT_SUPPORTED and leaves arbiter.json byte-identical', async () => {
    writeArbiterConfig(dir, 'L1')
    const configPath = join(dir, 'arbiter.json')
    const before = readFileSync(configPath, 'utf-8')

    const error = await runUpgradeLevel({ dir, target: 'L3' }).then(
      () => undefined,
      (reason: unknown) => reason,
    )

    expect.soft(error).toBeInstanceOf(ArbiterError)
    expect.soft(error).toMatchObject({
      code: 'E_GRACE_NOT_SUPPORTED',
    })
    expect.soft(readFileSync(configPath, 'utf-8')).toBe(before)
  })

  it('emits a JSON error envelope without grace fields for an unsupported L3 target', async () => {
    writeArbiterConfig(dir, 'L1')
    let written = ''
    vi.mocked(process.stdout.write).mockImplementation((chunk: string | Uint8Array) => {
      written += String(chunk)
      return true
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    try {
      await runUpgradeLevel({ dir, target: 'L3', json: true })
    } catch {
      // The JSON command path terminates after writing its envelope.
    }

    const parsed = JSON.parse(written) as { data: Record<string, unknown>; status: string }
    expect.soft(parsed.status).toBe('error')
    expect.soft(exitSpy).toHaveBeenCalledWith(1)
    expect.soft(parsed.data).not.toHaveProperty('graceEndsAt')
    expect.soft(parsed.data).not.toHaveProperty('graceDays')
    expect.soft(written).not.toMatch(/^\s*(?:Error|ArbiterError|at )/m)
  })

  it('continues to support L1→L2 with a 14-day grace window', async () => {
    writeArbiterConfig(dir, 'L1')
    let written = ''
    vi.mocked(process.stdout.write).mockImplementation((chunk: string | Uint8Array) => {
      written += String(chunk)
      return true
    })
    const before = Date.now()

    await runUpgradeLevel({ dir, target: 'L2', days: 14, json: true })

    const saved = loadConfig(dir)
    expect(saved?.governanceLevel).toBe('L2')
    expect(saved?.graceFromLevel).toBe('L1')
    expect(saved?.graceEndsAt).toBeDefined()
    const graceEndsAt = Date.parse(saved!.graceEndsAt!)
    expect(graceEndsAt).toBeGreaterThanOrEqual(before + 14 * 86400000 - 5000)
    expect(graceEndsAt).toBeLessThanOrEqual(Date.now() + 14 * 86400000 + 5000)

    const output = JSON.parse(written) as { data: { graceDays: number }; status: string }
    expect(output.status).toBe('ok')
    expect(output.data.graceDays).toBe(14)
  })
})

describe('upgrade-level target contract (#2201)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upgrade-level-target-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects --target L4 because the accepted target set is exactly L2 and L3', () => {
    const result = spawn(['upgrade-level', '--target', 'L4', '--dir', dir], dir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid --target "L4". Valid values: L2, L3.')
  })
}, 60_000)
