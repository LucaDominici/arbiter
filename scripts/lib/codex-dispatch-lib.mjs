// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function gitPath(worktreePath, args) {
  return execFileSync('git', args, { cwd: worktreePath, encoding: 'utf8' }).trim()
}

function commonArgs({ model, effort, outPath }) {
  return [
    '-m',
    model,
    '-c',
    `model_reasoning_effort=${effort}`,
    '-c',
    'approval_policy=never',
    '-o',
    outPath,
  ]
}

/** Build argv for a Codex writer dispatch. */
export function buildCodexArgs({
  worktreePath,
  model,
  effort,
  briefPath,
  outPath,
  resumeSessionId,
}) {
  const args = resumeSessionId ? ['exec', 'resume', resumeSessionId] : ['exec']
  args.push(...commonArgs({ model, effort, outPath }))
  if (!resumeSessionId) {
    args.push(
      '-s',
      'workspace-write',
      '--add-dir',
      gitPath(worktreePath, ['rev-parse', '--absolute-git-dir']),
      '--add-dir',
      gitPath(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      '--add-dir',
      join(worktreePath, 'node_modules', '.vite-temp'),
    )
  }
  args.push(readFileSync(briefPath, 'utf8'))
  return args
}

/** Build argv for a read-only Codex reviewer dispatch. */
export function buildCodexReviewArgs({ model, effort, outPath }) {
  return ['exec', ...commonArgs({ model, effort, outPath }), '-s', 'read-only']
}
