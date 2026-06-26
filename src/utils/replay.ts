// SPDX-License-Identifier: Apache-2.0
// Replay log capture for arbiter CLI invocations (#638, R1.M4).
//
// Scope (matches design decision B):
//   - Captures argv, redacted env, command output, and a snapshot of the
//     arbiter-only state surface (`.arbiter/` listing + `arbiter.json`).
//   - Writes synchronously on close so the process never blocks on flush.
//   - LRU rotation keeps the N most-recent run directories.
//   - --no-replay opt-out is enforced upstream in cli.ts; this module is
//     only invoked when replay is enabled.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { walkDir } from './walk-dir.js'

export interface ReplayInputs {
  runId: string
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  cwd: string
  baseDir?: string
}

export interface ReplayHandle {
  runId: string
  dir: string
  output: string[]
  append(chunk: string): void
  close(exitCode: number): void
}

const REDACTED = '***REDACTED***'
const REDACTABLE_WORDS = new Set([
  'TOKEN',
  'SECRET',
  'KEY',
  'PASSWORD',
  'PASS',
  'AUTH',
  'CREDENTIAL',
  'CREDENTIALS',
  'PRIVATE',
  'API',
  // `*_DSN` carries a project secret (e.g. SENTRY_DSN's public key) even when the
  // value has no `user:pass@` userinfo, so the value pass below cannot catch it (#1573).
  'DSN',
])
const REDACTION_PREFIX_RE = /^(GH_|GITHUB_|NPM_)/i
// Strong compound secret words, matched even without an underscore boundary so a
// run-together key like `APIKEY` redacts the same as `API_KEY` (#1573). Deliberately
// omits short ambiguous words (KEY/PASS/AUTH/API) to avoid MONKEY/COMPASS/AUTHOR-class
// false positives; those stay segment-bounded via REDACTABLE_WORDS.
const COMPOUND_SECRET_RE = /TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|PRIVATEKEY|CREDENTIAL/
// A connection string carrying `scheme://user:password@host` userinfo embeds a secret
// in its VALUE regardless of the key name — the single most common way DB/cache/broker
// credentials leak (DATABASE_URL, REDIS_URL, MONGODB_URI, AMQP_URL, …) (#1573).
const URL_USERINFO_RE = /:\/\/[^/@\s]+:[^/@\s]+@/

function defaultReplayBaseDir(): string {
  return join(homedir(), '.arbiter', 'logs')
}

export function shouldRedactKey(key: string): boolean {
  if (REDACTION_PREFIX_RE.test(key)) return true
  const upper = key.toUpperCase()
  if (COMPOUND_SECRET_RE.test(upper)) return true
  return upper.split('_').some((seg) => REDACTABLE_WORDS.has(seg))
}

export function redactEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    // Redact on a key-name match OR a value that embeds `user:pass@` userinfo — the
    // latter catches credential-bearing connection strings whose key name (e.g.
    // DATABASE_URL) trips none of the keyword heuristics.
    out[k] = shouldRedactKey(k) || URL_USERINFO_RE.test(v) ? REDACTED : v
  }
  return out
}

const SENSITIVE_FLAGS = ['--gh-token', '--api-key', '--token', '--password', '--secret']

function redactArgv(argv: readonly string[]): string[] {
  return argv.map((arg, i) => {
    const prev = argv[i - 1] ?? ''
    if (SENSITIVE_FLAGS.some((f) => prev === f)) return '[REDACTED]'
    const matched = SENSITIVE_FLAGS.find((f) => arg.startsWith(f + '='))
    if (matched !== undefined) return `${matched}=[REDACTED]`
    return arg
  })
}

function snapshotArbiterState(cwd: string): Record<string, unknown> {
  const snap: Record<string, unknown> = {}
  const configPath = join(cwd, 'arbiter.json')
  if (existsSync(configPath)) {
    try {
      snap.arbiterJson = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown
    } catch {
      snap.arbiterJson = { _error: 'unreadable' }
    }
  }
  const arbiterDir = join(cwd, '.arbiter')
  if (existsSync(arbiterDir)) {
    // Symlink-safe by construction (Dirent walk never descends symlinked dirs). #1521.
    snap.arbiterDir = walkDir(arbiterDir, { base: arbiterDir }).sort()
  }
  return snap
}

export function startReplay(inputs: ReplayInputs): ReplayHandle {
  const baseDir = inputs.baseDir ?? defaultReplayBaseDir()
  const dir = resolve(baseDir, inputs.runId)
  mkdirSync(dir, { recursive: true })
  const output: string[] = []

  writeFileSync(join(dir, 'command.txt'), redactArgv(inputs.argv).join(' ') + '\n')
  writeFileSync(join(dir, 'env.json'), JSON.stringify(redactEnv(inputs.env), null, 2))
  writeFileSync(
    join(dir, 'state-before.json'),
    JSON.stringify(snapshotArbiterState(inputs.cwd), null, 2),
  )

  return {
    runId: inputs.runId,
    dir,
    output,
    append(chunk: string): void {
      output.push(chunk)
    },
    close(exitCode: number): void {
      writeFileSync(join(dir, 'output.log'), output.join(''))
      const after = {
        exitCode,
        ts: new Date().toISOString(),
        ...snapshotArbiterState(inputs.cwd),
      }
      writeFileSync(join(dir, 'state-after.json'), JSON.stringify(after, null, 2))
    },
  }
}

export interface RotateOptions {
  baseDir?: string
  capN: number
}

export function rotateReplayLogs(opts: RotateOptions): string[] {
  const baseDir = opts.baseDir ?? defaultReplayBaseDir()
  if (!existsSync(baseDir)) return []
  const entries = readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const full = join(baseDir, e.name)
      const stat = statSync(full)
      return { name: e.name, full, mtime: stat.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  if (entries.length <= opts.capN) return []
  const evicted: string[] = []
  for (const entry of entries.slice(opts.capN)) {
    try {
      rmSync(entry.full, { recursive: true, force: true })
      evicted.push(entry.name)
    } catch {
      // skip — rotation is best-effort, never blocks CLI exit
    }
  }
  return evicted
}
