#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
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
  const result = spawnSync(
    'codex',
    buildCodexArgs({
      worktreePath,
      model: values.model,
      effort: values.effort,
      briefPath: values.brief,
      outPath: values.out,
      resumeSessionId: arg('resume', argv) ?? undefined,
    }),
    { cwd: worktreePath, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 2)
} catch (err) {
  process.stderr.write(`codex-dispatch failed: ${err.message}\n`)
  process.exit(1)
}
