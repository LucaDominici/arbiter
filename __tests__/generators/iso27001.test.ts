// SPDX-License-Identifier: Apache-2.0
// RED tests for #1252 — ISO 27001 Annex-A overlay generator (controls→gates).
// These tests fail until src/generators/iso27001.ts is implemented.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateIso27001 } from '../../src/generators/iso27001.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateIso27001 (#1252)', () => {
  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('returns non-empty files for industryOverlay=iso27001 (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('emits the controls→gate traceability doc (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    expect(mapFile).toBeDefined()
    expect(mapFile!.action).toBe('created')
    expect(existsSync(mapFile!.path)).toBe(true)
  })

  it('places compliance docs under docs/compliance (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    expect(mapFile!.path).toContain('docs/compliance')
  })

  // ─── Content checks: issue-named Annex-A controls → fail-closed gates ─────────

  it('maps the issue-named Annex-A controls (A.8.25/26/28/29/32) (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    const content = readFileSync(mapFile!.path, 'utf-8')
    expect(content).toContain('A.8.25')
    expect(content).toContain('A.8.26')
    expect(content).toContain('A.8.28')
    expect(content).toContain('A.8.29')
    expect(content).toContain('A.8.32')
  })

  it('covers access-control and SBOM/supply-chain controls (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    const content = readFileSync(mapFile!.path, 'utf-8')
    expect(content).toMatch(/access control/i)
    expect(content).toMatch(/SBOM|supply chain/i)
  })

  it('binds A.8.32 change-management to the commit-footer audit gate (INV-119) (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    const content = readFileSync(mapFile!.path, 'utf-8')
    expect(content).toContain('INV-119')
  })

  it('references real fail-closed arbiter gates (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    const content = readFileSync(mapFile!.path, 'utf-8')
    expect(content).toContain('check-all')
    expect(content).toMatch(/npm audit|dep-check|dependency-check/i)
    expect(content).toMatch(/gitleaks|pii-scan/i)
  })

  it('interpolates the project name in the traceability doc (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
      projectName: 'iso-demo-app',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    const content = readFileSync(mapFile!.path, 'utf-8')
    expect(content).toContain('iso-demo-app')
  })

  it('leaves no unrendered EJS markers in the traceability doc (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    const result = generateIso27001(config)
    const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
    const content = readFileSync(mapFile!.path, 'utf-8')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  // ─── Language-neutral (overlay must work on any stack) ─────────────────────────

  it('is language-neutral — emits for non-Java projects (#1252)', () => {
    const goDir = createTestProject('go')
    try {
      const config = makeConfig(goDir, {
        language: 'go',
        industryOverlay: 'iso27001',
      })
      const result = generateIso27001(config)
      expect(result.files.length).toBeGreaterThan(0)
      const mapFile = result.files.find((f) => f.path.endsWith('iso27001-controls-gate-map.md'))
      const content = readFileSync(mapFile!.path, 'utf-8')
      expect(content).not.toContain('@Entity')
      expect(content).not.toContain('.java')
    } finally {
      cleanupTestProject(goDir)
    }
  })

  // ─── Negative cases ───────────────────────────────────────────────────────────

  it('returns empty files when industryOverlay is not iso27001 (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'gdpr',
    })
    const result = generateIso27001(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files when industryOverlay is absent (#1252)', () => {
    const config = makeConfig(dir, { language: 'typescript' })
    const result = generateIso27001(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files when industryOverlay is none (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'none',
    })
    const result = generateIso27001(config)
    expect(result.files).toHaveLength(0)
  })

  // ─── Idempotency ──────────────────────────────────────────────────────────────

  it('is idempotent — second run returns skipped (#1252)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      industryOverlay: 'iso27001',
    })
    generateIso27001(config)
    const result2 = generateIso27001(config)
    for (const f of result2.files) {
      expect(f.action).toBe('skipped')
    }
  })
})
