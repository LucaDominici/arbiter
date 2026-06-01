// SPDX-License-Identifier: Apache-2.0
// Structured CLI logger (#635, R1.M1).
//
// Diagnostic logging for arbiter CLI. Writes to stderr so stdout stays clean
// for command payloads (jsonOutput, prompt responses). Hybrid singleton:
// a global default plus an AsyncLocalStorage scope for runId correlation
// across nested invocations or subprocesses that share the same logger import.

import { AsyncLocalStorage } from 'node:async_hooks'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'
export type LogFormat = 'text' | 'json'

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
}

export interface LoggerOptions {
  level: LogLevel
  format: LogFormat
  runId?: string
  stream?: NodeJS.WritableStream
}

export interface LogAttrs {
  [key: string]: string | number | boolean | null | undefined
}

interface ResolvedOptions extends Required<Omit<LoggerOptions, 'runId'>> {
  runId: string | undefined
}

interface RunContext {
  runId: string
}

const runContext = new AsyncLocalStorage<RunContext>()

export class Logger {
  private opts: ResolvedOptions

  constructor(opts: LoggerOptions) {
    this.opts = {
      level: opts.level,
      format: opts.format,
      runId: opts.runId,
      stream: opts.stream ?? process.stderr,
    }
  }

  error(event: string, attrs?: LogAttrs, msg?: string): void {
    this.emit('error', event, attrs, msg)
  }

  warn(event: string, attrs?: LogAttrs, msg?: string): void {
    this.emit('warn', event, attrs, msg)
  }

  info(event: string, attrs?: LogAttrs, msg?: string): void {
    this.emit('info', event, attrs, msg)
  }

  debug(event: string, attrs?: LogAttrs, msg?: string): void {
    this.emit('debug', event, attrs, msg)
  }

  trace(event: string, attrs?: LogAttrs, msg?: string): void {
    this.emit('trace', event, attrs, msg)
  }

  getRunId(): string | undefined {
    return runContext.getStore()?.runId ?? this.opts.runId
  }

  private emit(level: LogLevel, event: string, attrs?: LogAttrs, msg?: string): void {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.opts.level]) return
    const runId = this.getRunId()
    const line =
      this.opts.format === 'json'
        ? formatJson(level, event, runId, attrs, msg)
        : formatText(level, event, runId, attrs, msg)
    this.opts.stream.write(line + '\n')
  }
}

function formatJson(
  level: LogLevel,
  event: string,
  runId: string | undefined,
  attrs: LogAttrs | undefined,
  msg: string | undefined,
): string {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
  }
  if (runId !== undefined) record.runId = runId
  if (msg !== undefined) record.msg = msg
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && !(k in record)) record[k] = v
    }
  }
  return JSON.stringify(record)
}

function formatText(
  level: LogLevel,
  event: string,
  runId: string | undefined,
  attrs: LogAttrs | undefined,
  msg: string | undefined,
): string {
  const parts: string[] = [`[${level}]`, event]
  if (msg !== undefined) parts.push(msg)
  if (runId !== undefined) parts.push(`runId=${runId}`)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined) continue
      parts.push(`${k}=${String(v)}`)
    }
  }
  return parts.join(' ')
}

// ─── Singleton accessor ───────────────────────────────────────────────────────

let rootLogger: Logger = new Logger({ level: 'info', format: 'text' })

export function setRootLogger(opts: LoggerOptions): Logger {
  rootLogger = new Logger(opts)
  return rootLogger
}

export function getLogger(): Logger {
  return rootLogger
}
