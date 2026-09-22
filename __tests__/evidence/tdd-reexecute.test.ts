// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DEFAULT_REEXEC_TIMEOUT_MS,
  verifyGreenExecution,
  verifyRedExecution,
} from '../../src/evidence/tdd-reexecute.js'
import type { TddEvidence } from '../../src/evidence/tdd.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    stdout = ''
    stderr = ''
    exitCode = 1
    timedOut = false
    notFound = false
    outputTruncated = false
    signal: NodeJS.Signals | null = null
  },
}))

import { runCli, CliError } from '../../src/utils/run-cli.js'
const mockedRunCli = vi.mocked(runCli)

/**
 * Build an instance of the MOCKED CliError above (a bare Error subclass with
 * writable stdout/stderr) carrying the child-process output under test. Typed
 * against the real class, whose ctor signature/readonly fields do not apply to
 * the mock at runtime — the casts below bridge that gap in one place.
 */
function cliError(
  fields: Partial<
    Pick<
      CliError,
      'stdout' | 'stderr' | 'exitCode' | 'timedOut' | 'notFound' | 'outputTruncated' | 'signal'
    >
  > = {},
): CliError {
  const MockedCtor = CliError as unknown as new () => CliError
  return Object.assign(new MockedCtor(), fields)
}

const BASE: TddEvidence = {
  $schemaVersion: 1,
  task_id: '#9001',
  test_path: 'math.test.ts',
  test_commit_sha: 'a'.repeat(40),
  test_run_log: 'FAIL math.test.ts\n1 test failed',
  observed_failure: 'FAIL math.test.ts',
  recorded_at: '2026-07-15T00:00:00.000Z',
  test_command: ['npx', 'vitest', 'run', 'math.test.ts'],
  test_blob_sha: createHash('sha1').update('blob 4\0test').digest('hex'),
}

