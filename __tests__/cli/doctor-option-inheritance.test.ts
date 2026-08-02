// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const roots: string[] = []
const CLI = resolve('src/cli.ts')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function run(args: string[], cwd: string) {
  return spawnSync('npx', ['tsx', CLI, ...args], { cwd, encoding: 'utf-8', timeout: 30_000 })
}

describe('doctor subcommand option inheritance (#2165)', () => {
  it('uses subcommand --dir and --json for repair-state instead of the caller cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-options-'))
    roots.push(root)
    const target = join(root, 'target')
    const outside = join(root, 'outside')
    mkdirSync(target)
    mkdirSync(outside)
    writeFileSync(join(target, 'arbiter.json'), readFileSync(resolve('arbiter.json'), 'utf-8'))

    const result = run(['doctor', 'repair-state', '--dir', target, '--json'], outside)
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).command).toBe('doctor repair-state')
  })

  it.each(['recover-lock', 'clean'])(
    'emits the real JSON envelope for doctor %s --json',
    (command) => {
      const root = mkdtempSync(join(tmpdir(), 'arbiter-doctor-json-'))
      roots.push(root)
      const result = run(['doctor', command, '--json'], root)
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).command).toBe(`doctor ${command}`)
    },
  )
})
