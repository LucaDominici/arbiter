// SPDX-License-Identifier: Apache-2.0
// TDD red → green: C4 (#1396) — 7 DOC-* probes for docs-convention family.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import {
  probeDDocReadme,
  probeDDocChangelog,
  probeDDocAdr,
  probeDDocContributing,
  probeDDocLicense,
  probeDDocApiDocs,
  probeDDocSecurity,
} from '../../src/conformance/doc-probes.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-probe-test-'))
  created.push(dir)
  return dir
}

// ─── DOC-README ───────────────────────────────────────────────────────────────

describe('probeDDocReadme (#1396)', () => {
  it('Y when README.md exists and has minimum required sections', () => {
    const root = tmpRoot()
    writeFileSync(
      join(root, 'README.md'),
      '# Project\n\n## Installation\n\nDo stuff.\n\n## Usage\n\nDo more stuff.\n',
    )
    const entry = probeDDocReadme(root)
    expect(entry.id).toBe('DOC-README')
    expect(entry.family).toBe('docs-convention')
    expect(entry.verdict).toBe('Y')
    expect(entry.evidence).toHaveProperty('file')
  })

  it('N when README.md is absent', () => {
    const root = tmpRoot()
    const entry = probeDDocReadme(root)
    expect(entry.verdict).toBe('N')
    expect(entry.evidence).toHaveProperty('file')
    expect((entry.evidence as { file: string }).file).toContain('README')
  })

  it('P when README.md exists but is too short (< 100 chars)', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'README.md'), '# Short\n')
    const entry = probeDDocReadme(root)
    expect(entry.verdict).toBe('P')
  })
})

// ─── DOC-CHANGELOG ────────────────────────────────────────────────────────────

describe('probeDDocChangelog (#1396)', () => {
  it('Y when CHANGELOG.md exists', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## v1.0.0\n\n- Initial release\n')
    const entry = probeDDocChangelog(root)
    expect(entry.id).toBe('DOC-CHANGELOG')
    expect(entry.verdict).toBe('Y')
  })

  it('N when CHANGELOG.md is absent', () => {
    const root = tmpRoot()
    const entry = probeDDocChangelog(root)
    expect(entry.verdict).toBe('N')
  })
})

// ─── DOC-ADR ─────────────────────────────────────────────────────────────────

describe('probeDDocAdr (#1396)', () => {
  it('Y when docs/ADR/ directory exists with at least one .md file', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'docs', 'ADR'), { recursive: true })
    writeFileSync(join(root, 'docs', 'ADR', 'ADR-001-init.md'), '# ADR 001\n')
    const entry = probeDDocAdr(root)
    expect(entry.id).toBe('DOC-ADR')
    expect(entry.verdict).toBe('Y')
  })

  it('N when docs/ADR/ directory is absent', () => {
    const root = tmpRoot()
    const entry = probeDDocAdr(root)
    expect(entry.verdict).toBe('N')
  })

  it('P when docs/ADR/ exists but has no .md files', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'docs', 'ADR'), { recursive: true })
    const entry = probeDDocAdr(root)
    expect(entry.verdict).toBe('P')
  })
})

// ─── DOC-CONTRIBUTING ─────────────────────────────────────────────────────────

describe('probeDDocContributing (#1396)', () => {
  it('Y when CONTRIBUTING.md exists', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'CONTRIBUTING.md'), '# Contributing\n\nFork and PR.\n')
    const entry = probeDDocContributing(root)
    expect(entry.id).toBe('DOC-CONTRIBUTING')
    expect(entry.verdict).toBe('Y')
  })

  it('N when CONTRIBUTING.md is absent', () => {
    const root = tmpRoot()
    const entry = probeDDocContributing(root)
    expect(entry.verdict).toBe('N')
  })
})

// ─── DOC-LICENSE ─────────────────────────────────────────────────────────────

describe('probeDDocLicense (#1396)', () => {
  it('Y when LICENSE file exists', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'LICENSE'), 'Apache License 2.0\n')
    const entry = probeDDocLicense(root)
    expect(entry.id).toBe('DOC-LICENSE')
    expect(entry.verdict).toBe('Y')
  })

  it('Y when LICENSE.md exists', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'LICENSE.md'), 'Apache License 2.0\n')
    const entry = probeDDocLicense(root)
    expect(entry.verdict).toBe('Y')
  })

  it('N when no LICENSE file exists', () => {
    const root = tmpRoot()
    const entry = probeDDocLicense(root)
    expect(entry.verdict).toBe('N')
  })
})

// ─── DOC-API-DOCS ─────────────────────────────────────────────────────────────

describe('probeDDocApiDocs (#1396)', () => {
  it('Y when docs/API/ directory exists with at least one file', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'docs', 'API'), { recursive: true })
    writeFileSync(join(root, 'docs', 'API', 'index.md'), '# API Reference\n')
    const entry = probeDDocApiDocs(root)
    expect(entry.id).toBe('DOC-API-DOCS')
    expect(entry.verdict).toBe('Y')
  })

  it('NV when docs/API/ directory is absent (not required for all projects)', () => {
    const root = tmpRoot()
    const entry = probeDDocApiDocs(root)
    expect(entry.verdict).toBe('NV')
  })
})

// ─── DOC-SECURITY ─────────────────────────────────────────────────────────────

describe('probeDDocSecurity (#1396)', () => {
  it('Y when SECURITY.md exists', () => {
    const root = tmpRoot()
    writeFileSync(join(root, 'SECURITY.md'), '# Security Policy\n\nReport via email.\n')
    const entry = probeDDocSecurity(root)
    expect(entry.id).toBe('DOC-SECURITY')
    expect(entry.verdict).toBe('Y')
  })

  it('NV when SECURITY.md is absent (recommended but not required)', () => {
    const root = tmpRoot()
    const entry = probeDDocSecurity(root)
    expect(entry.verdict).toBe('NV')
  })
})
