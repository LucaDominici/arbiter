// SPDX-License-Identifier: Apache-2.0
// Behavioral tests (#1770 T5, superseded by T2 tier-3 cathedral cut): public
// 15-command CLI surface — spawn the real CLI binary and assert default
// --help shows exactly the public commands while `arbiter help --all` still
// lists the experimental (hidden) surface.
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
  'gate-exec',
  'review',
  'explain',
  'obsidian',
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

describe('arbiter --help — public 15-command surface (#1770 T5, T2 tier-3)', () => {
  it('default help lists exactly the 15 public commands', () => {
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

  it('help --all lists the remaining experimental commands', () => {
    const { status, stdout } = spawn(['help', '--all'])
    expect(status).toBe(0)
    expect(stdout).toContain('Experimental commands:')
    const experimentalSection = stdout.slice(stdout.indexOf('Experimental commands:'))
    for (const hidden of ['settings', 'upgrade-level']) {
      expect(experimentalSection).toMatch(new RegExp(`^ {2}${hidden}\\s`, 'm'))
    }
  })

  it('hidden commands remain fully functional', () => {
    const { status, stdout } = spawn(['settings', '--help'])
    expect(status).toBe(0)
    expect(stdout).toContain('settable')
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

// ─── #2211: documented capability ⇒ CLI surface ───────────────────────────────
// Root cause: two deliberate surface-reduction commits (3bd2f1db "cut 17 leaf
// commands", c1a50e96 "cut graph build + kit surface") verified "zero-ref" in
// CODE only, leaving the references in PROSE — error-catalog recovery strings,
// --help text, and the JSON envelope's own self-identification.
describe('#2211 — every documented capability has a real CLI surface', () => {
  it('`graph build` is registered and writes the snapshot verify/review consume', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-2211-graph-'))
    try {
      const build = spawn(['graph', 'build', '--dir', dir])
      expect(build.status).toBe(0)
      expect(existsSync(join(dir, '.arbiter', 'graph.json'))).toBe(true)

      // The round-trip the audit called untestable: after `graph build`, the
      // ONLY remediation `validate graph` offers must no longer be needed.
      const verify = spawn(['validate', 'graph', '--json', '--dir', dir])
      expect(verify.stdout + verify.stderr).not.toContain('graph snapshot not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('`doctor health` is invocable and its JSON envelope stops lying', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arb-2211-doctor-'))
    try {
      // The audit's exact repro. Note the flags: commander does NOT inherit
      // parent options, so a bare `.command('health')` would fail here.
      const { status, stdout } = spawn(['doctor', 'health', '--json', '--dir', dir])
      expect(status).toBe(0)
      const envelope = JSON.parse(stdout.trim().split('\n').at(-1) as string) as {
        command: string
      }
      expect(envelope.command).toBe('doctor health')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('no user-facing remediation string cites a command that does not exist', () => {
    // ponytail: first-token only — `arbiter doctor health` is checked as `doctor`.
    // Catching dangling SUBcommands means walking the commander tree; upgrade to
    // that if a subcommand-level dangling reference ever ships.
    // Scoped to the remediation surface (what a user is TOLD to run) — comments
    // elsewhere in src/ still carry cut-command names and are out of scope.
    const registered = new Set(commandNames(spawn(['help', '--all']).stdout))
    expect(registered.size).toBeGreaterThan(10)

    const sources = ['src/utils/error-catalog.ts', 'src/i18n/en.json']
    const dangling: string[] = []
    for (const rel of sources) {
      const text = readFileSync(join(REPO, rel), 'utf-8')
      for (const m of text.matchAll(/`arbiter ([a-z][a-z-]*)/g)) {
        const name = m[1]
        if (!registered.has(name)) dangling.push(`${rel}: \`arbiter ${name}\``)
      }
    }
    expect([...new Set(dangling)]).toEqual([])
  })
})