describe('verifyRedExecution()', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when evidence has no test_command (legacy, pre-#1957)', () => {
    const { test_command, ...legacy } = BASE
    void test_command
    const result = verifyRedExecution(legacy, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/test_command/)
    expect(mockedRunCli).not.toHaveBeenCalled()
  })

  it('fails closed when test_command is an empty array', () => {
    const result = verifyRedExecution({ ...BASE, test_command: [] }, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/test_command/)
  })

  it.each(['../outside', '/tmp/outside', 'C:\\outside', 'frontend//src', ''])(
    'refuses replay outside a package-relative cwd: %s',
    (test_cwd) => {
      mockedRunCli.mockReturnValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
      const result = verifyRedExecution({ ...BASE, test_cwd }, '/repo')
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/test_cwd.*repository-relative/)
      expect(mockedRunCli.mock.calls.every(([command]) => command === 'git')).toBe(true)
    },
  )

  it('fails when the isolated worktree checkout fails', () => {
    mockedRunCli
      .mockReturnValueOnce({
        stdout: '',
        stderr: 'fatal: bad revision',
        exitCode: 128,
        durationMs: 5,
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/check out test_commit_sha/)
  })

  it('fails when the worktree add throws', () => {
    mockedRunCli
      .mockImplementationOnce(() => {
        throw cliError()
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/check out test_commit_sha/)
  })

  it('fails when the re-run at test_commit_sha did not reproduce any failure (the false-green case)', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockReturnValueOnce({
        stdout: 'All tests passed.\n5 tests',
        stderr: '',
        exitCode: 0,
        durationMs: 100,
      }) // test run
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not fail when re-run/)
    expect(result.reason).toMatch(/false-green risk/)
  })

  it('fails when the re-run failure does not match the recorded observed_failure', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'FAIL other.test.ts\n1 test failed' })
      }) // test run — non-zero exit throws
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not the recorded observed_failure/)
  })

  it('passes when the re-run reproduces the recorded observed_failure exactly', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
      }) // test run — genuinely red, non-zero exit
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })

  it('remaps a recorded checkout-local node_modules binary into the replay checkout (#2712)', () => {
    let replayCwd = ''
    mockedRunCli
      .mockImplementationOnce((_cmd, args) => {
        replayCwd = String((args as readonly string[])[4])
        mkdirSync(replayCwd, { recursive: true })
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      })
      .mockImplementationOnce((cmd) => {
        expect(cmd).toBe(join(replayCwd, 'node_modules', '.bin', 'vitest'))
        throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })

    const result = verifyRedExecution(
      {
        ...BASE,
        test_command: ['/recording/checkout/node_modules/.bin/vitest', 'run', 'math.test.ts'],
      },
      '/repo',
    )
    expect(result.ok).toBe(true)
  })

  it('replays monorepo evidence from its recorded package-relative cwd (#2801)', () => {
    let replayRoot = ''
    mockedRunCli
      .mockImplementationOnce((_cmd, args) => {
        replayRoot = String((args as readonly string[])[4])
        mkdirSync(join(replayRoot, 'frontend'), { recursive: true })
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      })
      .mockImplementationOnce((_cmd, args, opts) => {
        expect(args).toEqual(['vitest', 'run', 'src/ConfirmDialog.test.ts'])
        expect(opts).toEqual({
          cwd: join(replayRoot, 'frontend'),
          timeoutMs: DEFAULT_REEXEC_TIMEOUT_MS,
        })
        throw cliError({ stdout: 'FAIL src/ConfirmDialog.test.ts\n1 test failed' })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })

    const result = verifyRedExecution(
      {
        ...BASE,
        test_path: 'frontend/src/ConfirmDialog.test.ts',
        test_cwd: 'frontend',
        test_command: ['npx', 'vitest', 'run', 'src/ConfirmDialog.test.ts'],
        test_run_log: 'FAIL src/ConfirmDialog.test.ts\n1 test failed',
        observed_failure: 'FAIL src/ConfirmDialog.test.ts',
      },
      '/repo',
    )

    expect(result.ok).toBe(true)
  })

  it('replays a root-hoisted package binary from the worktree root', () => {
    let replayRoot = ''
    mockedRunCli
      .mockImplementationOnce((_cmd, args) => {
        replayRoot = String((args as readonly string[])[4])
        mkdirSync(join(replayRoot, 'frontend'), { recursive: true })
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      })
      .mockImplementationOnce((cmd, _args, opts) => {
        expect(cmd).toBe(join(replayRoot, 'node_modules', '.bin', 'vitest'))
        expect((opts as { cwd: string }).cwd).toBe(join(replayRoot, 'frontend'))
        throw cliError({ stdout: 'FAIL src/ConfirmDialog.test.ts\n1 test failed' })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })

    const result = verifyRedExecution(
      {
        ...BASE,
        test_path: 'frontend/src/ConfirmDialog.test.ts',
        test_cwd: 'frontend',
        test_command: ['../node_modules/.bin/vitest', 'run', 'src/ConfirmDialog.test.ts'],
        test_run_log: 'FAIL src/ConfirmDialog.test.ts\n1 test failed',
        observed_failure: 'FAIL src/ConfirmDialog.test.ts',
      },
      '/repo',
    )

    expect(result.ok).toBe(true)
  })

  it('fails closed when a relative package binary escapes the replay worktree', () => {
    mockedRunCli
      .mockImplementationOnce((_cmd, args) => {
        mkdirSync(join(String((args as readonly string[])[4]), 'frontend'), { recursive: true })
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })

    const result = verifyRedExecution(
      {
        ...BASE,
        test_cwd: 'frontend',
        test_command: ['../../outside/node_modules/.bin/vitest', 'run', 'math.test.ts'],
      },
      '/repo',
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not fail when re-run/)
    expect(mockedRunCli.mock.calls.every(([command]) => command === 'git')).toBe(true)
  })

  const redLines = [
    'FAIL math.test.ts > add > sums positive values',
    'FAIL math.test.ts > add > sums negative values',
    'FAIL other.spec.ts > subtract > subtracts values',
  ]

  function replayLines(
    lines: string[],
    evidence: TddEvidence = {
      ...BASE,
      test_run_log: redLines.join('\n'),
    },
  ) {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
      .mockImplementationOnce(() => {
        throw cliError({ stdout: lines.join('\n') })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    return verifyRedExecution(evidence, '/repo')
  }

  it('accepts legacy evidence when all multi-file failures replay in another order', () => {
    expect(replayLines([...redLines].reverse()).ok).toBe(true)
  })

  it('preserves same-name failure identity and multiplicity across projects (AC-1, AC-2)', () => {
    const projectFailures = [
      'FAIL |unit| math.test.ts > add > sums',
      'FAIL |integration| math.test.ts > add > sums',
    ]
    const evidence = {
      ...BASE,
      test_run_log: projectFailures.join('\n'),
      observed_failure: 'FAIL |unit| math.test.ts',
    }

    expect(replayLines([projectFailures[0]], evidence).ok).toBe(false)
    expect(replayLines([projectFailures[0], projectFailures[0]], evidence).ok).toBe(false)
    expect(replayLines([...projectFailures].reverse(), evidence).ok).toBe(true)
  })

  it.each([
    ['missing test in the same file', [redLines[0], redLines[2]]],
    ['missing spec file', redLines.slice(0, 2)],
    ['extra failure', [...redLines, 'FAIL extra.test.ts > extra']],
    ['renamed test', [redLines[0], redLines[1], 'FAIL other.spec.ts > changed']],
  ])('rejects a replay with a %s', (_description, lines) => {
    expect(replayLines(lines as string[]).ok).toBe(false)
  })

  it('normalizes ANSI and FAIL padding without collapsing distinct test names', () => {
    const lines = ['FAIL math.test.ts > preserves  two spaces', 'FAIL math.test.ts > other']
    const ev = { ...BASE, test_run_log: lines.join('\n') }
    expect(
      replayLines(
        lines.map((line) => line.replace('FAIL ', '\x1b[31mFAIL\x1b[0m  ')),
        ev,
      ).ok,
    ).toBe(true)
    expect(
      replayLines(
        lines.map((line) => line.replace('two spaces', 'two  spaces')),
        ev,
      ).ok,
    ).toBe(false)
  })

  it('normalizes the ANSI-styled CI project badge while preserving replay argv/cwd/env (AC-1, AC-2)', () => {
    const testPath = '__tests__/evidence/tdd-reexecute.test.ts'
    const evidence = {
      ...BASE,
      test_path: testPath,
      test_run_log: `FAIL |unit tests| ${testPath}`,
      observed_failure: `FAIL |unit tests| ${testPath}`,
      test_command: ['npx', 'vitest', 'run', testPath, '--reporter=verbose'],
    }
    let replayCwd = ''

    mockedRunCli
      .mockImplementationOnce((_cmd, args) => {
        replayCwd = String((args as readonly string[])[4])
        mkdirSync(replayCwd, { recursive: true })
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
      })
      .mockImplementationOnce((_cmd, _args, opts) => {
        const replayOptions = opts as { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
        expect(replayOptions).toEqual({ cwd: replayCwd, timeoutMs: DEFAULT_REEXEC_TIMEOUT_MS })
        expect(replayOptions).not.toHaveProperty('env')
        throw cliError({
          stdout: `\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m \x1b[30m\x1b[42m unit tests \x1b[49m\x1b[39m ${testPath}`,
        })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })

    expect(verifyRedExecution(evidence, '/repo').ok).toBe(true)
    expect(mockedRunCli.mock.calls[1]?.[0]).toBe('npx')
    expect(mockedRunCli.mock.calls[1]?.[1]).toEqual(evidence.test_command.slice(1))
  })

  it('rejects an unstyled diagnostic prefix as a JavaScript failure header (AC-1)', () => {
    expect(replayLines(['FAIL diagnostic:  math.test.ts'], BASE).ok).toBe(false)
  })

  it('rejects an ANSI-styled arbitrary prefix without a background project badge (AC-1)', () => {
    expect(replayLines(['FAIL \x1b[31m diagnostic:\x1b[39m  math.test.ts'], BASE).ok).toBe(false)
  })

  it('rejects an arbitrary background-styled diagnostic prefix (AC-3)', () => {
    expect(replayLines(['FAIL \x1b[44m diagnostic \x1b[49m math.test.ts'], BASE).ok).toBe(false)
  })

  it.each(['  FAIL math.test.ts', '\tFAIL math.test.ts'])(
    'rejects an indented code-frame header: %j (AC-3)',
    (line) => {
      expect(replayLines([line], BASE).ok).toBe(false)
    },
  )

  it('rejects an ANSI badge whose JavaScript path starts on the next line (AC-1)', () => {
    expect(replayLines(['FAIL \x1b[31m  unit tests\x1b[39m', 'math.test.ts'], BASE).ok).toBe(false)
  })

  it('rejects a scalar signature contradicted by its retained log', () => {
    expect(
      replayLines(['FAIL other.test.ts'], {
        ...BASE,
        observed_failure: 'FAIL other.test.ts',
      }).ok,
    ).toBe(false)
  })

  it('normalizes absolute paths from the isolated replay checkout', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
      .mockImplementationOnce((_cmd, _args, opts) => {
        throw cliError({ stdout: `FAIL ${opts?.cwd}/math.test.ts` })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    expect(verifyRedExecution(BASE, '/repo').ok).toBe(true)
  })

  it('does not let a quoted code-frame signature stand in for a missing failure', () => {
    const ev = { ...BASE, test_run_log: 'FAIL math.test.ts\nFAIL other.spec.ts' }
    expect(
      replayLines(['FAIL math.test.ts', '  12| const example = "FAIL other.spec.ts"'], ev).ok,
    ).toBe(false)
  })

  it('ignores quoted FAIL signatures in diagnostic code frames', () => {
    expect(
      replayLines(
        ['FAIL math.test.ts', '  12| const example = "FAIL never-executed.test.ts"'],
        BASE,
      ).ok,
    ).toBe(true)
  })

  it('always attempts worktree cleanup, even when the check fails', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockReturnValueOnce({ stdout: 'All good.', stderr: '', exitCode: 0, durationMs: 5 }) // test run (no failure)
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    verifyRedExecution(BASE, '/repo')
    const removeCall = mockedRunCli.mock.calls.find(
      (c) => c[0] === 'git' && Array.isArray(c[1]) && c[1].includes('remove'),
    )
    expect(removeCall).toBeDefined()
  })

  it('surfaces the CliError stderr detail when the worktree add throws with stderr', () => {
    mockedRunCli
      .mockImplementationOnce(() => {
        throw cliError({ stderr: 'fatal: reference is not a tree' })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/fatal: reference is not a tree/)
  })

  it('surfaces a non-CliError thrown by the worktree add as a checkout failure', () => {
    mockedRunCli
      .mockImplementationOnce(() => {
        throw new Error('spawn git ENOENT')
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // cleanup
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/check out test_commit_sha/)
    expect(result.reason).toMatch(/spawn git ENOENT/)
  })

  it('fails closed when the test run throws a non-CliError (no output to match)', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw new Error('runner crashed before producing output')
      }) // test run
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not fail when re-run/)
    expect(result.reason).toMatch(/false-green risk/)
  })

  it('reproduces the failure when the signature appears only on the failing run stderr', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'running suite…', stderr: 'FAIL math.test.ts\n1 test failed' })
      }) // test run — failure reported on stderr
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })

  it('rejects a failure signature on stderr when the runner exits 0', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockReturnValueOnce({
        stdout: 'suite started',
        stderr: 'FAIL math.test.ts\n1 test failed',
        exitCode: 0,
        durationMs: 50,
      }) // test run — zero exit, failure only visible on stderr
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
  })

  it('rejects partial failure output from a timed-out runner', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
      .mockImplementationOnce(() => {
        throw Object.assign(cliError({ stdout: BASE.test_run_log }), {
          exitCode: -1,
          timedOut: true,
        })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    expect(verifyRedExecution(BASE, '/repo').ok).toBe(false)
  })

  it.each([
    ['a missing tool', { notFound: true }],
    ['truncated output', { outputTruncated: true }],
  ])('fails closed on %s (AC-3)', (_description, fields) => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
      .mockImplementationOnce(() => {
        throw Object.assign(cliError({ stdout: BASE.test_run_log }), {
          exitCode: -1,
          ...fields,
        })
      })
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/did not fail when re-run/)
  })

  it('links the caller node_modules into the worktree so the re-run resolves its runner', () => {
    const callerDir = mkdtempSync(join(tmpdir(), 'tdd-reexec-caller-'))
    mkdirSync(join(callerDir, 'node_modules'))
    let seenLinkTarget: string | undefined
    try {
      mockedRunCli
        .mockImplementationOnce((_cmd, args) => {
          // `git worktree add` genuinely creates the target directory.
          mkdirSync(String((args as readonly string[])[4]), { recursive: true })
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 }
        })
        .mockImplementationOnce((_cmd, _args, opts) => {
          // The re-run must see node_modules linked inside its own cwd.
          const linkPath = join(String((opts as { cwd: string }).cwd), 'node_modules')
          if (existsSync(linkPath) && lstatSync(linkPath).isSymbolicLink()) {
            seenLinkTarget = readlinkSync(linkPath)
          }
          throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
        })
        .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
      const result = verifyRedExecution(BASE, callerDir)
      expect(result.ok).toBe(true)
      expect(seenLinkTarget).toBe(join(callerDir, 'node_modules'))
    } finally {
      rmSync(callerDir, { recursive: true, force: true })
    }
  })

  it('falls back to process.cwd() when no dir is given and fails open on an impossible symlink', () => {
    // gitCwd() lets ARBITER_HOOK_GIT_CWD win (pre-push rsync dir has no .git);
    // isolate the fallback-under-test from that override.
    const savedHookGitCwd = process.env.ARBITER_HOOK_GIT_CWD
    delete process.env.ARBITER_HOOK_GIT_CWD
    try {
      mockedRunCli
        // worktree add "succeeds" but never creates the directory, so the
        // node_modules symlink attempt below throws — FAIL-OPEN-INTENT path.
        .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 })
        .mockReturnValueOnce({
          stdout: 'All tests passed.',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
        })
        .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree remove
      const result = verifyRedExecution(BASE)
      // The symlink failure did not mask the real outcome: the re-run passed,
      // so the check still fails closed on the unreproduced RED phase.
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/did not fail when re-run/)
      // The repo was resolved from process.cwd(), not from an explicit dir.
      const addCall = mockedRunCli.mock.calls[0]
      expect((addCall[2] as { cwd: string }).cwd).toBe(process.cwd())
    } finally {
      if (savedHookGitCwd !== undefined) process.env.ARBITER_HOOK_GIT_CWD = savedHookGitCwd
    }
  })

  it('still returns the check result when worktree removal itself throws (fail-open cleanup)', () => {
    mockedRunCli
      .mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 5 }) // worktree add
      .mockImplementationOnce(() => {
        throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
      }) // test run — genuinely red
      .mockImplementationOnce(() => {
        throw new Error('worktree remove: lock held')
      }) // cleanup blows up
    const result = verifyRedExecution(BASE, '/repo')
    expect(result.ok).toBe(true)
  })
})

