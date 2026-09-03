// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-deprecations.mjs')

function run(cwd: string, env?: Record<string, string>) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd,
    env: { ...process.env, ...env },
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'deprecations-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-deprecations.mjs (deprecation window enforcement)', () => {
  it('exits 0 when no active deprecations are defined', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      // DEPRECATIONS.md with no Active Deprecations section
      writeFileSync(join(dir, 'docs', 'DEPRECATIONS.md'), '# Removed Deprecations\n\nNone yet.\n')
      const result = run(dir)
      // #1170: still exits 0 with zero active rows (no symbol or CLI-flag violations),
      // but no longer early-returns — the CLI-flag validation now also runs.
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all active deprecated symbols are present in src/', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      // Create DEPRECATIONS.md with one active symbol
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| oldFunction | 0.5.0 | 0.6.0 | newFunction | in-window |',
          '',
          '# Removed Deprecations',
          '',
          'None yet.',
        ].join('\n'),
      )
      // Create src file with the symbol
      writeFileSync(join(dir, 'src', 'util.ts'), 'export function oldFunction() {}')
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
      expect(result.stdout).toContain('1 active deprecated symbol')
    } finally {
      cleanup()
    }
  })

  // #2453: a CLI-flag symbol IS a leading-dash string ("--no-adopt-gate-spine").
  // The grep call that verifies a symbol is still present in src/ must not
  // treat the pattern as a grep option — that would report every active,
  // correctly-wired CLI flag deprecation as "removed" and block the gate.
  it('exits 0 for a dash-prefixed CLI flag symbol present in src/ (grep pattern, not option)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| `--no-adopt-gate-spine` | 0.5.0 | 0.8.0 | (none) | in-window |',
          '',
          '# Removed Deprecations',
          '',
          'None yet.',
        ].join('\n'),
      )
      writeFileSync(
        join(dir, 'src', 'cli.ts'),
        "program.option('--no-adopt-gate-spine', 'deprecated')",
      )
      const result = run(dir)
      expect(result.stderr).not.toContain('not found in src/')
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when an active deprecated symbol is missing from src/', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      // Create DEPRECATIONS.md with one active symbol
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| missingSymbol | 0.5.0 | 0.6.0 | replacement | in-window |',
          '',
          '# Removed Deprecations',
          '',
          'None yet.',
        ].join('\n'),
      )
      // src/ exists but does not contain missingSymbol
      writeFileSync(join(dir, 'src', 'other.ts'), 'export const x = 1')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('missingSymbol')
      expect(result.stderr).toContain('not found in src/')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when DEPRECATIONS.md does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      // do not create DEPRECATIONS.md
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('not found')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when ALLOW_REMOVE_DEPRECATED=1 env var is set', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      // Create DEPRECATIONS.md with a symbol not in src
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| badSymbol | 0.5.0 | 0.6.0 | new | in-window |',
        ].join('\n'),
      )
      writeFileSync(join(dir, 'src', 'app.ts'), 'export const app = {}')
      // Would fail without env var; should pass with it
      const result = run(dir, { ALLOW_REMOVE_DEPRECATED: '1' })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('ALLOW_REMOVE_DEPRECATED=1')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when CLI flag registry has insufficient version gap', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src', 'internal'), { recursive: true })
      // One active symbol present in src/ so the gate proceeds past the
      // "no active deprecations" early-exit and reaches the CLI registry check.
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| keptSymbol | 0.5.0 | 0.6.0 | newSymbol | in-window |',
        ].join('\n'),
      )
      writeFileSync(join(dir, 'src', 'kept.ts'), 'export function keptSymbol() {}')
      // Create CLI registry with bad version gap (patch only)
      writeFileSync(
        join(dir, 'src', 'internal', 'cli-deprecation-registry.ts'),
        [
          'export const CLI_DEPRECATED_FLAGS = [',
          "  { flag: '--old-flag', deprecatedIn: '1.0.0', removeIn: '1.0.1', replacement: '--new-flag' },",
          ']',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('--old-flag')
      expect(result.stderr).toContain('insufficient version gap')
    } finally {
      cleanup()
    }
  })

  it('exits 1 on a bad CLI flag gap even with ZERO active doc rows (#1170 — no early-return)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src', 'internal'), { recursive: true })
      // Empty active table — pre-#1170 this early-returned exit 0, hiding the
      // CLI-flag version-gap violation below.
      writeFileSync(join(dir, 'docs', 'DEPRECATIONS.md'), '# Active Deprecations\n\n_None yet._\n')
      writeFileSync(
        join(dir, 'src', 'internal', 'cli-deprecation-registry.ts'),
        [
          'export const CLI_DEPRECATED_FLAGS = [',
          "  { flag: '--ghost-flag', deprecatedIn: '2.0.0', removeIn: '2.0.1', replacement: '--x' },",
          ']',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('--ghost-flag')
      expect(result.stderr).toContain('insufficient version gap')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when CLI flag registry has sufficient version gap (≥1 MINOR)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src', 'internal'), { recursive: true })
      // One active symbol present in src/ so the gate reaches the registry check.
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| keptSymbol | 0.5.0 | 0.6.0 | newSymbol | in-window |',
        ].join('\n'),
      )
      writeFileSync(join(dir, 'src', 'kept.ts'), 'export function keptSymbol() {}')
      // Create CLI registry with good version gap (1 MINOR bump)
      writeFileSync(
        join(dir, 'src', 'internal', 'cli-deprecation-registry.ts'),
        [
          'export const CLI_DEPRECATED_FLAGS = [',
          "  { flag: '--good-flag', deprecatedIn: '1.0.0', removeIn: '1.1.0', replacement: '--new' },",
          ']',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('parses multiple active deprecations and checks all symbols', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| oldFunc1 | 0.5.0 | 0.6.0 | newFunc1 | in-window |',
          '| oldFunc2 | 0.5.0 | 0.6.0 | newFunc2 | in-window |',
        ].join('\n'),
      )
      writeFileSync(
        join(dir, 'src', 'lib.ts'),
        'export function oldFunc1() {}\nexport function oldFunc2() {}',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('2 active deprecated symbol')
    } finally {
      cleanup()
    }
  })

  it('reports violation when one of multiple symbols is missing', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated In | Remove In | Replacement | Status |',
          '| --- | --- | --- | --- | --- |',
          '| presentFunc | 0.5.0 | 0.6.0 | new | in-window |',
          '| missingFunc | 0.5.0 | 0.6.0 | new | in-window |',
        ].join('\n'),
      )
      writeFileSync(join(dir, 'src', 'lib.ts'), 'export function presentFunc() {}')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('missingFunc')
    } finally {
      cleanup()
    }
  })
})

