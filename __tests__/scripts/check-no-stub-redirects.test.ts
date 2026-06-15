// SPDX-License-Identifier: Apache-2.0
// Guard E10 (no-stub-redirects, #1412): a stale "Moved → X" stub .md is a falso-green for docs —
// the link checker passes, the page "exists", but it is a redirect husk with no content. This
// guard flags a doc that is (a) a heading-verb stub (Moved/Relocated/See/Renamed), (b) short body,
// (c) a single .md link. Allowlist entries REQUIRE a hard EXPIRES: date — an open-ended exemption
// is itself a falso-green, so a missing/past EXPIRES fails closed.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-no-stub-redirects.mjs')

function run(dir: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stub-redirect-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  return dir
}

const STUB = '# Moved\n\nThis page has moved to [the new home](./new-home.md).\n'

describe('check-no-stub-redirects (guard E10, #1412)', () => {
  it('--help exits 0', () => {
    const dir = mkTmp()
    try {
      const r = run(dir, ['--help'])
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Usage')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a stale "Moved →" stub .md → FAIL (exit 1)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'docs', 'old.md'), STUB)
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/stub|moved|redirect/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a real doc with substantial content → PASS (exit 0)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(
        join(dir, 'docs', 'real.md'),
        '# Real Doc\n\n' + 'This is a genuine page with real content. '.repeat(20) + '\n',
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allowlist entry WITH a future EXPIRES → PASS (exit 0)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'docs', 'old.md'), STUB)
      writeFileSync(
        join(dir, '.stub-redirects-allowlist'),
        'docs/old.md  EXPIRES: 2999-01-01  # interim redirect during migration\n',
      )
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allowlist entry WITHOUT an EXPIRES → still FAIL (open-ended exemption is itself fake-green)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'docs', 'old.md'), STUB)
      writeFileSync(join(dir, '.stub-redirects-allowlist'), 'docs/old.md  # no expiry\n')
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/EXPIRES/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allowlist entry with a PAST EXPIRES → FAIL (lapsed exemption)', () => {
    const dir = mkTmp()
    try {
      writeFileSync(join(dir, 'docs', 'old.md'), STUB)
      writeFileSync(
        join(dir, '.stub-redirects-allowlist'),
        'docs/old.md  EXPIRES: 2000-01-01  # lapsed\n',
      )
      const r = run(dir)
      expect(r.status).toBe(1)
      expect(r.stderr + r.stdout).toMatch(/expir/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('no docs at all → PASS (exit 0, nothing to flag)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stub-redirect-empty-'))
    try {
      const r = run(dir)
      expect(r.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
