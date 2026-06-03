// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/gen-adr-readme.mjs')
const REPO_ROOT = resolve('.')

function run(cwd: string = REPO_ROOT, args: string[] = []) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gen-adr-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('gen-adr-readme.mjs (ADR README and DECISIONS.md generation)', () => {
  it('exits 0 on real repo with valid ADRs (write mode)', () => {
    // The real repo should have docs/ADR/*.md files; script generates output.
    // This test verifies the script runs successfully in write mode.
    const result = run(REPO_ROOT, [])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('gen-adr-readme')
  })

  it('exits 0 on --check when generated files are current', () => {
    // First, generate the files in the real repo (ensure they are current).
    const genResult = run(REPO_ROOT, [])
    expect(genResult.status).toBe(0)

    // Now run --check; should pass because files are up to date.
    const checkResult = run(REPO_ROOT, ['--check'])
    expect(checkResult.status).toBe(0)
    expect(checkResult.stdout).toContain('up to date')
  })

  it('exits 1 on --check when README.md is out of date (drift detected)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Set up a minimal fixture with one ADR.
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      const adrFile = join(adrDir, '001-test.md')
      writeFileSync(
        adrFile,
        `---
title: 'Test Decision'
status: active
last_review: '2026-06-01'
---

# Test ADR

**Decision:** This is a test decision.
`,
      )

      // Generate initial files.
      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      // Modify README.md to introduce drift.
      const readmePath = join(adrDir, 'README.md')
      const currentReadme = readFileSync(readmePath, 'utf-8')
      writeFileSync(readmePath, currentReadme + '\n# Corrupted\n', 'utf-8')

      // Run --check; should fail.
      const checkResult = run(dir, ['--check'])
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('out of date')
    } finally {
      cleanup()
    }
  })

  it('exits 1 on --check when DECISIONS.md digest is out of date', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Set up fixture with one ADR.
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      const adrFile = join(adrDir, '002-test.md')
      writeFileSync(
        adrFile,
        `---
title: 'Another Test'
status: active
last_review: '2026-06-01'
---

# Test ADR 2

**Decision:** Another test decision.
`,
      )

      // Generate initial files.
      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      // Corrupt DECISIONS.md.
      const decisionsPath = join(sysDir, 'DECISIONS.md')
      writeFileSync(decisionsPath, 'corrupted digest', 'utf-8')

      // Run --check; should fail.
      const checkResult = run(dir, ['--check'])
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('out of date')
    } finally {
      cleanup()
    }
  })

  it('exits 2 on fatal error (missing ADR directory)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // Create docs/SYSTEM but NOT docs/ADR; this will cause readdirSync to fail.
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(sysDir, { recursive: true })
      // docs/ADR is intentionally missing → ENOENT on readdirSync

      const result = run(dir, [])
      expect(result.status).toBe(2)
      expect(result.stdout).toContain('fatal')
    } finally {
      cleanup()
    }
  })

  it('exits 2 on fatal error (unreadable ADR file)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      // Create a file that will exist in readdirSync but cause readFileSync to fail
      // (e.g., by making it a directory with a .md extension, or permission issue).
      // For portability, create a directory with .md extension.
      const badFile = join(adrDir, '999-bad.md')
      mkdirSync(badFile) // directory, not file → readFileSync will fail

      const result = run(dir, [])
      expect(result.status).toBe(2)
      expect(result.stdout).toContain('fatal')
    } finally {
      cleanup()
    }
  })

  it('parses ADR frontmatter correctly (title, status, last_review)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      writeFileSync(
        join(adrDir, '042-parsing-test.md'),
        `---
title: 'Custom Title with Quotes'
status: superseded
last_review: '2025-12-31'
---

# ADR Title

**Decision:** The decision is sound.
`,
      )

      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      // Verify README was generated and contains the custom title and status.
      const readmePath = join(adrDir, 'README.md')
      const readme = readFileSync(readmePath, 'utf-8')
      expect(readme).toContain('042')
      expect(readme).toContain('Custom Title')
      expect(readme).toContain('superseded')
    } finally {
      cleanup()
    }
  })

  it('extracts Decision section summary from ADR body', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      writeFileSync(
        join(adrDir, '050-summary-test.md'),
        `---
title: 'Summary Test'
status: active
last_review: '2026-06-01'
---

# ADR 050

**Decision:** This is the extracted summary text.
`,
      )

      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      const readmePath = join(adrDir, 'README.md')
      const readme = readFileSync(readmePath, 'utf-8')
      expect(readme).toContain('This is the extracted summary text')
    } finally {
      cleanup()
    }
  })

  it('uses latest ADR date as lastReview in digest (deterministic, not new Date())', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      // Write two ADRs with different dates.
      writeFileSync(
        join(adrDir, '001-old.md'),
        `---
title: 'Old'
status: active
last_review: '2025-01-01'
---

**Decision:** Old.
`,
      )

      writeFileSync(
        join(adrDir, '002-new.md'),
        `---
title: 'New'
status: active
last_review: '2026-05-31'
---

**Decision:** New.
`,
      )

      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      // Check that README.md last_review is the latest (2026-05-31), not today.
      const readmePath = join(adrDir, 'README.md')
      const readme = readFileSync(readmePath, 'utf-8')
      expect(readme).toContain("last_review: '2026-05-31'")
    } finally {
      cleanup()
    }
  })

  it('ignores non-NNN-*.md files in ADR directory', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      // Valid ADR.
      writeFileSync(
        join(adrDir, '001-valid.md'),
        `---
title: 'Valid'
status: active
last_review: '2026-06-01'
---

**Decision:** Valid ADR.
`,
      )

      // Invalid names (should be ignored).
      writeFileSync(join(adrDir, 'README.md'), '# Not an ADR')
      writeFileSync(join(adrDir, 'TEMPLATE.md'), '# Template')
      writeFileSync(join(adrDir, 'index.md'), '# Index')

      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      const readmePath = join(adrDir, 'README.md')
      const readme = readFileSync(readmePath, 'utf-8')
      // Should only contain the one valid ADR (001).
      expect(readme).toContain('001')
      expect(readme).toContain('Valid')
      // Should not list the invalid files as ADR entries (the word "index"
      // legitimately appears in the boilerplate prose, so match the filename link).
      expect(readme).not.toContain('TEMPLATE.md')
      expect(readme).not.toContain('(index.md)')
    } finally {
      cleanup()
    }
  })

  it('generates DECISIONS.md digest with correct frontmatter and table', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const adrDir = join(dir, 'docs', 'ADR')
      const sysDir = join(dir, 'docs', 'SYSTEM')
      mkdirSync(adrDir, { recursive: true })
      mkdirSync(sysDir, { recursive: true })

      writeFileSync(
        join(adrDir, '005-digest-test.md'),
        `---
title: 'Digest Check'
status: active
last_review: '2026-05-20'
---

**Decision:** Test digest generation.
`,
      )

      const genResult = run(dir, [])
      expect(genResult.status).toBe(0)

      const decisionsPath = join(sysDir, 'DECISIONS.md')
      const decisions = readFileSync(decisionsPath, 'utf-8')
      expect(decisions).toContain("title: 'Architectural Decision Records — Generated Digest'")
      expect(decisions).toContain('status: generated')
      expect(decisions).toContain('005')
      expect(decisions).toContain('Digest Check')
      expect(decisions).toContain('GENERATED — do not edit')
    } finally {
      cleanup()
    }
  })
})
