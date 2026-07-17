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

  it('verify tdd --json emits a parseable envelope with 6 check verdicts (#1992)', () => {
    // #551 evidence is real, committed fixture data in this repo (predates
    // #1957's red-execution check, so it FAILs — but all 6 checks still run;
    // see __tests__/integration/gate/tdd-evidence-l2.test.ts). --json here
    // was silently ignored: a Commander parent/child `--json` name collision
    // (verify/validate declares its own `--json`) shadowed the subcommand's
    // parsed value, so the CLI always printed the human-readable line.
    const { status, stdout, stderr } = spawn(['verify', 'tdd', '#551', '--json'])
    expect(status).not.toBe(0)
    expect(stdout, `expected JSON, got plain text — stderr: ${stderr}`).not.toContain(
      'verify tdd: FAIL —',
    )
    const parsed = JSON.parse(stdout)
    expect(parsed.command).toBe('verify tdd')
    expect(parsed.status).toBe('error')
    expect(parsed.data.exitCode).toBe(1)
    expect(Array.isArray(parsed.data.checks)).toBe(true)
    expect(parsed.data.checks).toHaveLength(6)
    for (const check of parsed.data.checks) {
      expect(check).toHaveProperty('name')
      expect(check).toHaveProperty('pass')
    }
  })

  it('verify graph --help exits 0', () => {
    const { status, stdout } = spawn(['verify', 'graph', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('provenance')
  })
})
