// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1040): arbiter verify sub-commands — spawn the real CLI
// binary and assert observable output/exit-code invariants.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[], cwd?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

describe('arbiter verify — sub-command surface', () => {
  it('verify --help exits 0 and lists sub-commands', () => {
    const { status, stdout } = spawn(['verify', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('evidence')
    expect(stdout).toContain('tdd')
  })

  it('verify exits 0 in a TypeScript project', () => {
    const { status, stdout, stderr } = spawn(['verify'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout + stderr).toContain('typescript')
  })

  it('verify --json exits 0 and emits JSON', () => {
    const { status, stdout, stderr } = spawn(['verify', '--json'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed).toHaveProperty('stack')
    expect(parsed).toHaveProperty('probes')
  })

  it('verify tdd --help exits 0 and mentions task-id', () => {
    const { status, stdout } = spawn(['verify', 'tdd', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('task-id')
  })

  it('verify tdd exits non-zero for a nonexistent task ID', () => {
    const { status } = spawn(['verify', 'tdd', '#9999999'])
    expect(status).not.toBe(0)
  })

  it('verify graph --help exits 0', () => {
    const { status, stdout } = spawn(['verify', 'graph', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('provenance')
  })
})
