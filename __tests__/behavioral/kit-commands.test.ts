// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1040): arbiter kit sub-commands — spawn the real CLI binary
// and assert observable output/exit-code invariants.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

function spawn(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 30_000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

describe('arbiter kit — sub-command surface', () => {
  it('kit --help exits 0 and describes the kit command', () => {
    const { status, stdout } = spawn(['kit', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('kit')
  })

  it('kit validate exits 0 and reports dim count', () => {
    const { status, stdout, stderr } = spawn(['kit', 'validate', '--experimental.kit'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout + stderr).toMatch(/\d+ dims/)
  })

  it('kit validate reports parity green', () => {
    const { stdout, stderr } = spawn(['kit', 'validate', '--experimental.kit'])
    expect(stdout + stderr).toContain('parity green')
  })

  it('kit install --help exits 0 and describes phases', () => {
    const { status, stdout } = spawn(['kit', 'install', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('DETECT')
  })

  it('kit install --dry-run exits 0 and reports ASSESS dim count', () => {
    const { status, stdout, stderr } = spawn(['kit', 'install', '--experimental.kit', '--dry-run'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout + stderr).toContain('[ASSESS]')
  })

  it('kit install --dry-run reports SCAFFOLD dry-run mode', () => {
    const { stdout, stderr } = spawn(['kit', 'install', '--experimental.kit', '--dry-run'])
    expect(stdout + stderr).toContain('dry-run mode')
  })

  it('kit list exits 0 and prints a dimension table', () => {
    const { status, stdout, stderr } = spawn(['kit', 'list', '--experimental.kit'])
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout + stderr).toMatch(/N\d+/)
  })
})
