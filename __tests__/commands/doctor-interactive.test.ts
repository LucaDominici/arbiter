// SPDX-License-Identifier: Apache-2.0
// #1168 Phase 3: arbiter doctor --interactive guided health-check + repair.

import { describe, it, expect, vi, afterEach } from 'vitest'

const confirm = vi.fn()
const cancel = vi.fn()
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: (...a: unknown[]) => cancel(...a),
  confirm: (...a: unknown[]) => confirm(...a),
  isCancel: (v: unknown) => typeof v === 'symbol',
}))

const runDoctorHealth = vi.fn()
vi.mock('../../src/commands/doctor.js', () => ({
  runDoctorHealth: (...a: unknown[]) => runDoctorHealth(...a),
}))

afterEach(() => vi.clearAllMocks())

const FAIL_LOCK = {
  exitCode: 1,
  checks: [{ id: 'lock', label: 'stale lock', status: 'FAIL', detail: 'stale .arbiter/.lock' }],
}
const HEALTHY = { exitCode: 0, checks: [{ id: 'x', label: 'ok', status: 'PASS', detail: '' }] }

describe('runInteractiveDoctor (#1168)', () => {
  it('offers repair on a fixable (lock) issue and re-runs with repair=true when accepted', async () => {
    runDoctorHealth
      .mockResolvedValueOnce(FAIL_LOCK)
      .mockResolvedValueOnce({ exitCode: 0, checks: [] })
    confirm.mockResolvedValueOnce(true)
    const { runInteractiveDoctor } = await import('../../src/commands/doctor-interactive.js')
    await runInteractiveDoctor({ dir: '/tmp/x' })
    expect(runDoctorHealth).toHaveBeenNthCalledWith(1, expect.objectContaining({ repair: false }))
    expect(runDoctorHealth).toHaveBeenNthCalledWith(2, expect.objectContaining({ repair: true }))
  })

  it('does not prompt or repair when the project is healthy', async () => {
    runDoctorHealth.mockResolvedValueOnce(HEALTHY)
    const { runInteractiveDoctor } = await import('../../src/commands/doctor-interactive.js')
    await runInteractiveDoctor()
    expect(confirm).not.toHaveBeenCalled()
    expect(runDoctorHealth).toHaveBeenCalledOnce()
  })

  it('does not repair when the user declines', async () => {
    runDoctorHealth.mockResolvedValueOnce(FAIL_LOCK)
    confirm.mockResolvedValueOnce(false)
    const { runInteractiveDoctor } = await import('../../src/commands/doctor-interactive.js')
    await runInteractiveDoctor()
    expect(runDoctorHealth).toHaveBeenCalledOnce()
  })
})
