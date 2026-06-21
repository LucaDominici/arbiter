// SPDX-License-Identifier: Apache-2.0
// TDD guard for #902 / #886 — SHA-pin self-check (INV-76, enforced).
// A non-SHA action reference now fails the gate (exit 1); clean repos exit 0.
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

describe('check-action-pins.mjs (#902/#886, INV-76 enforced)', () => {
  it('rejects a tag-pinned ref with exit 1 (no transition)', () => {
    const { dir, cleanup } = makeDir()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('[TRANSITION-WARN]')
      expect(result.stderr).toContain('non-SHA action reference')
      expect(result.stderr).toContain('actions/checkout@v4')
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
      expect(result.stdout).toContain('all action references are SHA-pinned')
      expect(result.stderr).not.toContain('[TRANSITION-WARN]')
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
      expect(result.status).toBe(1)
      expect(result.stderr).not.toContain('[TRANSITION-WARN]')
      expect(result.stderr).toContain('actions/setup-node@v4')
    } finally {
      cleanup()
    }
  })

  // #1491 (security-privacy MAJOR-3): a fabricated/short/tag SHA pin in a workflow TEMPLATE
  // (src/templates/**/workflows/*.ejs) is emitted verbatim into every generated project. The pin
  // gate must vet the emitted source, not only arbiter's own .github/.
  function writeTemplate(dir: string, name: string, body: string): void {
    const wfDir = join(dir, 'src', 'templates', 'github', 'workflows')
    mkdirSync(wfDir, { recursive: true })
    writeFileSync(join(wfDir, name), body)
  }

  it('rejects a fabricated/short SHA pin in a workflow template (.ejs)', () => {
    const { dir, cleanup } = makeDir()
    try {
      // 39-char SHA (one short) — the exact MAJOR-3 defect; not a valid commit object.
      writeTemplate(
        dir,
        'deploy.yml.ejs',
        'jobs:\n  go:\n    steps:\n      - uses: google-github-actions/auth@71f986410dfbc7ef6f5e4d50c57a2b159b3e3ec  # v2\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('non-SHA action reference')
      expect(result.stderr).toContain('71f986410dfbc7ef6f5e4d50c57a2b159b3e3ec')
      expect(result.stderr).toContain('deploy.yml.ejs')
    } finally {
      cleanup()
    }
  })

  it('rejects a tag-pinned ref in a workflow template (.ejs)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeTemplate(
        dir,
        'ci.yml.ejs',
        'jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('actions/checkout@v4')
    } finally {
      cleanup()
    }
  })

  it('accepts a real 40-hex SHA and skips templated/local refs in a workflow template', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeTemplate(
        dir,
        'mixed.yml.ejs',
        'jobs:\n  build:\n    steps:\n' +
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n' +
          '      - uses: actions/setup-node@<%= setupNodeSha %>\n' +
          '      - uses: foo/bar@${{ env.PIN }}\n' +
          '      - uses: ./.github/actions/local\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })

  it('only scans .ejs files under a workflows/ template dir (ignores other templates)', () => {
    const { dir, cleanup } = makeDir()
    try {
      // A non-workflows template with a tag ref must NOT trip the gate.
      const otherDir = join(dir, 'src', 'templates', 'docs')
      mkdirSync(otherDir, { recursive: true })
      writeFileSync(
        join(otherDir, 'example.md.ejs'),
        'Example doc snippet: uses: actions/checkout@v4\n',
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('all action references are SHA-pinned')
    } finally {
      cleanup()
    }
  })
})
