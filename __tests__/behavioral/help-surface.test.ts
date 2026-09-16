// SPDX-License-Identifier: Apache-2.0
// #2706: one incompatible public command vocabulary. Exercise the built entry
// point so hidden registrations and aliases cannot escape detection.
import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CLI = resolve(import.meta.dirname, '../../dist/cli.js')
const NODE = process.execPath
const REPO = resolve(import.meta.dirname, '../..')

const PUBLIC_COMMANDS = [
  'init',
  'configure',
  'update',
  'ship',
  'status',
  'explain',
  'lifecycle',
  'check',
  'audit',
  'finding',
  'docs',
  'graph',
  'worktree',
  'review',
]

const RETIRED_COMMANDS = [
  'note',
  'task',
  'mark',
  'validate',
  'verify',
  'gate-exec',
  'gold-audit',
  'doc-set',
  'settings',
  'method',
  'upgrade-level',
  'diff',
  'doctor',
  'ignore',
  'plugin',
  'obsidian',
  'wt',
]

function spawn(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(NODE, [CLI, ...args], { encoding: 'utf-8', timeout: 30_000 })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

/** Extract primary command names from a Commander "Commands:" section. */
function commandNames(helpText: string): string[] {
  const commandsIdx = helpText.indexOf('Commands:')
  if (commandsIdx === -1) return []
  const names: string[] = []
  for (const line of helpText.slice(commandsIdx).split('\n').slice(1)) {
    const match = /^ {2}(\S+)/.exec(line)
    if (match?.[1] !== undefined && match[1] !== 'help') names.push(match[1].split('|')[0])
  }
  return names
}

describe('arbiter --help — atomic canonical surface (#2706)', () => {
  it('lists exactly the 14 canonical roots', () => {
    const { status, stdout } = spawn(['--help'])
    expect(status).toBe(0)
    expect(commandNames(stdout).sort()).toEqual([...PUBLIC_COMMANDS].sort())
  })

  it('has no hidden legacy command tier', () => {
    const { status, stdout } = spawn(['help', '--all'])
    expect(status).toBe(0)
    expect(commandNames(stdout).sort()).toEqual([...PUBLIC_COMMANDS].sort())
    expect(stdout).not.toContain('Experimental commands:')
  })

  it('rejects every retired root spelling', () => {
    for (const retired of RETIRED_COMMANDS) {
      const result = spawn([retired])
      expect(result.status, retired).not.toBe(0)
      expect(result.stderr + result.stdout, retired).toMatch(/unknown command|error/i)
    }
  })

  it('help <command> still shows help for a named command', () => {
    const { status, stdout } = spawn(['help', 'init'])
    expect(status).toBe(0)
    expect(stdout.toLowerCase()).toContain('init')
  })

  it.each([
    ['finding', ['add', 'list', 'triage', 'promote']],
    [
      'lifecycle',
      [
        'start',
        'get',
        'resume',
        'advance',
        'recover',
        'preflight',
        'record-red',
        'record-debt',
        'checkpoint',
        'repair-state',
        'recover-lock',
        'clean',
      ],
    ],
    ['check', ['environment', 'evidence', 'plan', 'tdd', 'run', 'tool-pins', 'fail-open']],
    ['audit', ['readiness', 'docs', 'product']],
    ['docs', ['scaffold', 'vault']],
    ['graph', ['build', 'check', 'diff']],
    ['worktree', ['prepare', 'relink', 'check']],
    ['review', ['cross-model']],
  ])('%s exposes only its canonical operations', (root, expected) => {
    const { status, stdout } = spawn([root, '--help'])
    expect(status).toBe(0)
    expect(commandNames(stdout).sort()).toEqual([...expected].sort())
  })
})

describe('#2211 — documented capability has a real canonical route', () => {
  it('`graph build` writes the snapshot `graph check` consumes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-2211-graph-'))
    try {
      const build = spawn(['graph', 'build', '--dir', dir])
      expect(build.status).toBe(0)
      expect(existsSync(join(dir, '.arbiter', 'graph.json'))).toBe(true)
      const check = spawn(['graph', 'check', '--json', '--dir', dir])
      expect(check.stdout + check.stderr).not.toContain('graph snapshot not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('`status health` is invocable and identifies the canonical route', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-2211-status-'))
    try {
      const { status, stdout } = spawn(['status', 'health', '--json', '--dir', dir])
      expect(status).toBe(0)
      const envelope = JSON.parse(stdout.trim().split('\n').at(-1) as string) as {
        command: string
      }
      expect(envelope.command).toBe('status health')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('no user-facing remediation cites a removed command root', () => {
    const sources = ['src/utils/error-catalog.ts', 'src/i18n/en.json']
    const dangling: string[] = []
    for (const rel of sources) {
      const text = readFileSync(join(REPO, rel), 'utf-8')
      for (const match of text.matchAll(/`arbiter ([a-z][a-z-]*)/g)) {
        const root = match[1]
        if (!PUBLIC_COMMANDS.includes(root)) dangling.push(`${rel}: arbiter ${root}`)
      }
    }
    expect([...new Set(dangling)]).toEqual([])
  })
})
