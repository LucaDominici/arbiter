// SPDX-License-Identifier: Apache-2.0
// #1122: `arbiter tui` umbrella menu — routes to interactive command surfaces.

import { describe, it, expect, vi, afterEach } from 'vitest'

const selectMock = vi.fn()
const introMock = vi.fn()
const outroMock = vi.fn()
const cancelMock = vi.fn()

vi.mock('@clack/prompts', () => ({
  intro: (...a: unknown[]) => introMock(...a),
  outro: (...a: unknown[]) => outroMock(...a),
  cancel: (...a: unknown[]) => cancelMock(...a),
  select: (...a: unknown[]) => selectMock(...a),
  isCancel: (v: unknown) => typeof v === 'symbol',
}))

const runSettingsMock = vi.fn()
vi.mock('../../src/commands/settings.js', () => ({
  runSettings: (...a: unknown[]) => runSettingsMock(...a),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('runTui (#1122)', () => {
  it('exits the loop when the user selects Exit', async () => {
    selectMock.mockResolvedValueOnce('exit')
    const { runTui } = await import('../../src/commands/tui.js')
    await runTui({ dir: '/tmp/x' })
    expect(introMock).toHaveBeenCalledOnce()
    expect(outroMock).toHaveBeenCalledOnce()
    expect(selectMock).toHaveBeenCalledOnce()
  })

  it('routes to settings then returns to the menu before exiting', async () => {
    selectMock.mockResolvedValueOnce('settings').mockResolvedValueOnce('exit')
    const { runTui } = await import('../../src/commands/tui.js')
    await runTui({ dir: '/tmp/x' })
    expect(runSettingsMock).toHaveBeenCalledWith({ dir: '/tmp/x' })
    expect(selectMock).toHaveBeenCalledTimes(2)
    expect(outroMock).toHaveBeenCalledOnce()
  })

  it('cancels cleanly when the prompt is dismissed (Escape/^C)', async () => {
    selectMock.mockResolvedValueOnce(Symbol('cancel'))
    const { runTui } = await import('../../src/commands/tui.js')
    await runTui()
    expect(cancelMock).toHaveBeenCalledOnce()
    expect(outroMock).not.toHaveBeenCalled()
  })
})