describe('verifyGreenExecution()', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-green-replay-'))
    writeFileSync(join(dir, BASE.test_path), 'test')
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes only when the recorded command succeeds in the current working tree', () => {
    mockedRunCli.mockReturnValue({ stdout: '1 passed', stderr: '', exitCode: 0, durationMs: 9 })
    expect(verifyGreenExecution(BASE, dir)).toEqual({ ok: true })
    expect(mockedRunCli).toHaveBeenCalledWith('npx', ['vitest', 'run', 'math.test.ts'], {
      cwd: dir,
      timeoutMs: DEFAULT_REEXEC_TIMEOUT_MS,
    })
  })

  it('requires an explicit PASS verdict for shell self-tests', () => {
    const shell = {
      ...BASE,
      test_run_log: 'FAIL: scanner did not report the expected violation',
      observed_failure: 'FAIL: scanner did not report the expected violation',
      test_command: ['bash', 'scripts/check-scanner.test.sh'],
    }
    mockedRunCli.mockReturnValueOnce({
      stdout: 'check-scanner.test.sh: PASS\n',
      stderr: '',
      exitCode: 0,
      durationMs: 9,
    })
    expect(verifyGreenExecution(shell, dir)).toEqual({ ok: true })

    mockedRunCli.mockReturnValueOnce({
      stdout: 'completed\n',
      stderr: '',
      exitCode: 0,
      durationMs: 9,
    })
    expect(verifyGreenExecution(shell, dir).reason).toMatch(/PASS verdict/i)

    mockedRunCli.mockReturnValueOnce({
      stdout: 'FAIL: expected check-scanner.test.sh: PASS\n',
      stderr: '',
      exitCode: 0,
      durationMs: 9,
    })
    expect(verifyGreenExecution(shell, dir).reason).toMatch(/failure verdict/i)

    mockedRunCli.mockReturnValueOnce({
      stdout: '1 skipped\ncheck-scanner.test.sh: PASS\n',
      stderr: '',
      exitCode: 0,
      durationMs: 9,
    })
    expect(verifyGreenExecution(shell, dir).reason).toMatch(/skipped/i)
  })

  it('keeps GREEN when the recorded command still fails', () => {
    mockedRunCli.mockImplementation(() => {
      throw cliError({ stdout: 'FAIL math.test.ts\n1 test failed' })
    })
    const result = verifyGreenExecution(BASE, dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/still fails.*exit 1/i)
  })

  it('distinguishes timeout, unavailable command, killed process, and truncated output', () => {
    for (const [fields, expected] of [
      [{ timedOut: true }, /timed out/i],
      [{ notFound: true }, /unavailable/i],
      [{ signal: 'SIGKILL' }, /interrupted.*SIGKILL/i],
      [{ outputTruncated: true }, /output.*limit/i],
    ] as const) {
      mockedRunCli.mockImplementationOnce(() => {
        throw cliError(fields)
      })
      expect(verifyGreenExecution(BASE, dir).reason).toMatch(expected)
    }
  })

  it('fails closed for missing command, unsafe cwd, missing test, and explicit zero-test output', () => {
    expect(verifyGreenExecution({ ...BASE, test_command: [] }, dir).reason).toMatch(/test_command/)
    expect(verifyGreenExecution({ ...BASE, test_cwd: '../outside' }, dir).reason).toMatch(
      /test_cwd/,
    )
    expect(verifyGreenExecution({ ...BASE, test_path: 'missing.test.ts' }, dir).reason).toMatch(
      /test_path/,
    )
    mockedRunCli.mockReturnValue({
      stdout: 'No test files found, exiting with code 0',
      stderr: '',
      exitCode: 0,
      durationMs: 9,
    })
    expect(verifyGreenExecution(BASE, dir).reason).toMatch(/zero tests/i)

    mockedRunCli.mockReturnValue({
      stdout: 'Tests  1 skipped (1)',
      stderr: '',
      exitCode: 0,
      durationMs: 9,
    })
    expect(verifyGreenExecution(BASE, dir).reason).toMatch(/skipped tests/i)
  })
})
