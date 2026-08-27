// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync, type StdioOptions } from 'node:child_process'
import { readdirSync, readlinkSync } from 'node:fs'
import { getLogger } from './logger.js'

export interface RunCliOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  input?: string
  /**
   * Maximum bytes buffered from the child's stdout/stderr. Defaults to
   * {@link DEFAULT_MAX_BUFFER_BYTES} (64 MB) rather than Node's 1 MB default,
   * which silently truncates large output (e.g. a full `git diff` of a branch)
   * and kills the child with an opaque `ENOBUFS`/`exit -1`. Raise it for
   * callers that legitimately produce more output.
   */
  maxBufferBytes?: number
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
  outputTruncated?: boolean
}

export class CliError extends Error {
  readonly cmd: string
  readonly args: readonly string[]
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly notFound: boolean
  /** True when the child was killed because its output exceeded `maxBuffer`. */
  readonly outputTruncated: boolean

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
    this.outputTruncated = details.outputTruncated ?? false
  }
}

const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Default cap on bytes buffered from a child's stdout/stderr. Node's own
 * default is 1 MB, which truncates ordinary large output (a few-thousand-line
 * `git diff`, a big `gh` JSON payload) and surfaces as an opaque `exit -1`.
 * Aligned with the generated run-helpers (`run-helpers.mjs`, 50 MB) and the
 * 64 MB used by `check-min-test-execution`, so the framework no longer holds
 * target projects to a higher standard than its own central wrapper (#1520).
 */
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024

type Attempt = { ok: true; result: RunCliResult } | { ok: false; error: CliError; fatal: boolean }

interface RunOnceOptions {
  cwd: string | undefined
  env: NodeJS.ProcessEnv | undefined
  input: string | undefined
  timeoutMs: number
  maxBufferBytes: number
}

/** Raw observations from one child run, before classification. */
interface AttemptObservation {
  cmd: string
  args: readonly string[]
  stdout: string
  stderr: string
  /** errno code (ENOENT/ENOBUFS/ETIMEDOUT/…) or undefined when the child ran. */
  errorCode: string | undefined
  status: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  timeoutMs: number
  maxBufferBytes: number
}

/**
 * Classify a finished `spawnSync` run into a retry-loop {@link Attempt} —
 * not-found, output-overflow, timeout, non-zero exit.
 */
function classifyAttempt(obs: AttemptObservation): Attempt {
  const { cmd, args, stdout, stderr, errorCode } = obs

  if (errorCode === 'ENOENT') {
    return {
      ok: false,
      fatal: true,
      error: new CliError(
        { cmd, args, exitCode: -1, stdout, stderr, timedOut: false, notFound: true },
        `Command not found: ${cmd}`,
      ),
    }
  }

  // Output overflowed `maxBuffer`: the child is killed and the code is ENOBUFS
  // with truncated stdout/stderr. This is deterministic — retrying re-runs the
  // same overflow — so it is fatal, and it must NOT be misread as the
  // SIGTERM-timeout case below. Surface a clear cause instead of an opaque
  // "exit -1". (#1520)
  if (errorCode === 'ENOBUFS') {
    const limitMb = Math.round(obs.maxBufferBytes / (1024 * 1024))
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
          notFound: false,
          outputTruncated: true,
        },
        `Command output exceeded buffer limit (${limitMb} MB): ${`${cmd} ${args.join(' ')}`.trim()}`,
      ),
    }
  }

  // SIGTERM alone is an unreliable timeout signal — an external `kill` or a
  // parent-shell teardown also surfaces SIGTERM. Cross-check duration so the
  // "timeout" classification fires only when the run plausibly hit the deadline
  // (within 1s for jitter). (#277 finding #14)
  const sigtermLikelyTimeout = obs.signal === 'SIGTERM' && obs.durationMs >= obs.timeoutMs - 1000
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

  if (errorCode !== undefined) {
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
          notFound: false,
        },
        `Command failed to start (${errorCode}): ${cmd}`,
      ),
    }
  }

  if (obs.status !== 0) {
    return {
      ok: false,
      fatal: false,
      error: new CliError({
        cmd,
        args,
        exitCode: obs.status ?? -1,
        stdout,
        stderr,
        timedOut: false,
        notFound: false,
      }),
    }
  }

  return { ok: true, result: { stdout, stderr, exitCode: 0, durationMs: obs.durationMs } }
}

