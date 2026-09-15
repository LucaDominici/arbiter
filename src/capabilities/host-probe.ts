// SPDX-License-Identifier: Apache-2.0
import { lstatSync, realpathSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runCli } from '../utils/run-cli.js'
import { readFileTranslated } from '../utils/fs.js'

export interface HostCapabilities {
  modelSwitch: boolean
  transcriptPath: string | null
}

export interface NativeHostBinding {
  worktreePath: string
  branch: string
  sessionId: string
  transcriptPath: string
}

export interface NativeHostContext {
  cwd?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/

export function encodeClaudeProjectPath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

function git(cwd: string, args: string[]): string {
  return runCli('git', args, { cwd, timeoutMs: 5000 }).stdout.trim()
}

function readOpenLog(worktree: string): unknown[] {
  const commonDir = resolve(worktree, git(worktree, ['rev-parse', '--git-common-dir']))
  const path = join(dirname(commonDir), '.arbiter', 'worktree-open.log.json')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('worktree-open log is not a regular file')
  const parsed: unknown = JSON.parse(readFileTranslated(path, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('worktree-open log is malformed')
  return parsed
}

export function resolveNativeHostBinding(
  taskId: string,
  requestedWorktree: string,
  context: NativeHostContext = {},
): NativeHostBinding {
  const worktreePath = realpathSync(requestedWorktree)
  const cwd = realpathSync(context.cwd ?? process.cwd())
  if (cwd !== worktreePath) {
    throw new Error(`native host root ${cwd} does not match worktree ${worktreePath}`)
  }
  const branch = git(worktreePath, ['branch', '--show-current'])
  const canonicalTask = taskId.startsWith('#') ? taskId : `#${taskId}`
  const matches = readOpenLog(worktreePath).filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>)['taskId'] === canonicalTask &&
      (entry as Record<string, unknown>)['worktreePath'] === worktreePath &&
      (entry as Record<string, unknown>)['branch'] === branch,
  )
  if (matches.length !== 1) {
    throw new Error(`exact worktree binding for ${canonicalTask} is missing or ambiguous`)
  }
  const env = context.env ?? process.env
  assertClaudeProjectDir(worktreePath, env['CLAUDE_PROJECT_DIR'])
  const sessionId = env['CLAUDE_CODE_SESSION_ID']
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw new Error('native host binding requires a valid CLAUDE_CODE_SESSION_ID')
  }
  const transcriptPath = join(
    context.homeDir ?? homedir(),
    '.claude',
    'projects',
    encodeClaudeProjectPath(worktreePath),
    `${sessionId}.jsonl`,
  )
  const transcriptStat = lstatSync(transcriptPath)
  if (!transcriptStat.isFile() || transcriptStat.isSymbolicLink()) {
    throw new Error('native host transcript is not a regular file')
  }
  if (realpathSync(transcriptPath) !== resolve(transcriptPath)) {
    throw new Error('native host transcript resolves through a symlink')
  }
  return { worktreePath, branch, sessionId, transcriptPath }
}

function assertClaudeProjectDir(worktreePath: string, projectDir: string | undefined): void {
  if (projectDir) {
    let projectPath
    try {
      projectPath = realpathSync(projectDir)
    } catch {
      throw new Error('CLAUDE_PROJECT_DIR is not a readable project directory')
    }
    if (projectPath !== worktreePath) {
      throw new Error(`CLAUDE_PROJECT_DIR ${projectPath} does not match worktree ${worktreePath}`)
    }
  }
}

function isTruthy(val: string | undefined): boolean {
  return !!val && val !== '0' && val !== 'false'
}

function findTranscriptPath(): string | null {
  try {
    const cwd = process.cwd()
    const encoded = encodeURIComponent(cwd).replace(/%2F/g, '-').replace(/^-/, '')
    const projectsDir = join(homedir(), '.claude', 'projects')
    const entries = readdirSync(projectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.includes(encoded.slice(0, 20))) continue
      const dir = join(projectsDir, entry.name)
      const files = readdirSync(dir)
      const jsonl = files.find((f) => f.endsWith('.jsonl'))
      if (jsonl) return join(dir, jsonl)
    }
    return null
  } catch {
    return null
  }
}

export function detectHostCapabilities(): HostCapabilities {
  try {
    const modelSwitch = isTruthy(process.env['CLAUDECODE'])
    return {
      modelSwitch,
      transcriptPath: findTranscriptPath(),
    }
  } catch (err: unknown) {
    process.stderr.write(
      `[arbiter] warn: detectHostCapabilities threw unexpectedly: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return { modelSwitch: false, transcriptPath: null }
  }
}
