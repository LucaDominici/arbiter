import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, runCliAsync, runCliJson, CliError } from '../../src/utils/run-cli.js'

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

  it('throws a fatal CliError naming the buffer limit when output overflows maxBuffer', () => {
    // Child writes 2 MB but the cap is set to 1 MB → spawnSync kills it with
    // ENOBUFS. Without the fix this surfaces as a generic "exit -1"; with it,
    // the cause (output exceeded buffer) is named and not retried. (#1520)
    let err: CliError | undefined
    try {
      runCli('node', ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"], {
        maxBufferBytes: 1 * 1024 * 1024,
        // retries must NOT fire — overflow is deterministic/fatal.
        retries: 3,
        retryDelayMs: 1,
      })
    } catch (e) {
      err = e as CliError
    }
    expect(err).toBeInstanceOf(CliError)
    expect(err!.outputTruncated).toBe(true)
    expect(err!.timedOut).toBe(false)
    expect(err!.notFound).toBe(false)
    expect(err!.message).toMatch(/output exceeded buffer limit/i)
    expect(err!.message).toMatch(/1 MB/)
    // Regression guard: the old behaviour reported this as a bare "exit -1".
    expect(err!.message).not.toMatch(/Command failed \(exit -1\)/)
  })

  it('does not truncate large output under the raised default buffer', () => {
    // 2 MB exceeds Node's 1 MB default but is well under DEFAULT_MAX_BUFFER_BYTES,
    // so it must round-trip intact without an explicit maxBufferBytes. (#1520)
    const result = runCli('node', ['-e', "process.stdout.write('y'.repeat(2 * 1024 * 1024))"])
    expect(result.stdout.length).toBe(2 * 1024 * 1024)
    expect(result.exitCode).toBe(0)
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

describe('runCliAsync', () => {
  it('returns stdout, stderr, exitCode and durationMs on success', async () => {
    const result = await runCliAsync('node', [
      '-e',
      "process.stdout.write('hello'); process.stderr.write('world')",
    ])
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('world')
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('throws CliError on non-zero exit, preserving stderr and exitCode', async () => {
    const err = await runCliAsync('node', [
      '-e',
      "process.stderr.write('boom'); process.exit(2)",
    ]).catch((e) => e as CliError)
    expect(err).toBeInstanceOf(CliError)
    expect(err.exitCode).toBe(2)
    expect(err.stderr).toBe('boom')
    expect(err.timedOut).toBe(false)
    expect(err.notFound).toBe(false)
  })

  it('throws CliError with timedOut=true when command exceeds timeoutMs', async () => {
    const err = await runCliAsync('node', ['-e', 'setInterval(()=>{}, 1000)'], {
      timeoutMs: 150,
    }).catch((e) => e as CliError)
    expect(err).toBeInstanceOf(CliError)
    expect(err.timedOut).toBe(true)
    expect(err.notFound).toBe(false)
    expect(err.message).toMatch(/timed out/i)
  })

  it('escalates SIGTERM→SIGKILL so a SIGTERM-trapping child still times out (#1581)', async () => {
    // The child installs a SIGTERM handler that ignores the signal and keeps
    // looping — common in CLIs with graceful-shutdown handlers. Without a
    // SIGKILL escalation the watchdog's single SIGTERM is swallowed, the child
    // never emits 'close', and runCliAsync hangs forever (timeout defeated).
    const start = Date.now()
    const err = await runCliAsync(
      'node',
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeoutMs: 300 },
    ).catch((e) => e as CliError)
    const elapsed = Date.now() - start
    expect(err).toBeInstanceOf(CliError)
    expect(err.timedOut).toBe(true)
    // Must settle within timeoutMs + the SIGKILL grace + margin, not hang.
    expect(elapsed).toBeLessThan(300 + 2000 + 4000)
  }, 10_000)

  it('throws a fatal CliError naming the buffer limit when output overflows maxBuffer', async () => {
    const err = await runCliAsync(
      'node',
      ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"],
      { maxBufferBytes: 1 * 1024 * 1024, retries: 3, retryDelayMs: 1 },
    ).catch((e) => e as CliError)
    expect(err).toBeInstanceOf(CliError)
    expect(err.outputTruncated).toBe(true)
    expect(err.timedOut).toBe(false)
    expect(err.message).toMatch(/output exceeded buffer limit/i)
    expect(err.message).toMatch(/1 MB/)
  })

  it('throws CliError with notFound=true when command is missing', async () => {
    const err = await runCliAsync('arbiter-nonexistent-command-xyz-12345', []).catch(
      (e) => e as CliError,
    )
    expect(err).toBeInstanceOf(CliError)
    expect(err.notFound).toBe(true)
    expect(err.timedOut).toBe(false)
    expect(err.message).toMatch(/not found/i)
  })

  it('retries failing commands and succeeds when attempts eventually pass', async () => {
    const counterFile = join(tmpdir(), `run-cli-async-retry-${Date.now()}.txt`)
    writeFileSync(counterFile, '0')
    try {
      const script = [
        "const fs = require('fs');",
        `const n = parseInt(fs.readFileSync('${counterFile}', 'utf-8'), 10) + 1;`,
        `fs.writeFileSync('${counterFile}', String(n));`,
        'if (n < 3) { process.exit(1); }',
        "process.stdout.write('attempt ' + n);",
      ].join('\n')
      const result = await runCliAsync('node', ['-e', script], { retries: 3, retryDelayMs: 5 })
      expect(result.stdout).toBe('attempt 3')
      expect(result.exitCode).toBe(0)
    } finally {
      rmSync(counterFile, { force: true })
    }
  })

  it('pipes input to child stdin', async () => {
    const result = await runCliAsync(
      'node',
      ['-e', "process.stdin.on('data', d => process.stdout.write(d))"],
      { input: 'piped-data' },
    )
    expect(result.stdout).toBe('piped-data')
  })

  it('passes cwd and env to the child process', async () => {
    const result = await runCliAsync(
      'node',
      ['-e', "process.stdout.write(process.cwd() + ':' + (process.env.ARB_ASYNC ?? 'missing'))"],
      { cwd: tmpdir(), env: { ARB_ASYNC: 'present', PATH: process.env.PATH ?? '' } },
    )
    expect(result.stdout).toContain('present')
  })

  it('runs concurrently: two slow children overlap rather than serialize', async () => {
    // Each child reports its own start/end wall clock. Genuinely concurrent
    // children (spawn + event loop free — the core #1514 guarantee) are alive
    // simultaneously, so their lifetimes overlap: the later start precedes the
    // earlier end. A serialized regression (spawnSync-style) can never overlap
    // because the second child only spawns after the first exits. Interval
    // overlap is load-independent — the previous fixed wall-clock ceiling
    // (< 500ms for two 300ms sleepers) flaked on busy CI runners where spawn
    // overhead alone pushed genuinely-concurrent runs past the ceiling.
    const sleeper = [
      '-e',
      'const s = Date.now(); setTimeout(() => process.stdout.write(s + ":" + Date.now()), 300)',
    ]
    const results = await Promise.all([runCliAsync('node', sleeper), runCliAsync('node', sleeper)])
    const spans = results.map((r) => {
      const [startRaw, endRaw] = r.stdout.split(':')
      const start = Number(startRaw)
      const end = Number(endRaw)
      expect(Number.isFinite(start)).toBe(true)
      expect(Number.isFinite(end)).toBe(true)
      return { start, end }
    })
    const latestStart = Math.max(...spans.map((s) => s.start))
    const earliestEnd = Math.min(...spans.map((s) => s.end))
    expect(latestStart).toBeLessThan(earliestEnd)
  })
})
