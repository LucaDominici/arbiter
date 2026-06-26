// SPDX-License-Identifier: Apache-2.0
// #1555 — the emitted dependency-free boundary scanners (check-boundaries-{python,go,rust}) walk
// the domain tree with a hand-rolled recursive scanDomain(). Before the fix it had no symlink skip
// and no visited-set, so a symlinked source file under the domain tree was followed/read and an
// exotic real-path cycle could recurse forever. These render+execute tests stage each rendered
// scanner in a temp project with a domain tree containing a directory symlink cycle AND a symlinked
// source file, then prove the scanner:
//   - TERMINATES within budget without a stack-overflow (cycle guard present),
//   - STILL reports a real (non-symlink) banned import (anti-vacuous — scan not disarmed),
//   - does NOT follow a symlinked source file pointing at a banned import (isSymbolicLink skip).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderTemplate } from '../../src/utils/render.js'
import { makeConfig } from '../helpers.js'

interface Case {
  tpl: string
  lang: string
  domain: string // domain root, relative to the project
  ext: string // source extension
  bannedLine: string // a line that trips the banned-import regex
}

const CASES: Case[] = [
  {
    tpl: 'boundaries/check-boundaries-python.mjs.ejs',
    lang: 'python',
    domain: join('src', 'domain'),
    ext: 'py',
    bannedLine: 'from django import models',
  },
  {
    tpl: 'boundaries/check-boundaries-go.mjs.ejs',
    lang: 'go',
    domain: join('internal', 'domain'),
    ext: 'go',
    bannedLine: 'import "gorm.io/gorm"',
  },
  {
    tpl: 'boundaries/check-boundaries-rust.mjs.ejs',
    lang: 'rust',
    domain: join('src', 'domain'),
    ext: 'rs',
    bannedLine: 'use sqlx::query;',
  },
]

function render(tpl: string, lang: string): string {
  const data = makeConfig('/tmp/test', {
    language: lang as never,
    governanceLevel: 'L2',
  }) as unknown as Record<string, unknown>
  return renderTemplate(tpl, data)
}

describe('#1555 boundary scanners are cycle-safe and skip symlinked sources', () => {
  it.each(CASES)('$lang scanner terminates on a cycle and skips symlinked sources', (c) => {
    const dir = mkdtempSync(join(tmpdir(), `boundary-cycle-${c.lang}-`))
    try {
      const domainAbs = join(dir, c.domain)
      mkdirSync(domainAbs, { recursive: true })
      // A clean real source (no banned import).
      writeFileSync(join(domainAbs, `clean.${c.ext}`), '// clean module\n')
      // A REAL banned import in a real file — proves the scan still fires (anti-vacuous).
      writeFileSync(join(domainAbs, `realbad.${c.ext}`), `${c.bannedLine}\n`)
      // A source file OUTSIDE the domain holding a banned import, reached only via a symlink.
      writeFileSync(join(dir, `outside.${c.ext}`), `${c.bannedLine}\n`)
      symlinkSync(join(dir, `outside.${c.ext}`), join(domainAbs, `linked.${c.ext}`), 'file')
      // A directory symlink cycle back to the domain root → would fan out / OOM a naive walker.
      symlinkSync(domainAbs, join(domainAbs, 'loop'), 'dir')

      const scanner = join(dir, 'check-boundaries.mjs')
      writeFileSync(scanner, render(c.tpl, c.lang))

      // Layer 2/3 spawn external linters that do not exist here (exit code is muddied), so assert
      // on the domain-scan STDERR and on termination, not on the overall exit code.
      const res = spawnSync('node', [scanner], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 10_000,
      })

      // Terminated normally (not killed by the timeout signal → no infinite recursion / hang).
      expect(res.signal).toBeNull()
      const out = `${res.stdout}${res.stderr}`
      // No stack-overflow from an unguarded cycle.
      expect(out).not.toContain('Maximum call stack size exceeded')
      // The REAL banned import is still reported (scan not disarmed).
      expect(out).toContain(`realbad.${c.ext}`)
      // The SYMLINKED source is NOT followed (RED before the fix: it was read and reported).
      expect(out).not.toContain(`linked.${c.ext}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('#1555 boundary scanner templates stay dependency-free', () => {
  it.each(CASES)('$lang scanner imports only node builtins and renders cleanly', (c) => {
    const out = render(c.tpl, c.lang)
    expect(out).not.toContain('<%')
    expect(out).not.toContain('%>')
    expect(out).toContain('isSymbolicLink()')
    expect(out).toContain('visitedDomainDirs')
    // No relative/library import — must run in a project with no arbiter install.
    expect(out).not.toMatch(/from '\.\.?\//)
    expect(out).not.toContain('glob-walk')
  })
})
