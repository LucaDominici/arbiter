// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function trackedClaudeSnapshot(root: string): Map<string, string> {
  const result = spawnSync('git', ['ls-files', '-z', '--', '.claude'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0 || result.signal !== null || !result.stdout?.endsWith('\0')) {
    throw result.error ?? new Error(`git ls-files failed: ${result.stderr}`)
  }
  const files = result.stdout.split('\0').filter(Boolean)

  return new Map(
    files.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(resolve(root, file)))
        .digest('hex'),
    ]),
  )
}

export default function setup(): () => void {
  const root = resolve('.')
  const before = trackedClaudeSnapshot(root)

  return () => {
    const after = trackedClaudeSnapshot(root)
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (file) => before.get(file) !== after.get(file),
    )
    if (changed.length > 0) {
      process.exitCode = 1
      throw new Error(`Vitest mutated tracked .claude files:\n${changed.join('\n')}`)
    }
  }
}
