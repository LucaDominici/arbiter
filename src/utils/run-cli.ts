// SPDX-License-Identifier: Apache-2.0
import { spawn, spawnSync } from 'node:child_process'
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
 * Grace period after SIGTERM before the async runner escalates to SIGKILL.
 * A child that traps or ignores SIGTERM (graceful-shutdown handlers are common
 * in CLIs) would otherwise never exit, never emit `'close'`, and leave the
 * runCliAsync Promise unsettled — defeating the timeout entirely (#1581). The
 * sync runner does not need this: `spawnSync({ timeout })` escalates natively.
 */
const KILL_GRACE_MS = 2_000

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
 * Classify a finished child run into a retry-loop {@link Attempt}. Shared by the
 * sync (`spawnSync`) and async (`spawn`) runners so their error taxonomy —
 * not-found, output-overflow, timeout, non-zero exit — stays byte-identical.
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

/**
 * Non-blocking sibling of {@link runOnce}, backed by `child_process.spawn`.
 * Accumulates stdout/stderr, enforces the same byte cap (`spawn` has no native
 * `maxBuffer`), and applies the timeout via a watchdog timer. Resolves to an
 * {@link Attempt} on `'close'` and never rejects — spawn-time errors (ENOENT)
 * arrive on `'error'` and are folded into the same classifier as the sync path.
 */
function runOnceAsync(
  cmd: string,
  args: readonly string[],
  opts: RunOnceOptions,
): Promise<Attempt> {
  return new Promise<Attempt>((resolve) => {
    const start = Date.now()
    const child = spawn(cmd, [...args], { cwd: opts.cwd, env: opts.env, shell: false })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let overflow = false
    let timedOut = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const settle = (
      obs: Omit<AttemptObservation, 'cmd' | 'args' | 'timeoutMs' | 'maxBufferBytes'>,
    ): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // A clean 'close' cancels any pending SIGKILL escalation.
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolve(
        classifyAttempt({
          ...obs,
          cmd,
          args,
          timeoutMs: opts.timeoutMs,
          maxBufferBytes: opts.maxBufferBytes,
        }),
      )
    }

    // SIGTERM, then escalate to SIGKILL after a grace period if the child does
    // not exit — a child that traps/ignores SIGTERM would otherwise never emit
    // 'close' and hang this Promise forever, defeating the timeout (#1581). The
    // grace timer is armed at most once and unref'd so it never holds the event
    // loop open on its own.
    const terminate = (): void => {
      child.kill('SIGTERM')
      if (killTimer !== undefined) return
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      if (typeof killTimer.unref === 'function') killTimer.unref()
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, opts.timeoutMs)
    // Do not let the watchdog keep the event loop alive on its own.
    if (typeof timer.unref === 'function') timer.unref()

    // With default 'pipe' stdio, stdout/stderr/stdin are always present.
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > opts.maxBufferBytes) {
        overflow = true
        terminate()
        return
      }
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk)
      if (stderrBytes > opts.maxBufferBytes) {
        overflow = true
        terminate()
        return
      }
      stderr += chunk
    })

    if (opts.input !== undefined) {
      // Ignore EPIPE if the child exits before consuming all input.
      child.stdin.on('error', () => {})
      child.stdin.end(opts.input)
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      settle({
        stdout,
        stderr,
        errorCode: err.code ?? 'ESPAWN',
        status: null,
        signal: null,
        durationMs: Date.now() - start,
      })
    })

    child.on('close', (code, signal) => {
      // Map self-inflicted kills onto the errno codes the classifier expects so
      // overflow/timeout are reported identically to the sync path.
      const errorCode = overflow ? 'ENOBUFS' : timedOut ? 'ETIMEDOUT' : undefined
      settle({
        stdout,
        stderr,
        errorCode,
        status: code,
        signal,
        durationMs: Date.now() - start,
      })
    })
  })
}

/** Resolved per-invocation config shared by the sync and async runners. */
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
 * Async sibling of {@link runCli}, backed by `child_process.spawn` instead of
 * the event-loop-blocking `spawnSync`. Identical timeout/retry/CliError
 * semantics, but the child runs without stalling the event loop — so N calls
 * launched together (e.g. `Promise.allSettled(prompts.map(...))`) are genuinely
 * concurrent rather than serialized. Use this for fan-out workloads such as the
 * multi-agent reviewer (#1514); keep the sync `runCli` for paths that must
 * block (sequential plan-review, simple one-shot shell-outs).
 */
export async function runCliAsync(
  cmd: string,
  args: readonly string[],
  opts: RunCliOptions = {},
): Promise<RunCliResult> {
  const { runOpts, retries, retryDelayMs } = normalizeOpts(opts)
  const attemptErrors: CliError[] = []
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = settleAttempt(cmd, await runOnceAsync(cmd, args, runOpts), attemptErrors)
    if (result) return result
    if (attempt < retries) await sleepAsync(retryDelayMs)
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
 * Run an interactive CLI command (e.g. `$EDITOR`) whose stdin/stdout/stderr
 * are inherited from the parent process so the child can take over the TTY.
 * Returns the child's exit status. Used by `arbiter report` to spawn the
 * user's editor for manifest review before bundling.
 */
export function runInteractive(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { exitCode: number } {
  const result = spawnSync(cmd, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: 'inherit',
    shell: false,
  })
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new CliError(
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
    )
  }
  return { exitCode: result.status ?? 1 }
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

function sleepAsync(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms))
}
