import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunCliResult } from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(() => ({
    stdout: '  gate: ok\n',
    stderr: '',
    exitCode: 0,
    durationMs: 1,
  })),
  CliError: class CliError extends Error {
    cmd = 'node'
    args: string[] = []
    exitCode = 1
    stdout = ''
    stderr = ''
    timedOut = false
    notFound = false
    constructor(details: {
      cmd: string
      args: string[]
      exitCode: number
      stdout: string
      stderr: string
      timedOut: boolean
      notFound: boolean
    }) {
      super(`exit ${details.exitCode}`)
      Object.assign(this, details)
    }
  },
}))

const GATE_NAMES = [
  'check-ssot-core',
  'check-doc-links',
  'check-knowledge-map',
  'check-canonical-paths',
]

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'harness-cmd-test-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  for (const name of GATE_NAMES) {
    writeFileSync(join(dir, 'scripts', `${name}.mjs`), `#!/usr/bin/env node\n`)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('runHarness (#255)', () => {
  let runCliMock: MockedFunction<(...args: unknown[]) => RunCliResult>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    const mod = await import('../../src/utils/run-cli.js')
    runCliMock = mod.runCli as MockedFunction<(...args: unknown[]) => RunCliResult>
    runCliMock.mockReturnValue({
      stdout: '  gate: ok\n',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    })
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('runs all 4 gate scripts when all pass', async () => {
    const { dir, cleanup } = makeDir()
    try {
      const { runHarness } = await import('../../src/commands/harness.js')
      const result = runHarness({ dir })
      expect(result.exitCode).toBe(0)
      expect(result.passed).toBe(4)
      expect(result.failed).toBe(0)
      expect(runCliMock).toHaveBeenCalledTimes(4)
    } finally {
      cleanup()
    }
  })

  it('runs gates in order: ssot-core, doc-links, knowledge-map, canonical-paths', async () => {
    const { dir, cleanup } = makeDir()
    try {
      const { runHarness } = await import('../../src/commands/harness.js')
      runHarness({ dir })
      const calls = runCliMock.mock.calls.map((c) => String((c as unknown[][])[1]?.[0] ?? ''))
      for (const [i, name] of GATE_NAMES.entries()) {
        expect(calls[i]).toContain(name)
      }
    } finally {
      cleanup()
    }
  })

  it('exits 1 when any gate fails', async () => {
    const { dir, cleanup } = makeDir()
    try {
      const { CliError } = await import('../../src/utils/run-cli.js')
      runCliMock.mockImplementationOnce(() => {
        throw new (CliError as new (d: object) => Error)({
          cmd: 'node',
          args: [],
          exitCode: 1,
          stdout: '  broken\n',
          stderr: '',
          timedOut: false,
          notFound: false,
        })
      })
      const { runHarness } = await import('../../src/commands/harness.js')
      const result = runHarness({ dir })
      expect(result.exitCode).toBe(1)
      expect(result.failed).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('stops at first failure in fast mode', async () => {
    const { dir, cleanup } = makeDir()
    try {
      const { CliError } = await import('../../src/utils/run-cli.js')
      runCliMock.mockImplementationOnce(() => {
        throw new (CliError as new (d: object) => Error)({
          cmd: 'node',
          args: [],
          exitCode: 1,
          stdout: '',
          stderr: '',
          timedOut: false,
          notFound: false,
        })
      })
      const { runHarness } = await import('../../src/commands/harness.js')
      const result = runHarness({ dir, fast: true })
      expect(runCliMock).toHaveBeenCalledTimes(1)
      expect(result.failed).toBe(1)
      expect(result.gates).toHaveLength(1)
    } finally {
      cleanup()
    }
  })

  it('runs all gates in non-fast mode even when one fails', async () => {
    const { dir, cleanup } = makeDir()
    try {
      const { CliError } = await import('../../src/utils/run-cli.js')
      runCliMock.mockImplementationOnce(() => {
        throw new (CliError as new (d: object) => Error)({
          cmd: 'node',
          args: [],
          exitCode: 1,
          stdout: '',
          stderr: '',
          timedOut: false,
          notFound: false,
        })
      })
      const { runHarness } = await import('../../src/commands/harness.js')
      const result = runHarness({ dir, fast: false })
      expect(runCliMock).toHaveBeenCalledTimes(4)
      expect(result.gates).toHaveLength(4)
    } finally {
      cleanup()
    }
  })

  it('skips a gate when its script file does not exist', async () => {
    const { dir, cleanup } = makeDir()
    try {
      rmSync(join(dir, 'scripts', 'check-ssot-core.mjs'))
      const { runHarness } = await import('../../src/commands/harness.js')
      const result = runHarness({ dir })
      expect(result.skipped).toBe(1)
      expect(result.passed).toBe(3)
      expect(runCliMock).toHaveBeenCalledTimes(3)
    } finally {
      cleanup()
    }
  })

  it('writes gate output to stdout', async () => {
    const { dir, cleanup } = makeDir()
    try {
      runCliMock.mockReturnValue({
        stdout: '  all links resolve\n',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
      })
      const { runHarness } = await import('../../src/commands/harness.js')
      runHarness({ dir })
      const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
      expect(allOutput).toContain('all links resolve')
    } finally {
      cleanup()
    }
  })
})
