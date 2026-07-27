// SPDX-License-Identifier: Apache-2.0
// TDD guard for #1082 — ff-only merge enforcement (INV-101, ADR-052).
// Tests: two-call split (PUT branch protection + PATCH repo settings), correct payloads,
// aggregated result, partial failure.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return {
    ...actual,
    runCli: vi.fn(),
  }
})

const mockRunCli = vi.mocked(runCliModule.runCli)

beforeEach(() => {
  vi.resetAllMocks()
  mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })
})

describe('applyBranchProtection (#1082, INV-101)', () => {
  it('fires PUT branch-protection AND PATCH repo-settings for trunk-solo', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    const result = applyBranchProtection('myorg', 'myrepo', 'trunk-solo')
    expect(result.applied).toBe(true)
    expect(result.error).toBeNull()
    expect(mockRunCli).toHaveBeenCalledTimes(2)

    const putCall = mockRunCli.mock.calls.find((c) =>
      c[1].includes(`repos/myorg/myrepo/branches/main/protection`),
    )
    expect(putCall, 'PUT branch-protection call must exist').toBeDefined()
    expect(putCall?.[1]).toContain('--method')
    expect(putCall?.[1]).toContain('PUT')

    const patchCall = mockRunCli.mock.calls.find(
      (c) => c[1].includes(`repos/myorg/myrepo`) && c[1].includes('PATCH'),
    )
    expect(patchCall, 'PATCH repo-settings call must exist').toBeDefined()
  })

  it('PATCH payload has allow_merge_commit:true, allow_squash_merge:false, allow_rebase_merge:false', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    applyBranchProtection('o', 'r', 'peer-review')

    const patchCall = mockRunCli.mock.calls.find(
      (c) => (c[1] as string[]).includes('PATCH') && (c[1] as string[]).includes('repos/o/r'),
    )
    expect(patchCall).toBeDefined()
    const input = patchCall?.[2]?.input as string
    const payload = JSON.parse(input) as Record<string, unknown>
    expect(payload.allow_merge_commit).toBe(true)
    expect(payload.allow_squash_merge).toBe(false)
    expect(payload.allow_rebase_merge).toBe(false)
  })

  it('PUT payload disables GitHub linear-history mode; exact SHA is enforced by CAS', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    for (const mode of ['trunk-solo', 'peer-review', 'gated-review'] as const) {
      vi.resetAllMocks()
      mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })
      applyBranchProtection('o', 'r', mode)

      const putCall = mockRunCli.mock.calls.find(
        (c) =>
          (c[1] as string[]).includes('PUT') &&
          (c[1] as string[]).includes('repos/o/r/branches/main/protection'),
      )
      expect(putCall, `PUT call missing for mode ${mode}`).toBeDefined()
      const input = putCall?.[2]?.input as string
      const payload = JSON.parse(input) as Record<string, unknown>
      expect(payload.required_linear_history, `required_linear_history wrong for ${mode}`).toBe(
        false,
      )
    }
  })

  it('applied:true only when both calls succeed', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })
    const result = applyBranchProtection('o', 'r', 'peer-review')
    expect(result.applied).toBe(true)
    expect(result.repoSettingsApplied).toBe(true)
    expect(result.error).toBeNull()
    expect(result.repoSettingsError).toBeNull()
  })

  it('partial failure: PUT succeeds, PATCH throws 403 → applied:false', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    let callCount = 0
    mockRunCli.mockImplementation(() => {
      callCount++
      if (callCount === 2) throw new Error('HTTP 403 Forbidden')
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    const result = applyBranchProtection('o', 'r', 'peer-review')
    expect(result.applied).toBe(false)
    expect(result.repoSettingsApplied).toBe(false)
    expect(result.repoSettingsError).toContain('403')
    expect(result.error).toBeNull()
  })

  it('partial failure: PUT throws 422, PATCH still runs and succeeds → applied:false, repoSettingsApplied:true', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    let callCount = 0
    mockRunCli.mockImplementation(() => {
      callCount++
      if (callCount === 1) throw new Error('HTTP 422 Unprocessable Entity')
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    const result = applyBranchProtection('o', 'r', 'peer-review')
    expect(result.applied).toBe(false)
    expect(result.error).toContain('422')
    expect(result.repoSettingsApplied).toBe(true)
    expect(result.repoSettingsError).toBeNull()
  })

  it('both fail: PUT throws 503, PATCH throws 503 → applied:false, both errors set', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    mockRunCli.mockImplementation(() => {
      throw new Error('HTTP 503 Service Unavailable')
    })

    const result = applyBranchProtection('o', 'r', 'peer-review')
    expect(result.applied).toBe(false)
    expect(result.error).toContain('503')
    expect(result.repoSettingsApplied).toBe(false)
    expect(result.repoSettingsError).toContain('503')
  })

  it('result interface exposes repoSettingsApplied and repoSettingsError', async () => {
    const { applyBranchProtection } = await import('../../src/github/branch-protection.js')
    const result = applyBranchProtection('o', 'r', 'trunk-solo')
    expect('repoSettingsApplied' in result).toBe(true)
    expect('repoSettingsError' in result).toBe(true)
  })
})
