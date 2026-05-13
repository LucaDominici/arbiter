import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    exitCode: number
    constructor(msg: string, exitCode: number) {
      super(msg)
      this.exitCode = exitCode
    }
  },
}))

const mockRunCli = vi.mocked(runCliModule.runCli)

describe('branchFullyMerged', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetAllMocks()
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a stderr warning when git fetch fails, then proceeds', async () => {
    const { branchFullyMerged } = await import('../../src/worktree/validate.js')
    const { CliError } = await import('../../src/utils/run-cli.js')

    mockRunCli
      .mockImplementationOnce(() => {
        throw new Error('network unreachable')
      })
      // merge-base --is-ancestor succeeds (branch is merged)
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0 })

    const result = branchFullyMerged('task/123', 'main', '/repo', true)

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('git fetch failed'))
    expect(result).toBe(true)
    void CliError // imported for type completeness
  })

  it('does not emit a fetch warning when fetchFirst is false', async () => {
    const { branchFullyMerged } = await import('../../src/worktree/validate.js')
    mockRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 })

    branchFullyMerged('task/123', 'main', '/repo', false)

    const fetchWarnings = (stderrSpy.mock.calls as unknown[][])
      .flat()
      .filter((a) => typeof a === 'string' && a.includes('git fetch failed'))
    expect(fetchWarnings).toHaveLength(0)
  })
})
