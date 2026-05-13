import { spawnSync } from 'node:child_process'

export interface RunCliOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  input?: string
}

export interface RunCliResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

interface CliErrorDetails {
  cmd: string
  args: readonly string[]
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  notFound: boolean
}

export class CliError extends Error {
  readonly cmd: string
  readonly args: readonly string[]
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly notFound: boolean

  constructor(details: CliErrorDetails, message?: string) {
    super(message ?? formatMessage(details))
    this.name = 'CliError'
    this.cmd = details.cmd
    this.args = details.args
    this.exitCode = details.exitCode
    this.stdout = details.stdout
    this.stderr = details.stderr
    this.timedOut = details.timedOut
    this.notFound = details.notFound
  }
}

const DEFAULT_TIMEOUT_MS = 60_000

type Attempt = { ok: true; result: RunCliResult } | { ok: false; error: CliError; fatal: boolean }

interface RunOnceOptions {
  cwd: string | undefined
  env: NodeJS.ProcessEnv | undefined
  input: string | undefined
  timeoutMs: number
}

function runOnce(cmd: string, args: readonly string[], opts: RunOnceOptions): Attempt {
  const start = Date.now()
  const result = spawnSync(cmd, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    input: opts.input,
    encoding: 'utf-8',
    shell: false,
  })
  const durationMs = Date.now() - start

  const stdout = result.stdout
  const stderr = result.stderr
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code

  if (errorCode === 'ENOENT') {
    return {
      ok: false,
      fatal: true,
      error: new CliError(
        {
          cmd,
          args,
          exitCode: -1,
          stdout,
          stderr,
          timedOut: false,
          notFound: true,
        },
        `Command not found: ${cmd}`,
      ),
    }
  }

  // SIGTERM alone is an unreliable timeout signal — an external `kill` or a
  // parent-shell teardown also surfaces SIGTERM. Cross-check duration so the
  // "timeout" classification fires only when the run plausibly hit the deadline
  // (within 1s for jitter). (#277 finding #14)
  const sigtermLikelyTimeout = result.signal === 'SIGTERM' && durationMs >= opts.timeoutMs - 1000
  const timedOut = errorCode === 'ETIMEDOUT' || sigtermLikelyTimeout
  if (timedOut) {
    return {
      ok: false,
      fatal: false,
      error: new CliError({
        cmd,
        args,
        exitCode: -1,
        stdout,
        stderr,
        timedOut: true,
        notFound: false,
      }),
    }
  }

  if (result.status !== 0) {
    return {
      ok: false,
      fatal: false,
      error: new CliError({
        cmd,
        args,
        exitCode: result.status ?? -1,
        stdout,
        stderr,
        timedOut: false,
        notFound: false,
      }),
    }
  }

  return { ok: true, result: { stdout, stderr, exitCode: 0, durationMs } }
}

/**
 * Run a CLI command with timeout, retry and structured errors.
 * All CLI invocations in arbiter MUST go through this helper (INV-12).
 */
export function runCli(
  cmd: string,
  args: readonly string[],
  opts: RunCliOptions = {},
): RunCliResult {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts.retries ?? 0
  const retryDelayMs = opts.retryDelayMs ?? 500
  const runOpts = {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input,
    timeoutMs,
  }

  const attemptErrors: CliError[] = []
  for (let attempt = 0; attempt <= retries; attempt++) {
    const outcome = runOnce(cmd, args, runOpts)
    if (outcome.ok) {
      logRetrySuccess(cmd, attemptErrors)
      return outcome.result
    }
    if (outcome.fatal) throw outcome.error
    attemptErrors.push(outcome.error)
    if (attempt < retries) sleepSync(retryDelayMs)
  }

  throw finalRetryError(cmd, args, attemptErrors)
}

/**
 * Leave a one-line trail when a retry eventually succeeds so flaky commands
 * are observable (previously every intermediate failure was silently lost
 * — #277 finding #10).
 */
function logRetrySuccess(cmd: string, attemptErrors: readonly CliError[]): void {
  if (attemptErrors.length === 0) return
  console.warn(
    `[arbiter] runCli: ${cmd} succeeded after ${attemptErrors.length} ` +
      `failed attempt(s); first error: ${attemptErrors[0]?.message ?? '(none)'}`,
  )
}

/**
 * Build the error thrown after all retries exhaust. Defensive against
 * retries < 0 (empty attemptErrors); summarises the attempt count when
 * more than one failure was observed.
 */
function finalRetryError(
  cmd: string,
  args: readonly string[],
  attemptErrors: readonly CliError[],
): CliError {
  const last = attemptErrors[attemptErrors.length - 1]
  if (!last) {
    return new CliError(
      {
        cmd,
        args,
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: false,
        notFound: false,
      },
      `Command failed before first attempt: ${cmd}`,
    )
  }
  if (attemptErrors.length > 1) {
    console.warn(
      `[arbiter] runCli: ${cmd} failed after ${attemptErrors.length} attempt(s); ` +
        `final error: ${last.message}`,
    )
  }
  return last
}

/**
 * Run a CLI command and parse stdout as JSON. Returns `unknown` — callers
 * narrow with a type assertion. Throws CliError on non-zero exit or invalid JSON.
 */
export function runCliJson(
  cmd: string,
  args: readonly string[],
  opts: RunCliOptions = {},
): unknown {
  const result = runCli(cmd, args, opts)
  try {
    return JSON.parse(result.stdout)
  } catch (err) {
    throw new CliError(
      {
        cmd,
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: false,
        notFound: false,
      },
      `Invalid JSON output from ${cmd}: ${(err as Error).message}`,
    )
  }
}

function formatMessage(details: CliErrorDetails): string {
  const cmdStr = `${details.cmd} ${details.args.join(' ')}`.trim()
  if (details.timedOut) {
    return `Command timed out: ${cmdStr}`
  }
  const preview = details.stderr.trim().slice(0, 500)
  return `Command failed (exit ${details.exitCode}): ${cmdStr}${preview ? `\n${preview}` : ''}`
}

function sleepSync(ms: number): void {
  if (ms <= 0) return
  const buf = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buf, 0, 0, ms)
}