function runOnce(cmd: string, args: readonly string[], opts: RunOnceOptions): Attempt {
  const start = Date.now()
  const result = spawnSync(cmd, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    input: opts.input,
    maxBuffer: opts.maxBufferBytes,
    encoding: 'utf-8',
    shell: false,
  })
  return classifyAttempt({
    cmd,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    errorCode: (result.error as NodeJS.ErrnoException | undefined)?.code,
    status: result.status,
    signal: result.signal,
    durationMs: Date.now() - start,
    timeoutMs: opts.timeoutMs,
    maxBufferBytes: opts.maxBufferBytes,
  })
}

/** Resolved per-invocation config for {@link runCli}. */
interface NormalizedRunOpts {
  runOpts: RunOnceOptions
  retries: number
  retryDelayMs: number
}

function normalizeOpts(opts: RunCliOptions): NormalizedRunOpts {
  return {
    runOpts: {
      cwd: opts.cwd,
      env: opts.env,
      input: opts.input,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBufferBytes: opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    },
    retries: opts.retries ?? 0,
    retryDelayMs: opts.retryDelayMs ?? 500,
  }
}

/**
 * Decide what a single attempt's outcome means for the retry loop. Returns the
 * success result when done, `null` to keep retrying (after recording the error),
 * and throws immediately on a fatal (non-retryable) failure. Shared verbatim by
 * the sync and async runners so their semantics cannot drift.
 */
function settleAttempt(
  cmd: string,
  outcome: Attempt,
  attemptErrors: CliError[],
): RunCliResult | null {
  if (outcome.ok) {
    logRetrySuccess(cmd, attemptErrors)
    return outcome.result
  }
  if (outcome.fatal) throw outcome.error
  attemptErrors.push(outcome.error)
  return null
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
  const { runOpts, retries, retryDelayMs } = normalizeOpts(opts)
  const attemptErrors: CliError[] = []
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = settleAttempt(cmd, runOnce(cmd, args, runOpts), attemptErrors)
    if (result) return result
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
  getLogger().warn(
    'run_cli.retry_succeeded',
    {
      cmd,
      attempts: attemptErrors.length,
      first_error: attemptErrors[0]?.message ?? '(none)',
    },
    `runCli: ${cmd} succeeded after ${attemptErrors.length} failed attempt(s)`,
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
    getLogger().warn(
      'run_cli.retries_exhausted',
      { cmd, attempts: attemptErrors.length, final_error: last.message },
      `runCli: ${cmd} failed after ${attemptErrors.length} attempt(s)`,
    )
  }
  return last
}

/**
 * Run an interactive CLI command whose stdin/stdout/stderr
 * are inherited from the parent process so the child can take over the TTY.
 * Returns the child's exit status.
 */
interface RunInteractiveOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Extra parent fds mapped to child fd 3 onward. */
  extraFds?: readonly number[]
  /** Start the child as a process-group leader. */
  detached?: boolean
  /** Kill the child's process group when the child itself dies by signal. */
  teardownProcessGroupOnSignal?: boolean
  /** Tear down the child and tracked descendants before handling a parent signal. */
  teardownOnParentSignal?: boolean
  /**
   * Path held open by every descendant through a non-lock fd. After process-group
   * teardown, kill holders that escaped that group (Linux `/proc` only).
   */
  trackedDescendantFdPath?: string
}

