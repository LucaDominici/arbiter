// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit as runInitCommand } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { loadConfig, writeSnapshot } from '../../src/utils/config.js'
import { ConfigError } from '../../src/utils/errors.js'

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

function runInit(options: Parameters<typeof runInitCommand>[0]) {
  return runInitCommand({ ...options, language: 'typescript' })
}

async function captureRejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }
  return undefined
}

describe('#2195: update fails closed for an invalid persisted governance level', () => {
  let dir: string
  let configPath: string
  let snapshotPath: string
  let configBefore: Buffer
  let snapshotBefore: Buffer
  let updateError: unknown

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2195-invalid-level-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L4', dir, noVerify: true })

    // Init persists only arbiter.json; establish the valid existing snapshot
    // that the update under test must leave untouched.
    const initializedConfig = loadConfig(dir)
    if (!initializedConfig) throw new Error('init did not persist arbiter.json')
    writeSnapshot(dir, initializedConfig)

    configPath = join(dir, 'arbiter.json')
    snapshotPath = join(dir, '.arbiter-generated.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    config.governanceLevel = 42
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')

    configBefore = readFileSync(configPath)
    snapshotBefore = readFileSync(snapshotPath)
    updateError = await captureRejection(() => runUpdate({ dir, github: false }))
  }, 180000)

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  }, 180000)

  it('rejects before rewriting either config source of truth', () => {
    expect
      .soft(
        updateError,
        'runUpdate rejects numeric governanceLevel with ConfigError E_CONFIG_INVALID',
      )
      .toBeInstanceOf(ConfigError)
    expect
      .soft(
        updateError instanceof ConfigError ? updateError.code : undefined,
        'rejection uses E_CONFIG_INVALID',
      )
      .toBe('E_CONFIG_INVALID')
    expect
      .soft(readFileSync(configPath), 'arbiter.json remains byte-identical')
      .toEqual(configBefore)
    expect
      .soft(
        JSON.parse(readFileSync(configPath, 'utf-8')) as { governanceLevel: unknown },
        'arbiter.json still preserves numeric governanceLevel 42',
      )
      .toMatchObject({ governanceLevel: 42 })
    expect
      .soft(readFileSync(snapshotPath), '.arbiter-generated.json remains byte-identical')
      .toEqual(snapshotBefore)
  })
})
