// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

// scripts/check-no-redacted-tokens.mjs (INV-85) has no path flag: it derives ROOT
// from its own location (parent of scripts/), reads scripts/data/redaction-lexicon.json,
// runs `git ls-files` to enumerate committed files, and scans those under src/kit/ and
// .github/ISSUE_TEMPLATE/ for forbidden tokens. To exercise it in isolation we copy the
// script + lexicon into a temp git repo so ROOT resolves to the temp dir, then stage
// fixture files there. Exit-code contract: 0 = clean, 1 = violation OR lexicon-missing.
// (There is no exit 2 path in this script.)
const REAL_SCRIPT = resolve('scripts/check-no-redacted-tokens.mjs')
const REAL_LEXICON = resolve('scripts/data/redaction-lexicon.json')

interface Harness {
  root: string
  script: string
  cleanup: () => void
}

function makeHarness(opts: { withLexicon?: boolean } = {}): Harness {
  const withLexicon = opts.withLexicon ?? true
  const root = mkdtempSync(join(tmpdir(), 'redacted-tokens-'))
  mkdirSync(join(root, 'scripts', 'data'), { recursive: true })
  mkdirSync(join(root, 'src', 'kit'), { recursive: true })
  copyFileSync(REAL_SCRIPT, join(root, 'scripts', 'check-no-redacted-tokens.mjs'))
  if (withLexicon) {
    copyFileSync(REAL_LEXICON, join(root, 'scripts', 'data', 'redaction-lexicon.json'))
  }
  const git = (args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf-8' })
  git(['init', '-q'])
  // Deterministic identity so `git add`/ls-files works in any environment.
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  return {
    root,
    script: join(root, 'scripts', 'check-no-redacted-tokens.mjs'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function stage(root: string, relPath: string, content: string) {
  const abs = join(root, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  spawnSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf-8' })
}

function run(h: Harness) {
  const r = spawnSync('node', [h.script], { encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-no-redacted-tokens.mjs (INV-85 forbidden-token gate)', () => {
  it('exits 0 against the real repo (no forbidden tokens currently committed)', () => {
    const r = spawnSync('node', [REAL_SCRIPT], { encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('OK')
  })

  it('exits 0 when committed src/kit files contain no forbidden tokens', () => {
    const h = makeHarness()
    try {
      stage(h.root, 'src/kit/clean.ts', 'export const greeting = "hello world"\n')
      const r = run(h)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('OK')
    } finally {
      h.cleanup()
    }
  })

  it('exits 1 when a committed src/kit file contains a forbidden token', () => {
    const h = makeHarness()
    try {
      stage(h.root, 'src/kit/bad.ts', 'export const svc = "planning-service"\n')
      const r = run(h)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('planning-service')
      expect(r.stderr).toContain('src/kit/bad.ts')
    } finally {
      h.cleanup()
    }
  })

  it('also scans .github/ISSUE_TEMPLATE/ for forbidden tokens', () => {
    const h = makeHarness()
    try {
      stage(h.root, '.github/ISSUE_TEMPLATE/bug.md', '## Repro\nUses PlanningException here.\n')
      const r = run(h)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('PlanningException')
    } finally {
      h.cleanup()
    }
  })

  it('does not scan files outside the kit-authored prefixes', () => {
    const h = makeHarness()
    try {
      // src/invariants/ is intentionally excluded — the token name in that comment is the guard.
      stage(h.root, 'src/invariants/catalog.ts', 'const reserved = "planning-service"\n')
      const r = run(h)
      expect(r.status).toBe(0)
    } finally {
      h.cleanup()
    }
  })

  it('honors allowContext exemption (token allowed on lines with its allow phrase)', () => {
    const h = makeHarness()
    try {
      // Lexicon allows "Keycloak" only when the line also contains "Keycloak-compatible IdP".
      stage(h.root, 'src/kit/idp.ts', 'export const note = "Keycloak-compatible IdP supported"\n')
      const r = run(h)
      expect(r.status).toBe(0)
    } finally {
      h.cleanup()
    }
  })

  it('flags the allowContext token when the allow phrase is absent', () => {
    const h = makeHarness()
    try {
      stage(h.root, 'src/kit/idp.ts', 'export const note = "uses Keycloak directly"\n')
      const r = run(h)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('Keycloak')
    } finally {
      h.cleanup()
    }
  })

  it('ignores untracked files (only git ls-files are scanned)', () => {
    const h = makeHarness()
    try {
      // Stage a clean file (proves the scanner actually runs), then write a violating
      // file WITHOUT git-adding it — exit 0 proves the untracked violator was skipped.
      stage(h.root, 'src/kit/clean.ts', 'export const ok = 1\n')
      writeFileSync(join(h.root, 'src', 'kit', 'untracked.ts'), 'const x = "planning-service"\n')
      const r = run(h)
      expect(r.status).toBe(0)
    } finally {
      h.cleanup()
    }
  })

  it('exits 1 when the redaction lexicon cannot be loaded', () => {
    const h = makeHarness({ withLexicon: false })
    try {
      stage(h.root, 'src/kit/clean.ts', 'export const ok = 1\n')
      const r = run(h)
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('cannot load lexicon')
    } finally {
      h.cleanup()
    }
  })
})
