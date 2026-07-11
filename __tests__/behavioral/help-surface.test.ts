// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1770 T5): public 11-command CLI surface — spawn the real
// CLI binary and assert default --help shows exactly the public commands while
// `arbiter help --all` still lists the experimental (hidden) surface.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath

const PUBLIC_COMMANDS = [
  'init',
  'update',
  'diff',
  'configure',
  'doctor',
  'validate',
  'task',
  'ship',
  'note',
  'gold-audit',
  'worktree',
]

function spawn(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], { encoding: 'utf-8', timeout: 30_000 })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

/** Extract primary command names from the "Commands:" section of help output. */
function commandNames(helpText: string): string[] {
  const commandsIdx = helpText.indexOf('Commands:')
  if (commandsIdx === -1) return []
  const section = helpText.slice(commandsIdx)
  const names: string[] = []
  for (const line of section.split('\n').slice(1)) {
    const m = /^ {2}(\S+)/.exec(line)
    if (!m) continue
    // Term looks like `init [options]` or `validate|verify [options]` — keep
    // the primary name only.
    names.push(m[1].split('|')[0])
  }
  return names
}

describe('arbiter --help — public 11-command surface (#1770 T5)', () => {
  it('default help lists exactly the 11 public commands', () => {
    const { status, stdout } = spawn(['--help'])
    expect(status).toBe(0)
    const names = commandNames(stdout)
    expect(names.sort()).toEqual([...PUBLIC_COMMANDS].sort())
  })

  it('default help points at `help --all` for experimental commands', () => {
    const { status, stdout } = spawn(['--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('Run `arbiter help --all` for experimental commands.')
  })

  it('help --all lists experimental commands including graph', () => {
    const { status, stdout } = spawn(['help', '--all'])
    expect(status).toBe(0)
    expect(stdout).toContain('Experimental commands:')
    const experimentalSection = stdout.slice(stdout.indexOf('Experimental commands:'))
    for (const hidden of ['graph', 'review', 'explain']) {
      expect(experimentalSection).toMatch(new RegExp(`^ {2}${hidden}\\s`, 'm'))
    }
  })

  it('hidden commands remain fully functional', () => {
    const { status, stdout } = spawn(['graph', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('provenance graph')
  })

  it('validate is the public name and verify still works as alias', () => {
    const validate = spawn(['validate', '--help'])
    expect(validate.status).toBe(0)
    const verify = spawn(['verify', '--help'])
    expect(verify.status).toBe(0)
    expect(verify.stdout).toContain('Probe toolchain compatibility')
  })

  it('help <command> still shows help for a named command', () => {
    const { status, stdout } = spawn(['help', 'init'])
    expect(status).toBe(0)
    expect(stdout.toLowerCase()).toContain('init')
  })
})
