import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliError, runCli } from '../../src/utils/run-cli.js'
import {
  detectExternalModel,
  detectExternalModels,
  resetExternalModelDetection,
} from '../../src/detectors/external-model.js'

vi.mock('../../src/utils/run-cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCli: vi.fn() }
})

const mockedRunCli = vi.mocked(runCli)

describe('external model detection', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'arbiter-external-model-'))
    resetExternalModelDetection()
    mockedRunCli.mockReset()
    mockedRunCli.mockReturnValue({
      stdout: 'codex 0.5.1\n',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    })
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
  })

  it('uses the declarative Codex provider contract', () => {
    detectExternalModel('codex', { homeDir, env: {} })
    expect(mockedRunCli).toHaveBeenCalledWith('codex', ['--version'], expect.any(Object))
  })

  it('detects an installed and authenticated Codex CLI from auth-file presence only', () => {
    mkdirSync(join(homeDir, '.codex'), { recursive: true })
    writeFileSync(join(homeDir, '.codex', 'auth.json'), '{}\n')
    const result = detectExternalModel('codex', {
      homeDir,
      env: {},
    })

    expect(result).toEqual({
      provider: 'codex',
      vendor: 'openai',
      available: true,
      authenticated: true,
      version: '0.5.1',
      error: null,
    })
    expect(mockedRunCli).toHaveBeenCalledWith('codex', ['--version'], expect.any(Object))
    expect(JSON.stringify(mockedRunCli.mock.calls)).not.toContain('secret-must-not-leak')
  })

  it('does not treat a present API-key variable as authentication or pass its value to codex', () => {
    const result = detectExternalModel('codex', {
      homeDir,
      env: { OPENAI_API_KEY: 'present-but-never-forwarded' },
    })

    expect(result.authenticated).toBe(false)
    expect(result.error).toBe('Not authenticated')
    expect(mockedRunCli.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ timeoutMs: 5000, retries: 0 }),
    )
    expect(JSON.stringify(mockedRunCli.mock.calls)).not.toContain('present-but-never-forwarded')
  })

  it('reports an installed but unauthenticated Codex CLI', () => {
    const result = detectExternalModel('codex', { homeDir, env: {} })

    expect(result).toMatchObject({
      provider: 'codex',
      vendor: 'openai',
      available: true,
      authenticated: false,
      error: 'Not authenticated',
    })
  })

  it('classifies a missing CLI as unavailable and preserves the typed cause', () => {
    mockedRunCli.mockImplementation(() => {
      throw new CliError({
        cmd: 'codex',
        args: ['--version'],
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: false,
        notFound: true,
      })
    })

    expect(detectExternalModel('codex', { homeDir, env: {} })).toMatchObject({
      available: false,
      authenticated: false,
      error: expect.stringMatching(/codex CLI not found.*Install/i),
    })
  })

  it('memoizes detections per process and can reset the cache', () => {
    detectExternalModel('codex', { homeDir, env: {} })
    detectExternalModel('codex', { homeDir, env: { OPENAI_API_KEY: 'new-value' } })
    expect(mockedRunCli).toHaveBeenCalledTimes(1)

    resetExternalModelDetection()
    detectExternalModels(['codex'], { homeDir, env: { OPENAI_API_KEY: 'new-value' } })
    expect(mockedRunCli).toHaveBeenCalledTimes(2)
  })
})
