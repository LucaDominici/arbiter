// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/decomposition/github-backend.ts.
// Targets the branches the happy-path suite leaves uncovered:
//   - repoCoords() falling back to `gh repo view` (no configured owner/repo),
//     including the split-with-missing-parts `?? ''` guards.
//   - mapIssue() with and without a body, and label mapping.
//   - get(): CliError that is notFound or timedOut (reject), and a non-Error
//     throw value funnelled through `new Error(String(err))`.
//   - create(): body/labels argument pushes, the `match[1] === undefined`
//     malformed-URL guard, and every optional field-copy branch
//     (phase / parent / body / labels).
//   - list(): the no-filter path (no `--state` appended).
//   - close(): with and without `opts.reason`.
//   - statusToGhState via the list filter for the unsupported branch.
//
// The run-cli module is stubbed module-wide so no real `gh` binary is ever
// spawned (deterministic, fast, no network).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ArbiterConfigV2 } from '../../src/config/schema.js'

vi.mock('../../src/utils/run-cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/run-cli.js')>()
  return {
    ...actual,
    runCli: vi.fn(),
    runCliJson: vi.fn(),
  }
})

import { runCli, runCliJson, CliError } from '../../src/utils/run-cli.js'
import { GitHubBackend } from '../../src/decomposition/github-backend.js'
import type { RunCliResult } from '../../src/utils/run-cli.js'

const mockRunCli = vi.mocked(runCli)
const mockRunCliJson = vi.mocked(runCliJson)

/** Build a complete, valid ArbiterConfigV2. `github` coords are optional so
 *  callers can exercise the configured vs. auto-detected repoCoords() paths. */
function makeConfig(github?: { owner: string; repo: string }): ArbiterConfigV2 {
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: true,
    decomposition: {
      backend: 'github',
      ...(github ? { github } : {}),
    },
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: false,
      evidenceHarness: false,
      debtGates: false,
      suppressions: true,
    },
    thresholds: {
      lineCoverage: 80,
      branchCoverage: 70,
      mutationScore: 80,
      cyclomaticComplexity: 15,
      methodLength: 65,
      maxParams: 7,
    },
  }
}

