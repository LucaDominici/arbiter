// SPDX-License-Identifier: Apache-2.0
// TDD guard for #902 — SHA-pin self-check (INV-76, transition mode).
// Script exits 0 unconditionally during transition; behavior is in stdout.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-action-pins.mjs')

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-action-pins-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-action-pins.mjs (#902, INV-76 transition)', () => {
  it('reports tag-pinned ref as TRANSITION-WARN and exits 0', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[TRANSITION-WARN]')
      expect(result.stdout).toContain('non-SHA action reference')
      expect(result.stdout).toContain('actions/checkout@v4')
    } finally {
      cleanup()
    }
  })

  it('reports clean when all refs are SHA-pinned (lowercase)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('reports clean when all refs are SHA-pinned (uppercase — case-insensitive)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@11BD71901BBE5B1630CEEA73D27597364C9AF683\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('ignores local composite actions and docker refs', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: ./.github/actions/setup\n      - uses: docker://alpine:3.19\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('exits 0 silently when no .github/ directory exists', () => {
    const { dir, cleanup } = makeDir()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('non-SHA')
      expect(result.stdout).not.toContain('[TRANSITION-WARN]')
    } finally {
      cleanup()
    }
  })

  it('scans .github/actions/ dir (composite action yamls)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'actions', 'my-action'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'actions', 'my-action', 'action.yml'),
        'runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('[TRANSITION-WARN]')
      expect(result.stdout).toContain('actions/setup-node@v4')
    } finally {
      cleanup()
    }
  })
})