describe('check-deprecations.mjs (source @deprecated tag scan, #2449)', () => {
  it('exits 1 when a src/ symbol is tagged @deprecated but has no Active-table row', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src', 'wizard'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        '# Active Deprecations\n\n_(none currently active)_\n',
      )
      writeFileSync(
        join(dir, 'src', 'wizard', 'types.ts'),
        [
          'export interface Answers {',
          '  /**',
          '   * Legacy flag.',
          '   * @deprecated Use newMode instead.',
          '   */',
          '  ghostField?: boolean',
          '}',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('ghostField')
      expect(result.stderr).toContain('no row')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when every @deprecated src/ symbol has an Active-table row', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src', 'wizard'), { recursive: true })
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated in | Remove in | Replacement | Status | Stage |',
          '| --- | --- | --- | --- | --- | --- |',
          '| ghostField | 0.2.0 | 1.0.0 | newMode | in-window | warn |',
        ].join('\n'),
      )
      writeFileSync(
        join(dir, 'src', 'wizard', 'types.ts'),
        [
          'export interface Answers {',
          '  /**',
          '   * @deprecated Use newMode instead.',
          '   */',
          '  ghostField?: boolean',
          '}',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('1 source @deprecated tag')
    } finally {
      cleanup()
    }
  })

  it('accepts a dotted/qualified Active-table symbol for a bare source identifier', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        [
          '# Active Deprecations',
          '',
          '| Symbol / Flag / Behavior | Deprecated in | Remove in | Replacement | Status | Stage |',
          '| --- | --- | --- | --- | --- | --- |',
          '| `features.soloDevMode` | 0.2.0 | 1.0.0 | collaborationMode | in-window | warn |',
        ].join('\n'),
      )
      writeFileSync(
        join(dir, 'src', 'types.ts'),
        [
          'export interface Answers {',
          '  /** @deprecated Use collaborationMode instead. */',
          '  soloDevMode?: boolean',
          '}',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('detects a single-line /** @deprecated */ tag as well as a block tag', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        '# Active Deprecations\n\n_(none currently active)_\n',
      )
      writeFileSync(
        join(dir, 'src', 'api.ts'),
        ['/** @deprecated Use freshHelper. */', 'export function staleHelper() {}'].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('staleHelper')
    } finally {
      cleanup()
    }
  })

  it('skips the source scan under ALLOW_REMOVE_DEPRECATED=1', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'))
      mkdirSync(join(dir, 'src'))
      writeFileSync(
        join(dir, 'docs', 'DEPRECATIONS.md'),
        '# Active Deprecations\n\n_(none currently active)_\n',
      )
      writeFileSync(
        join(dir, 'src', 'api.ts'),
        ['/** @deprecated no row anywhere. */', 'export function orphan() {}'].join('\n'),
      )
      const result = run(dir, { ALLOW_REMOVE_DEPRECATED: '1' })
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('this repo: every @deprecated symbol in src/ is documented (AC-1 + AC-2)', () => {
    const result = run(resolve('.'))
    expect(result.stderr).not.toContain('no row')
    expect(result.status).toBe(0)
  })
})