async function killAndWaitForProcessGroup(pid: number): Promise<void> {
  let warned = false
  for (;;) {
    try {
      process.kill(-pid, 'SIGKILL')
      process.kill(-pid, 0)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return
      if (!warned) {
        process.stderr.write(
          `gate-exec: cannot kill process group ${pid}; retaining the mutex and retrying\n`,
        )
        warned = true
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Return PIDs holding `path` open, or null when procfs is unavailable. */
function procFileHolders(path: string): number[] | null {
  let entries: string[]
  try {
    entries = readdirSync('/proc')
    // FAIL-OPEN-INTENT: procfs is Linux-only; process-group teardown already ran and the warning below exposes the reduced cleanup scope.
  } catch {
    return null
  }

  const holders: number[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    let fds: string[]
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
      // FAIL-OPEN-INTENT: an unreadable or vanished PID must not prevent scanning the remaining processes.
    } catch {
      continue
    }
    for (const fd of fds) {
      try {
        if (readlinkSync(`/proc/${pid}/fd/${fd}`) !== path) continue
        holders.push(pid)
        break
        // FAIL-OPEN-INTENT: process/fd disappeared between directory read and readlink; keep scanning live descriptors.
      } catch {
        continue
      }
    }
  }
  return holders
}

async function killAndWaitForTrackedDescendants(path: string): Promise<void> {
  let warned = false
  for (;;) {
    const holders = procFileHolders(path)
    if (holders === null) {
      process.stderr.write(
        'gate-exec: warning: /proc unavailable; escaped descendant cleanup is limited to the supervisor process group\n',
      )
      return
    }
    if (holders.length === 0) return
    let killFailed = false
    for (const pid of holders) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') continue
        if (!warned) {
          process.stderr.write(
            `gate-exec: cannot kill tracked descendant ${pid}; retaining the mutex and retrying\n`,
          )
          warned = true
        }
        killFailed = true
      }
    }
    await new Promise((resolve) => setTimeout(resolve, killFailed ? 100 : 10))
  }
}

export function runInteractive(
  cmd: string,
  args: readonly string[],
  opts: RunInteractiveOptions = {},
): Promise<{ exitCode: number }> {
  const stdio: StdioOptions = opts.extraFds
    ? ['inherit', 'inherit', 'inherit', ...opts.extraFds]
    : 'inherit'
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio,
      shell: false,
      detached: opts.detached,
    })
    let parentSignal: 'SIGHUP' | 'SIGINT' | 'SIGTERM' | undefined
    let teardownPromise: Promise<void> | undefined
    const teardown = (): Promise<void> => {
      if (teardownPromise !== undefined) return teardownPromise
      teardownPromise = (async () => {
        if (child.pid !== undefined) await killAndWaitForProcessGroup(child.pid)
        if (opts.trackedDescendantFdPath !== undefined) {
          await killAndWaitForTrackedDescendants(opts.trackedDescendantFdPath)
        }
      })()
      return teardownPromise
    }
    const parentSignalHandlers = new Map<NodeJS.Signals, () => void>()
    const removeParentSignalHandlers = (): void => {
      for (const [signal, handler] of parentSignalHandlers) {
        process.removeListener(signal, handler)
      }
    }
    if (opts.teardownOnParentSignal) {
      for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
        const handler = (): void => {
          parentSignal ??= signal
          void teardown().catch(reject)
        }
        parentSignalHandlers.set(signal, handler)
        process.once(signal, handler)
      }
    }
    child.once('error', (err: NodeJS.ErrnoException) => {
      removeParentSignalHandlers()
      if (err.code !== 'ENOENT') {
        resolve({ exitCode: 1 })
        return
      }
      reject(
        new CliError(
          {
            cmd,
            args,
            exitCode: -1,
            stdout: '',
            stderr: '',
            timedOut: false,
            notFound: true,
          },
          `Command not found: ${cmd}`,
        ),
      )
    })
    child.once('close', (code, signal) => {
      const finish = async (): Promise<void> => {
        if (parentSignal !== undefined || (signal && opts.teardownProcessGroupOnSignal)) {
          await teardown()
        }
        removeParentSignalHandlers()
        const signalExitCode = parentSignal
          ? 128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[parentSignal]
          : undefined
        resolve({ exitCode: signalExitCode ?? code ?? 1 })
      }
      void finish().catch(reject)
    })
  })
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
