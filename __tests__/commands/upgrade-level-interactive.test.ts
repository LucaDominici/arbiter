// SPDX-License-Identifier: Apache-2.0
// #1168 Phase 3: arbiter upgrade-level --interactive guided flow.

import { describe, it, expect, vi, afterEach } from 'vitest'

const select = vi.fn()
const confirm = vi.fn()
const cancel = vi.fn()
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: (...a: unknown[]) => cancel(...a),
  select: (...a: unknown[]) => select(...a),
  confirm: (...a: unknown[]) => confirm(...a),
  isCancel: (v: unknown) => typeof v === 'symbol',
}))

const runUpgradeLevel = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/commands/upgrade-level.js', () => ({
  runUpgradeLevel: (...a: unknown[]) => runUpgradeLevel(...a),
}))

afterEach(() => vi.clearAllMocks())

describe('runInteractiveUpgradeLevel (#1168)', () => {
  it('delegates to runUpgradeLevel with the chosen target on confirm', async () => {
    select.mockResolvedValueOnce('L2')
    confirm.mockResolvedValueOnce(true)
    const { runInteractiveUpgradeLevel } =
      await import('../../src/commands/upgrade-level-interactive.js')
    await runInteractiveUpgradeLevel({ dir: '/tmp/x' })
    expect(runUpgradeLevel).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'L2', dir: '/tmp/x', extend: false, json: false }),
    )
  })

  it('does NOT upgrade when the target prompt is cancelled', async () => {
    select.mockResolvedValueOnce(Symbol('cancel'))
    const { runInteractiveUpgradeLevel } =
      await import('../../src/commands/upgrade-level-interactive.js')
    await runInteractiveUpgradeLevel()
    expect(runUpgradeLevel).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does NOT upgrade when the confirm is declined', async () => {
    select.mockResolvedValueOnce('L2')
    confirm.mockResolvedValueOnce(false)
    const { runInteractiveUpgradeLevel } =
      await import('../../src/commands/upgrade-level-interactive.js')
    await runInteractiveUpgradeLevel()
    expect(runUpgradeLevel).not.toHaveBeenCalled()
  })
})
