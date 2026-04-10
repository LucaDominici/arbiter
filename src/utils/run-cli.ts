import { spawnSync } from "node:child_process";

export interface RunCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  input?: string;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface CliErrorDetails {
  cmd: string;
  args: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export class CliError extends Error {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(details: CliErrorDetails, message?: string) {
    super(message ?? formatMessage(details));
    this.name = "CliError";
    this.cmd = details.cmd;
    this.args = details.args;
    this.exitCode = details.exitCode;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.timedOut = details.timedOut;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

type Attempt =
  | { ok: true; result: RunCliResult }
  | { ok: false; error: CliError; fatal: boolean };

interface RunOnceOptions {
  cwd: string | undefined;
  env: NodeJS.ProcessEnv | undefined;
  input: string | undefined;
  timeoutMs: number;
}

function runOnce(
  cmd: string,
  args: readonly string[],
  opts: RunOnceOptions,
): Attempt {
  const start = Date.now();
  const result = spawnSync(cmd, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    input: opts.input,
    encoding: "utf-8",
    shell: false,
  });
  const durationMs = Date.now() - start;

  const stdout = result.stdout;
  const stderr = result.stderr;
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;

  if (errorCode === "ENOENT") {
    return {
      ok: false,
      fatal: true,
      error: new CliError(
        { cmd, args, exitCode: -1, stdout, stderr, timedOut: false },
        `Command not found: ${cmd}`,
      ),
    };
  }

  const timedOut = errorCode === "ETIMEDOUT" || result.signal === "SIGTERM";
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
      }),
    };
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
      }),
    };
  }

  return { ok: true, result: { stdout, stderr, exitCode: 0, durationMs } };
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
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? 0;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const runOpts = {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input,
    timeoutMs,
  };

  let lastError: CliError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const outcome = runOnce(cmd, args, runOpts);
    if (outcome.ok) return outcome.result;
    if (outcome.fatal) throw outcome.error;

    lastError = outcome.error;
    if (attempt < retries) sleepSync(retryDelayMs);
  }

  throw lastError as CliError;
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
  const result = runCli(cmd, args, opts);
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new CliError(
      {
        cmd,
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: false,
      },
      `Invalid JSON output from ${cmd}: ${(err as Error).message}`,
    );
  }
}

function formatMessage(details: CliErrorDetails): string {
  const cmdStr = `${details.cmd} ${details.args.join(" ")}`.trim();
  if (details.timedOut) {
    return `Command timed out: ${cmdStr}`;
  }
  const preview = details.stderr.trim().slice(0, 500);
  return `Command failed (exit ${details.exitCode}): ${cmdStr}${
    preview ? `\n${preview}` : ""
  }`;
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}
