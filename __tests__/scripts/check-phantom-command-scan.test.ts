// SPDX-License-Identifier: Apache-2.0
// F2 (#1838, item 4 — extends INV-111): every `arbiter <cmd>` cited in
// current-state prose docs (PRIVACY.md, docs/ minus internal/, website/ minus
// changelog/) must name a command that actually exists in src/cli.ts. This is
// the class of bug fixed once already in F1 (#1837: PRIVACY.md cited the
// nonexistent `arbiter check` / `arbiter generate`) — this suite proves the
// gate catches a synthetic phantom command, and doesn't false-positive on
// aliases, `help`, or historical/roadmap prose.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  extractCitedCommands,
  findPhantomCommands,
} from '../../scripts/check-phantom-command-scan.mjs'

const SCRIPT = resolve('scripts/check-phantom-command-scan.mjs')

// ─── extractCitedCommands ──────────────────────────────────────────────────────

describe('extractCitedCommands', () => {
  it('extracts a backtick-wrapped command citation', () => {
    expect(extractCitedCommands('Run `arbiter init` to get started.')).toEqual(new Set(['init']))
  })

  it('extracts multiple distinct citations', () => {
    const md = 'Use `arbiter validate` then `arbiter doctor`.'
    expect(extractCitedCommands(md)).toEqual(new Set(['validate', 'doctor']))
  })

  it('does not match bare prose without backticks', () => {
    expect(extractCitedCommands('arbiter checks your commits automatically.')).toEqual(new Set())
  })

  it('does not match global flags (arbiter --version)', () => {
    expect(extractCitedCommands('Run `arbiter --version` to check.')).toEqual(new Set())
  })

  it('filters known prose stopwords styled in backticks (e.g. "arbiter governs itself")', () => {
    expect(extractCitedCommands('This is `arbiter governs itself` as a design principle.')).toEqual(
      new Set(),
    )
  })

  it('captures a phantom command the same way as a real one (extraction is neutral)', () => {
    expect(extractCitedCommands('Run `arbiter frobnicate` now.')).toEqual(new Set(['frobnicate']))
  })
})

// ─── findPhantomCommands ────────────────────────────────────────────────────────

describe('findPhantomCommands', () => {
  it('returns empty when every citation is real', () => {
    const real = new Set(['init', 'doctor'])
    expect(findPhantomCommands(new Set(['init', 'doctor']), real)).toEqual([])
  })

  it('DETECTS a synthetic phantom command citation', () => {
    const real = new Set(['init', 'doctor'])
    expect(findPhantomCommands(new Set(['init', 'frobnicate']), real)).toEqual(['frobnicate'])
  })

  it('recognizes an alias as real when included in realCommandNames', () => {
    const real = new Set(['worktree', 'wt'])
    expect(findPhantomCommands(new Set(['wt']), real)).toEqual([])
  })
})

// ─── end-to-end: real repo must be phantom-free ───────────────────────────────

describe('check-phantom-command-scan.mjs — real repo (INV-111 extension)', () => {
  it('exits 0 against PRIVACY.md + docs/ + website/ (excluding internal/ and changelog/)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout).not.toContain('phantom:')
    expect(r.status).toBe(0)
  })

  it('does not flag `arbiter verify` (real alias of validate) or `arbiter wt` (real alias of worktree)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: resolve('.') })
    expect(r.stdout).not.toContain('`arbiter verify`')
    expect(r.stdout).not.toContain('`arbiter wt`')
  })
})

// ─── end-to-end: synthetic drift must fail the gate (non-vacuity proof) ──────

describe('check-phantom-command-scan.mjs — synthetic phantom command fails closed', () => {
  it('exits 1 when a doc cites a command absent from cli.ts (regression: #1837)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'PRIVACY.md'),
        'Run `arbiter frobnicate` to purge telemetry (this command does not exist).\n',
      )
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('frobnicate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips docs/audit/ — an audit report quoting a phantom command as evidence is not a live promise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-audit-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('init').description('Init')\n",
      )
      const docsDir = join(dir, 'docs')
      mkdirSync(join(docsDir, 'audit'), { recursive: true })
      writeFileSync(
        join(docsDir, 'audit', 'release-readiness-verdict.md'),
        '- `arbiter frobnicate` — cited in ship.md.ejs; this command does not exist.\n',
      )
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${docsDir}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      expect(r.stdout).not.toContain('phantom:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 0 when the cited command is a real alias, not registered as its own .command()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phantom-scan-alias-'))
    try {
      const cliPath = join(dir, 'cli.ts')
      writeFileSync(
        cliPath,
        "import { Command } from 'commander'\nconst program = new Command()\n" +
          "program.command('worktree').alias('wt').description('Worktree mgmt')\n",
      )
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'PRIVACY.md'), 'Run `arbiter wt` to manage worktrees.\n')
      const r = spawnSync('node', [SCRIPT, `--cli=${cliPath}`, `--roots=${join(dir, 'docs')}`], {
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
