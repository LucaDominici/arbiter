// SPDX-License-Identifier: Apache-2.0
// Resolve logger level/format from CLI flags and environment variables (#635).
// Flag wins over env; env wins over default. Invalid values fall back to default
// and emit a warning to stderr (since logger may not be wired up yet).

import type { LogLevel, LogFormat } from './logger.js'

const VALID_LEVELS: ReadonlySet<string> = new Set(['error', 'warn', 'info', 'debug', 'trace'])
const VALID_FORMATS: ReadonlySet<string> = new Set(['text', 'json'])

const DEFAULT_LEVEL: LogLevel = 'info'
const DEFAULT_FORMAT: LogFormat = 'text'

export interface LoggerConfigInputs {
  flagLevel?: string
  flagFormat?: string
  envLevel?: string
  envFormat?: string
}

export interface ResolvedLoggerConfig {
  level: LogLevel
  format: LogFormat
}

function pickLevel(flag: string | undefined, env: string | undefined): LogLevel {
  for (const candidate of [flag, env]) {
    if (candidate === undefined) continue
    const lowered = candidate.toLowerCase()
    if (VALID_LEVELS.has(lowered)) return lowered as LogLevel
    process.stderr.write(`[warn] ignoring invalid log level: ${candidate}\n`)
  }
  return DEFAULT_LEVEL
}

function pickFormat(flag: string | undefined, env: string | undefined): LogFormat {
  for (const candidate of [flag, env]) {
    if (candidate === undefined) continue
    const lowered = candidate.toLowerCase()
    if (VALID_FORMATS.has(lowered)) return lowered as LogFormat
    process.stderr.write(`[warn] ignoring invalid log format: ${candidate}\n`)
  }
  return DEFAULT_FORMAT
}

export function resolveLoggerConfig(inputs: LoggerConfigInputs): ResolvedLoggerConfig {
  return {
    level: pickLevel(inputs.flagLevel, inputs.envLevel),
    format: pickFormat(inputs.flagFormat, inputs.envFormat),
  }
}

export function resolveFromProcess(argv: string[], env: NodeJS.ProcessEnv): ResolvedLoggerConfig {
  const inputs: LoggerConfigInputs = {}
  const flagLevel = extractFlagValue(argv, '--log-level')
  if (flagLevel !== undefined) inputs.flagLevel = flagLevel
  const flagFormat = extractFlagValue(argv, '--log-format')
  if (flagFormat !== undefined) inputs.flagFormat = flagFormat
  if (env.ARBITER_LOG_LEVEL !== undefined) inputs.envLevel = env.ARBITER_LOG_LEVEL
  if (env.ARBITER_LOG_FORMAT !== undefined) inputs.envFormat = env.ARBITER_LOG_FORMAT
  return resolveLoggerConfig(inputs)
}

function extractFlagValue(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === flag) return argv[i + 1]
    if (arg !== undefined && arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return undefined
}
