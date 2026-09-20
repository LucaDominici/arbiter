#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { arg } from './lib/gate-args.mjs'
import { buildCodexArgs } from './lib/codex-dispatch-lib.mjs'

const argv = process.argv.slice(2)
const required = ['worktree', 'model', 'effort', 'brief', 'out']
const values = Object.fromEntries(required.map((name) => [name, arg(name, argv)]))

if (required.some((name) => values[name] === null)) {
  process.stderr.write(
    'Usage: codex-dispatch --worktree <path> --model <model> --effort <effort> --brief <path> --out <path> [--resume <session-id>]\n',
  )
  process.exit(2)
}

try {
  const worktreePath = realpathSync(values.worktree)
  mkdirSync(join(worktreePath, 'node_modules', '.vite-temp'), { recursive: true })
  const resumeSessionId = arg('resume', argv) ?? undefined
  const gitDir = resumeSessionId
    ? undefined
    : execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: worktreePath,
        encoding: 'utf8',
      }).trim()
  const commonGitDir = resumeSessionId
    ? undefined
    : execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: worktreePath,
        encoding: 'utf8',
      }).trim()
  const briefText = readFileSync(values.brief, 'utf8')
  const result = spawnSync(
    'codex',
    buildCodexArgs({
      worktreePath,
      model: values.model,
      effort: values.effort,
      gitDir,
      commonGitDir,
      briefText,
      outPath: values.out,
      resumeSessionId,
    }),
    { cwd: worktreePath, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 2)
} catch (err) {
  process.stderr.write(`codex-dispatch failed: ${err.message}\n`)
  process.exit(1)
}
