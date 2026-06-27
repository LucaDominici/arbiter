// SPDX-License-Identifier: Apache-2.0
// #1667 — the emitted check-secret-scan.mjs (INV-89) filtered tracked files through a hardcoded
// extension ALLOW-list (.ts/.tsx/.js/.mjs/.cjs/.json/.yml/.yaml/.sh/.env) and scanned nothing else.
// On a Go / Python / Rust / Java / Kotlin project it therefore read ZERO files of the project's
// actual source language and exited 0 — a hardcoded AKIA…/ghp_… credential in any .go/.py/.rs/.java
// source passed the only local secret gate clean (and Go init ships no gitleaks CI backstop). The
// fix mirrors the sibling pii-scan SKIP-list design: scan every text file except a binary/lockfile
// SKIP_EXTENSIONS set. These render+execute tests stage the rendered scanner (+ its glob-walk helper)
// over a tree with a planted AWS key in a .go/.py/.rs source file and assert the gate now exits 1.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

// Canonical AWS example access key id — matches /AKIA[0-9A-Z]{16}/.
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

function stageScanner(dir: string): string {
  const data = makeConfig('/tmp/test', { governanceLevel: 'L2' }) as unknown as Record<
    string,
    unknown
  >
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(
    join(dir, 'lib', 'glob-walk.mjs'),
    renderTemplate('scripts/lib/glob-walk.mjs.ejs', data),
  )
  const scanner = join(dir, 'check-secret-scan.mjs')
  writeFileSync(scanner, renderTemplate('scripts/check-secret-scan.mjs.ejs', data))
  return scanner
}

describe('#1667 emitted secret scanner covers non-JS/TS source languages', () => {
  it.each([
    { lang: 'go', rel: join('cmd', 'main.go') },
    { lang: 'python', rel: join('app', 'config.py') },
    { lang: 'rust', rel: join('src', 'lib.rs') },
    { lang: 'java', rel: join('src', 'Main.java') },
  ])('flags a planted AWS key in a .$lang source file', ({ rel }) => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-cov-'))
    try {
      const scanner = stageScanner(dir)
      const scanRoot = join(dir, 'project')
      const target = join(scanRoot, rel)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, `const k = "${AWS_KEY}"\n`)

      const res = spawnSync('node', [scanner, '--dir', scanRoot], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 10_000,
      })

      const out = `${res.stdout}${res.stderr}`
      // RED before the fix: the source language was outside the allow-list → exit 0, "no secrets".
      expect(res.status).toBe(1)
      expect(out).toContain('AWS Access Key')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still passes clean on a Go tree with no secrets (no false positive)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-clean-'))
    try {
      const scanner = stageScanner(dir)
      const scanRoot = join(dir, 'project')
      mkdirSync(join(scanRoot, 'cmd'), { recursive: true })
      writeFileSync(join(scanRoot, 'cmd', 'main.go'), 'package main\n\nfunc main() {}\n')

      const res = spawnSync('node', [scanner, '--dir', scanRoot], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 10_000,
      })
      expect(res.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders with a SKIP-list (not a source-language allow-list)', () => {
    const data = makeConfig('/tmp/test', { governanceLevel: 'L2' }) as unknown as Record<
      string,
      unknown
    >
    const out = renderTemplate('scripts/check-secret-scan.mjs.ejs', data)
    expect(out).toContain('SKIP_EXTENSIONS')
    expect(out).not.toContain('SCANNED_EXTENSIONS')
    expect(out).not.toContain('<%')
  })
})
