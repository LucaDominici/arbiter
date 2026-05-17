// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}))

import inquirer from 'inquirer'
const mockPrompt = vi.mocked(inquirer.prompt)

import { confirmChannelDowngrade } from '../../src/utils/confirm-downgrade.js'

describe('confirmChannelDowngrade (#662)', () => {
  const origEnv = process.env['ARBITER_ALLOW_CHANNEL_DOWNGRADE']
  const origIsTTY = process.stdin.isTTY
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['ARBITER_ALLOW_CHANNEL_DOWNGRADE']
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`exit:${_code}`)
    })
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    if (origEnv !== undefined) process.env['ARBITER_ALLOW_CHANNEL_DOWNGRADE'] = origEnv
    else delete process.env['ARBITER_ALLOW_CHANNEL_DOWNGRADE']
    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true })
    exitSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  function setTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true })
  }

  // ── no-warn cases (matrix cells that should NOT trigger) ──────────────────

  it('no-op when no flag', async () => {
    await expect(confirmChannelDowngrade(undefined, 'latest')).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('no-op when no config channel (flag=beta, config=undefined)', async () => {
    await expect(confirmChannelDowngrade('beta', undefined)).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('no-op when flag equals config (beta→beta)', async () => {
    await expect(confirmChannelDowngrade('beta', 'beta')).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('no-op when flag is more stable than config (latest→canary = upgrade, not downgrade)', async () => {
    // flag=latest, config=canary → flag is MORE stable = upgrade, not downgrade
    await expect(confirmChannelDowngrade('latest', 'canary')).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  // ── ARBITER_ALLOW_CHANNEL_DOWNGRADE=1 bypass ──────────────────────────────

  it('bypasses non-TTY exit when env escape hatch set', async () => {
    setTTY(false)
    process.env['ARBITER_ALLOW_CHANNEL_DOWNGRADE'] = '1'
    await expect(confirmChannelDowngrade('canary', 'latest')).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  // ── non-TTY downgrade cases ───────────────────────────────────────────────

  it('exits 1 in non-TTY when flag is less stable than config (latest→canary)', async () => {
    setTTY(false)
    await expect(confirmChannelDowngrade('canary', 'latest')).rejects.toThrow('exit:1')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[arbiter] error:'))
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('ARBITER_ALLOW_CHANNEL_DOWNGRADE=1'),
    )
  })

  it('exits 1 in non-TTY for beta→canary downgrade', async () => {
    setTTY(false)
    await expect(confirmChannelDowngrade('canary', 'beta')).rejects.toThrow('exit:1')
  })

  it('exits 1 in non-TTY for latest→beta downgrade', async () => {
    setTTY(false)
    await expect(confirmChannelDowngrade('beta', 'latest')).rejects.toThrow('exit:1')
  })

  // ── TTY + user confirms ───────────────────────────────────────────────────

  it('resolves when TTY and user confirms', async () => {
    setTTY(true)
    mockPrompt.mockResolvedValue({ confirmed: true })
    await expect(confirmChannelDowngrade('canary', 'latest')).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  // ── TTY + user declines ───────────────────────────────────────────────────

  it('exits 1 when TTY and user declines', async () => {
    setTTY(true)
    mockPrompt.mockResolvedValue({ confirmed: false })
    await expect(confirmChannelDowngrade('canary', 'latest')).rejects.toThrow('exit:1')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('cancelled'))
  })

  it('prompt uses default:false (does not silently accept)', async () => {
    setTTY(true)
    mockPrompt.mockResolvedValue({ confirmed: true })
    await confirmChannelDowngrade('canary', 'latest')
    const callArgs = mockPrompt.mock.calls[0]?.[0] as Array<{ default?: boolean }>
    expect(callArgs[0]?.default).toBe(false)
  })
})
