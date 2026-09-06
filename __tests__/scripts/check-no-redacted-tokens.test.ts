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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #2514 — ARBITER_HOOK_GIT_CWD is honoured when LISTING files (git ls-files, cwd: GIT_CWD) but
// each file BODY is read as join(ROOT, rel) against the script's own repo root. Point the
// override at a different tree and the gate scans that tree's FILE LIST against THIS tree's
// CONTENTS. A fixture tree of the same repo shape (the one case the variable exists for —
// the '#'-worktree rsync path) has a file at the same relative path, so the mismatched read
// SUCCEEDS and silently returns the wrong tree's content: a false pass with no warning, worse
// than the alternative (a missing path throwing and getting caught). "root" below is a THIRD
// tree, standing in for the script's own resolved repo root (ROOT) — deliberately never the
// tree named by ARBITER_HOOK_GIT_CWD, so a passing assertion here can only mean the scanner
// actually read the GIT_CWD tree it just listed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
function makeGitCwdTree(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'redacted-gitcwd-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  const git = (args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf-8' })
  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'test'])
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'fixture'])
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('ARBITER_HOOK_GIT_CWD wiring — reads resolve against the SAME tree used to list files (#2514)', () => {
  it("fails on a redacted token committed in the ARBITER_HOOK_GIT_CWD tree, not a clean file the script's own root happens to have at that path", () => {
    const h = makeHarness()
    try {
      // The script's own resolved root has a CLEAN file at this exact relative path. If the
      // fix regresses to reading root instead of the tree it listed, this clean copy masks
      // the violation staged below and the gate wrongly passes.
      stage(h.root, 'src/kit/probe.ts', 'export const ok = 1\n')
      const staging = makeGitCwdTree({
        'src/kit/probe.ts': 'export const svc = "planning-service"\n',
      })
      try {
        const r = spawnSync('node', [h.script], {
          encoding: 'utf-8',
          env: { ...process.env, ARBITER_HOOK_GIT_CWD: staging.dir },
        })
        expect(r.status).toBe(1)
        expect(r.stderr).toContain('planning-service')
        expect(r.stderr).toContain('src/kit/probe.ts')
      } finally {
        staging.cleanup()
      }
    } finally {
      h.cleanup()
    }
  })

  it("passes when the ARBITER_HOOK_GIT_CWD tree is clean, even though the same path is a violation under the script's own root", () => {
    const h = makeHarness()
    try {
      // The script's own resolved root has a VIOLATION at this path. A clean verdict here can
      // only be honest if the gate genuinely read the GIT_CWD tree rather than falling back to
      // (or fail-opening past) its own root's content.
      stage(h.root, 'src/kit/probe.ts', 'export const svc = "planning-service"\n')
      const staging = makeGitCwdTree({ 'src/kit/probe.ts': 'export const ok = 1\n' })
      try {
        const r = spawnSync('node', [h.script], {
          encoding: 'utf-8',
          env: { ...process.env, ARBITER_HOOK_GIT_CWD: staging.dir },
        })
        expect(r.status).toBe(0)
        expect(r.stdout).toContain('OK')
      } finally {
        staging.cleanup()
      }
    } finally {
      h.cleanup()
    }
  })

  it('fails closed — not a silent skip — when a git-tracked file cannot be read from the resolved tree', () => {
    const staging = makeGitCwdTree({ 'src/kit/gone.ts': 'export const ok = 1\n' })
    try {
      // Still tracked (git ls-files lists it from the index) but removed from disk: a scanner
      // that swallows this into a silent skip is exactly the fail-open gap CANON-22 flags in
      // code being touched by this fix — a file this security scanner cannot read must count
      // against it, not pass it through unexamined.
      rmSync(join(staging.dir, 'src', 'kit', 'gone.ts'))
      const r = spawnSync('node', [REAL_SCRIPT], {
        encoding: 'utf-8',
        env: { ...process.env, ARBITER_HOOK_GIT_CWD: staging.dir },
      })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('src/kit/gone.ts')
      expect(r.stderr).not.toContain('WARN')
    } finally {
      staging.cleanup()
    }
  })
})
