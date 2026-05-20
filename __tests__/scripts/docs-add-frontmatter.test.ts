// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const SCRIPT = join(REPO_ROOT, 'scripts/docs-add-frontmatter.mjs')

function runCodemod(args: string[], cwd: string): { stdout: string; stderr: string } {
  const result = execFileSync('node', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { stdout: result, stderr: '' }
}

function runCodemodCatch(args: string[], cwd: string): { status: number; stderr: string } {
  try {
    execFileSync('node', [SCRIPT, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stderr?: string }
    return { status: err.status ?? 1, stderr: err.stderr ?? '' }
  }
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'frontmatter-codemod-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('docs-add-frontmatter — adds missing block', () => {
  it('prepends a full frontmatter block to a markdown file with no frontmatter', () => {
    const subdir = join(tmpRoot, 'docs')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'sample.md'), '# Hello world\n\nBody.\n')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    const after = readFileSync(join(subdir, 'sample.md'), 'utf-8')
    expect(after).toMatch(/^---\n/)
    expect(after).toMatch(/title: "Hello world"/)
    expect(after).toMatch(/doc_version: "1.0.0"/)
    expect(after).toMatch(/status: active/)
    expect(after).toMatch(/last_review: "\d{4}-\d{2}-\d{2}"/)
    expect(after).toMatch(/tags: \[\]/)
    expect(after).toMatch(/---\n\n# Hello world\n\nBody\.\n/)
  })

  it('falls back to empty title when no H1 is present', () => {
    const subdir = join(tmpRoot, 'docs')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'no-h1.md'), 'Just a paragraph.\n')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    const after = readFileSync(join(subdir, 'no-h1.md'), 'utf-8')
    expect(after).toMatch(/title: ""/)
  })
})

describe('docs-add-frontmatter — merges into existing block (VitePress-safe)', () => {
  it('preserves existing top-level keys and nested values; only appends missing keys', () => {
    const subdir = join(tmpRoot, 'website')
    mkdirSync(subdir, { recursive: true })
    const vitepress = `---
layout: home

hero:
  name: arbiter
  text: AI governance that installs itself.
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart/

features:
  - title: One command
    details: Stuff
---

# Heading

Body.
`
    writeFileSync(join(subdir, 'index.md'), vitepress)

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    const after = readFileSync(join(subdir, 'index.md'), 'utf-8')
    // Existing keys + nested values survive byte-identical.
    expect(after).toContain('layout: home\n')
    expect(after).toContain('hero:\n  name: arbiter\n')
    expect(after).toContain('    - theme: brand\n      text: Get Started\n')
    expect(after).toContain('features:\n  - title: One command\n')
    // Missing keys appended.
    expect(after).toMatch(/doc_version: "1.0.0"/)
    expect(after).toMatch(/status: active/)
    expect(after).toMatch(/tags: \[\]/)
    // Body untouched.
    expect(after).toContain('# Heading\n\nBody.\n')
  })

  it('does not overwrite existing values for required keys', () => {
    const subdir = join(tmpRoot, 'docs')
    mkdirSync(subdir, { recursive: true })
    const withPartial = `---
doc_version: "3.2.1"
status: deprecated
---

# Existing
`
    writeFileSync(join(subdir, 'partial.md'), withPartial)

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    const after = readFileSync(join(subdir, 'partial.md'), 'utf-8')
    expect(after).toContain('doc_version: "3.2.1"')
    expect(after).toContain('status: deprecated')
    // Missing keys appended without disturbing the existing two.
    expect(after).toMatch(/title: "Existing"/)
    expect(after).toMatch(/tags: \[\]/)
  })
})

describe('docs-add-frontmatter — idempotency + check mode', () => {
  it('is a no-op on a file that already has every required key', () => {
    const subdir = join(tmpRoot, 'docs')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'done.md'), '# X\n')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)
    const firstPass = readFileSync(join(subdir, 'done.md'), 'utf-8')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)
    const secondPass = readFileSync(join(subdir, 'done.md'), 'utf-8')

    expect(secondPass).toBe(firstPass)
  })

  it('--check exits 1 when a file would change', () => {
    const subdir = join(tmpRoot, 'docs')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'fresh.md'), '# X\n')

    const r = runCodemodCatch(['--check', '--dirs', subdir], REPO_ROOT)
    expect(r.status).toBe(1)
  })

  it('--check exits 0 when every file is up to date', () => {
    const subdir = join(tmpRoot, 'docs')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'fresh.md'), '# X\n')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)
    const r = runCodemodCatch(['--check', '--dirs', subdir], REPO_ROOT)
    expect(r.status).toBe(0)
  })
})

describe('docs-add-frontmatter — hard-skips', () => {
  it('does not touch .changeset/ entries even when explicitly targeted', () => {
    const subdir = join(tmpRoot, 'project')
    const changesetDir = join(subdir, '.changeset')
    mkdirSync(changesetDir, { recursive: true })
    writeFileSync(join(changesetDir, 'an-entry.md'), `---\n"@arbiter/cli": patch\n---\n\nFix\n`)

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    const after = readFileSync(join(changesetDir, 'an-entry.md'), 'utf-8')
    // changeset entries must NOT receive arbiter frontmatter.
    expect(after).not.toMatch(/doc_version:/)
    expect(after).toContain('"@arbiter/cli": patch')
  })

  it('does not touch api/*.api.md generated files', () => {
    const subdir = join(tmpRoot, 'project')
    const apiDir = join(subdir, 'api')
    mkdirSync(apiDir, { recursive: true })
    writeFileSync(join(apiDir, 'cli.api.md'), '<!-- api-snapshot hash:abc -->\n\n# API\n')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    const after = readFileSync(join(apiDir, 'cli.api.md'), 'utf-8')
    expect(after).not.toMatch(/doc_version:/)
  })

  it('does not touch CHANGELOG.md, LICENSE, NOTICE', () => {
    const subdir = join(tmpRoot, 'project')
    mkdirSync(subdir, { recursive: true })
    writeFileSync(join(subdir, 'CHANGELOG.md'), '# Changelog\n')
    writeFileSync(join(subdir, 'LICENSE'), 'MIT\n')
    writeFileSync(join(subdir, 'NOTICE'), 'X\n')

    runCodemod(['--apply', '--dirs', subdir], REPO_ROOT)

    expect(readFileSync(join(subdir, 'CHANGELOG.md'), 'utf-8')).not.toMatch(/doc_version:/)
    expect(readFileSync(join(subdir, 'LICENSE'), 'utf-8')).toBe('MIT\n')
    expect(readFileSync(join(subdir, 'NOTICE'), 'utf-8')).toBe('X\n')
  })
})