/** A fully-formed RunCliResult so we never pass a partial literal to a typed fn. */
function cliOk(stdout: string): RunCliResult {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

function makeCliError(over: Partial<{ notFound: boolean; timedOut: boolean }>): CliError {
  return new CliError(
    {
      cmd: 'gh',
      args: ['issue', 'view'],
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: over.timedOut ?? false,
      notFound: over.notFound ?? false,
    },
    'boom',
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GitHubBackend branch coverage', () => {
  describe('repoCoords() auto-detection (no configured owner/repo)', () => {
    it('uses `gh repo view` nameWithOwner when coords are absent', async () => {
      // First call: repo view → coords. Second call: issue list → [].
      mockRunCliJson
        .mockReturnValueOnce({ nameWithOwner: 'auto-owner/auto-repo' })
        .mockReturnValueOnce([])

      const backend = new GitHubBackend(makeConfig())
      const units = await backend.list()

      expect(units).toEqual([])
      expect(mockRunCliJson).toHaveBeenNthCalledWith(
        1,
        'gh',
        expect.arrayContaining(['repo', 'view', '--json', 'nameWithOwner']),
        expect.anything(),
      )
      // repoFlag composed from the detected coords:
      expect(mockRunCliJson).toHaveBeenNthCalledWith(
        2,
        'gh',
        expect.arrayContaining(['-R', 'auto-owner/auto-repo']),
        expect.anything(),
      )
    })

    it('tolerates a nameWithOwner with no slash (missing repo → empty)', async () => {
      mockRunCliJson
        .mockReturnValueOnce({ nameWithOwner: 'lonely' })
        .mockReturnValueOnce([])

      const backend = new GitHubBackend(makeConfig())
      await backend.list()

      // owner='lonely', repo='' → flag 'lonely/'
      expect(mockRunCliJson).toHaveBeenNthCalledWith(
        2,
        'gh',
        expect.arrayContaining(['-R', 'lonely/']),
        expect.anything(),
      )
    })

    it('tolerates an empty nameWithOwner (both parts empty)', async () => {
      mockRunCliJson
        .mockReturnValueOnce({ nameWithOwner: '' })
        .mockReturnValueOnce([])

      const backend = new GitHubBackend(makeConfig())
      await backend.list()

      expect(mockRunCliJson).toHaveBeenNthCalledWith(
        2,
        'gh',
        expect.arrayContaining(['-R', '/']),
        expect.anything(),
      )
    })

    it('short-circuits `gh repo view` when both coords are configured', async () => {
      mockRunCliJson.mockReturnValueOnce([])
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.list()
      // Only ONE json call (no `gh repo view`):
      expect(mockRunCliJson).toHaveBeenCalledTimes(1)
      expect(mockRunCliJson).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['-R', 'o/r']),
        expect.anything(),
      )
    })
  })

  describe('list()', () => {
    it('omits --state when no filter is supplied', async () => {
      mockRunCliJson.mockReturnValue([])
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.list()
      const call = mockRunCliJson.mock.calls[0]
      const args = call[1] as readonly string[]
      expect(args).not.toContain('--state')
    })

    it('rejects an unsupported status filter (in_progress)', async () => {
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.list({ status: 'in_progress' })).rejects.toThrow(
        /does not support filtering by status/,
      )
    })

    it('rejects an unsupported status filter (blocked)', async () => {
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.list({ status: 'blocked' })).rejects.toThrow(
        /does not support filtering by status/,
      )
    })

    it('maps an issue whose body is null (no body assigned) and labels present', async () => {
      mockRunCliJson.mockReturnValue([
        { number: 9, title: 'T', state: 'OPEN', body: null, labels: [{ name: 'bug' }] },
      ])
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      const units = await backend.list()
      expect(units).toHaveLength(1)
      expect(units[0].body).toBeUndefined()
      expect(units[0].labels).toEqual(['bug'])
      expect(units[0].status).toBe('open')
    })
  })

  describe('get()', () => {
    it('rejects when the CliError is notFound (binary missing)', async () => {
      mockRunCliJson.mockImplementation(() => {
        throw makeCliError({ notFound: true })
      })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.get('#5')).rejects.toBeInstanceOf(CliError)
    })

    it('rejects when the CliError is timedOut (network failure)', async () => {
      mockRunCliJson.mockImplementation(() => {
        throw makeCliError({ timedOut: true })
      })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.get('#5')).rejects.toBeInstanceOf(CliError)
    })

    it('returns null when the CliError is a plain non-found, non-timeout error', async () => {
      mockRunCliJson.mockImplementation(() => {
        throw makeCliError({})
      })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.get('#404')).resolves.toBeNull()
    })

    it('wraps a non-Error throw value through new Error(String(err))', async () => {
      mockRunCliJson.mockImplementation(() => {
        throw 'string failure'
      })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.get('#7')).rejects.toThrow('string failure')
    })

    it('strips the leading # when computing the issue number', async () => {
      mockRunCliJson.mockReturnValue({
        number: 12,
        title: 'X',
        state: 'CLOSED',
        labels: [],
      })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      const unit = await backend.get('#12')
      expect(unit).not.toBeNull()
      expect(unit?.status).toBe('done')
      const args = mockRunCliJson.mock.calls[0][1] as readonly string[]
      expect(args).toContain('12')
      expect(args).not.toContain('#12')
    })

    it('handles an id without a leading # (stripHash else branch)', async () => {
      mockRunCliJson.mockReturnValue({ number: 3, title: 'Y', state: 'OPEN', labels: [] })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.get('3')
      const args = mockRunCliJson.mock.calls[0][1] as readonly string[]
      expect(args).toContain('3')
    })
  })

  describe('create()', () => {
    it('pushes --body and --label when provided and copies all optional fields', async () => {
      mockRunCli.mockReturnValue(cliOk('https://github.com/o/r/issues/77\n'))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      const unit = await backend.create({
        title: 'Full',
        status: 'open',
        body: 'the body',
        labels: ['a', 'b'],
        phase: 'plan',
        parent: '#1',
      })
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).toContain('--body')
      expect(args).toContain('the body')
      expect(args).toContain('--label')
      expect(args).toContain('a,b')
      expect(unit.id).toBe('#77')
      expect(unit.phase).toBe('plan')
      expect(unit.parent).toBe('#1')
      expect(unit.body).toBe('the body')
      expect(unit.labels).toEqual(['a', 'b'])
    })

    it('omits --body and --label when absent and copies no optional fields', async () => {
      mockRunCli.mockReturnValue(cliOk('https://github.com/o/r/issues/8\n'))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      const unit = await backend.create({ title: 'Bare', status: 'open' })
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).not.toContain('--body')
      expect(args).not.toContain('--label')
      expect(unit.id).toBe('#8')
      expect(unit.phase).toBeUndefined()
      expect(unit.parent).toBeUndefined()
      expect(unit.body).toBeUndefined()
      expect(unit.labels).toBeUndefined()
    })

    it('does not push --label when labels is an empty array', async () => {
      mockRunCli.mockReturnValue(cliOk('https://github.com/o/r/issues/9\n'))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      const unit = await backend.create({ title: 'NoLabels', status: 'open', labels: [] })
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).not.toContain('--label')
      // empty labels array is still copied to the returned unit:
      expect(unit.labels).toEqual([])
    })

    it('rejects when gh issue create returns output without an issue URL', async () => {
      mockRunCli.mockReturnValue(cliOk('totally unexpected\n'))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.create({ title: 'Bad', status: 'open' })).rejects.toThrow(
        /unexpected output/,
      )
    })
  })

  describe('advance()', () => {
    it('throws when the work unit does not exist', async () => {
      // get() returns null → existing falsy branch.
      mockRunCliJson.mockImplementation(() => {
        throw makeCliError({})
      })
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await expect(backend.advance('#5', 'red')).rejects.toThrow(/not found/)
    })

    it('adds the new phase label without --remove-label when there are no prior phase labels', async () => {
      mockRunCliJson.mockReturnValue({
        number: 5,
        title: 'T',
        state: 'OPEN',
        labels: [{ name: 'kind/bug' }], // non-phase label → filtered out
      })
      mockRunCli.mockReturnValue(cliOk(''))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.advance('#5', 'green')
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).toContain('--add-label')
      expect(args).toContain('phase/green')
      expect(args).not.toContain('--remove-label')
    })

    it('handles an issue with no labels array at all (?? [] fallback)', async () => {
      mockRunCliJson.mockReturnValue({ number: 6, title: 'T', state: 'OPEN', labels: [] })
      mockRunCli.mockReturnValue(cliOk(''))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.advance('#6', 'red')
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).not.toContain('--remove-label')
    })

    it('removes the prior phase label when one is present', async () => {
      mockRunCliJson.mockReturnValue({
        number: 7,
        title: 'T',
        state: 'OPEN',
        labels: [{ name: 'phase/plan' }],
      })
      mockRunCli.mockReturnValue(cliOk(''))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.advance('#7', 'red')
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).toContain('--remove-label')
      expect(args).toContain('phase/plan')
    })
  })

  describe('close()', () => {
    it('appends a --comment when a reason is supplied', async () => {
      mockRunCli.mockReturnValue(cliOk(''))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.close('#3', { reason: 'fixed it' })
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).toContain('--comment')
      expect(args).toContain('Closed: fixed it')
    })

    it('omits --comment when no opts are supplied', async () => {
      mockRunCli.mockReturnValue(cliOk(''))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.close('#3')
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).toContain('close')
      expect(args).not.toContain('--comment')
    })

    it('omits --comment when opts is present but reason is empty', async () => {
      mockRunCli.mockReturnValue(cliOk(''))
      const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
      await backend.close('#3', { reason: '' })
      const args = mockRunCli.mock.calls[0][1] as readonly string[]
      expect(args).not.toContain('--comment')
    })
  })

  it("exposes id 'github'", () => {
    const backend = new GitHubBackend(makeConfig({ owner: 'o', repo: 'r' }))
    expect(backend.id).toBe('github')
  })
})
