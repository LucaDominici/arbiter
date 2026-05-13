import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, runCliJson, CliError } from '../../src/utils/run-cli.js'

describe('runCli', () => {
  it('returns stdout, stderr, exitCode and durationMs on success', () => {
    const result = runCli('node', [
      '-e',
      "process.stdout.write('hello'); process.stderr.write('world')",
    ])
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('world')
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('throws CliError on non-zero exit, preserving stderr and exitCode', () => {
    let err: CliError | undefined
    try {
      runCli('node', ['-e', "process.stderr.write('boom'); process.exit(2)"])
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.exitCode).toBe(2)
    expect(err!.stderr).toBe('boom')
    expect(err!.timedOut).toBe(false)
    expect(err!.notFound).toBe(false)
    expect(err!.cmd).toBe('node')
    expect(err!.args).toEqual(['-e', "process.stderr.write('boom'); process.exit(2)"])
  })

  it('throws CliError with timedOut=true when command exceeds timeoutMs', () => {
    let err: CliError | undefined
    try {
      runCli('node', ['-e', 'setInterval(()=>{}, 1000)'], { timeoutMs: 150 })
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.timedOut).toBe(true)
    expect(err!.notFound).toBe(false)
    expect(err!.message).toMatch(/timed out/i)
  })

  it('throws CliError with clear message when command is not found', () => {
    let err: CliError | undefined
    try {
      runCli('arbiter-nonexistent-command-xyz-12345', [])
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.notFound).toBe(true)
    expect(err!.timedOut).toBe(false)
    expect(err!.message).toMatch(/not found/i)
  })

  it('retries failing commands and succeeds when attempts eventually pass', () => {
    const counterFile = join(tmpdir(), `run-cli-retry-${Date.now()}.txt`)
    writeFileSync(counterFile, '0')
    try {
      const script = [
        "const fs = require('fs');",
        `const n = parseInt(fs.readFileSync('${counterFile}', 'utf-8'), 10) + 1;`,
        `fs.writeFileSync('${counterFile}', String(n));`,
        'if (n < 3) { process.exit(1); }',
        "process.stdout.write('attempt ' + n);",
      ].join('\n')
      const result = runCli('node', ['-e', script], {
        retries: 3,
        retryDelayMs: 5,
      })
      expect(result.stdout).toBe('attempt 3')
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(counterFile, { force: true })
    }
  })

  it('throws after exhausting retries on persistently failing command', () => {
    let err: CliError | undefined
    try {
      runCli('node', ['-e', 'process.exit(1)'], {
        retries: 2,
        retryDelayMs: 5,
      })
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.exitCode).toBe(1)
  })

  it('passes cwd to the child process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-cli-cwd-'))
    try {
      const result = runCli('node', ['-e', 'process.stdout.write(process.cwd())'], { cwd: dir })
      expect(result.stdout).toContain('run-cli-cwd')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes env to the child process', () => {
    const result = runCli(
      'node',
      ['-e', "process.stdout.write(process.env.ARBITER_RUN_CLI_TEST ?? 'missing')"],
      {
        env: {
          ARBITER_RUN_CLI_TEST: 'present',
          PATH: process.env.PATH ?? '',
        },
      },
    )
    expect(result.stdout).toBe('present')
  })

  it('pipes input to child stdin', () => {
    const result = runCli(
      'node',
      ['-e', "process.stdin.on('data', d => process.stdout.write(d))"],
      { input: 'piped-data' },
    )
    expect(result.stdout).toBe('piped-data')
  })
})

describe('runCliJson', () => {
  it('parses JSON stdout into a typed object', () => {
    const data = runCliJson<{ ok: boolean; n: number }>('node', [
      '-e',
      'process.stdout.write(JSON.stringify({ok:true,n:42}))',
    ])
    expect(data.ok).toBe(true)
    expect(data.n).toBe(42)
  })

  it("throws CliError with 'Invalid JSON' when stdout is not JSON", () => {
    let err: CliError | undefined
    try {
      runCliJson('node', ['-e', "process.stdout.write('not json')"])
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.message).toMatch(/Invalid JSON/)
  })

  it('propagates CliError from runCli on non-zero exit', () => {
    let err: CliError | undefined
    try {
      runCliJson('node', ['-e', 'process.exit(1)'])
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.exitCode).toBe(1)
  })
})
