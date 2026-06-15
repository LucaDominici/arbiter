// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/conformance.ts (#1398, INV-128).
// CANON-04: render test for src/templates/scripts/conformance.mjs.ejs.
// CANON-11: brownfield / skipIfExists test for the file-emitting generator.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { renderTemplate } from '../../src/utils/render.js'
import { generateConformanceScript } from '../../src/generators/conformance.js'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'
import { generateCheckAll } from '../../src/generators/check-all.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

// ─── CANON-05: generator unit tests ──────────────────────────────────────────

describe('generateConformanceScript (#1398, CANON-05)', () => {
  it('emits scripts/conformance.mjs to the target project', () => {
    const config = makeConfig(dir)
    const result = generateConformanceScript(config)
    const scriptFile = result.files.find((f) => f.path.endsWith('scripts/conformance.mjs'))
    expect(scriptFile).toBeDefined()
    expect(existsSync(scriptFile!.path)).toBe(true)
  })

  it('emits exactly one file', () => {
    const config = makeConfig(dir)
    const result = generateConformanceScript(config)
    expect(result.files).toHaveLength(1)
  })

  it('emitted script contains arbiter conformance invocation', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config)
    const content = readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')
    expect(content).toContain('arbiter')
    expect(content).toContain('conformance')
  })

  it('emitted script contains SPDX header', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config)
    const content = readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')
    expect(content).toContain('SPDX-License-Identifier: Apache-2.0')
  })

  it('respects dryRun — no file written to disk', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config, { dryRun: true })
    expect(existsSync(join(dir, 'scripts', 'conformance.mjs'))).toBe(false)
  })
})

// ─── CANON-04: template render test ──────────────────────────────────────────

describe('conformance.mjs.ejs render (CANON-04)', () => {
  it('renders without error and produces non-empty content', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content.trim().length).toBeGreaterThan(0)
  })

  it('rendered output passes node --check (syntax-valid JS)', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    const scriptPath = join(dir, 'scripts', 'conformance-render-check.mjs')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(scriptPath, content)
    const r = spawnSync('node', ['--check', scriptPath], { encoding: 'utf-8' })
    expect(r.status, `node --check failed:\n${r.stderr}`).toBe(0)
  })

  it('rendered output contains shebang on first line', () => {
    const config = makeConfig(dir)
    const content = renderTemplate('scripts/conformance.mjs.ejs', config)
    expect(content.split('\n')[0]).toBe('#!/usr/bin/env node')
  })
})

// ─── CANON-11: brownfield / skipIfExists test ─────────────────────────────────

describe('generateConformanceScript brownfield re-init (CANON-11)', () => {
  it('skipIfExists: second run returns skipped action and does NOT overwrite existing file', () => {
    const config = makeConfig(dir)
    generateConformanceScript(config)
    const firstContent = readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')

    // Simulate a customised script
    const customContent = firstContent + '\n// customised by team\n'
    writeFileSync(join(dir, 'scripts', 'conformance.mjs'), customContent)

    const secondResult = generateConformanceScript(config)
    const skipped = secondResult.files.find((f) => f.path.endsWith('scripts/conformance.mjs'))
    expect(skipped?.action).toBe('skipped')
    // File should still contain customisation
    expect(readFileSync(join(dir, 'scripts', 'conformance.mjs'), 'utf-8')).toBe(customContent)
  })
})

// ─── CANON-11: UNCONDITIONAL_EMISSIONS includes conformance ──────────────────

describe('generateCheckAll UNCONDITIONAL_EMISSIONS (INV-128, CANON-11)', () => {
  it('generateCheckAll for backend-web-db includes scripts/conformance.mjs', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    const result = generateCheckAll(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/conformance.mjs'))).toBe(true)
  })

  it('generateCheckAll for cli archetype includes scripts/conformance.mjs', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'cli' })
    const result = generateCheckAll(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('scripts/conformance.mjs'))).toBe(true)
  })

  it('generated check-all.mjs L2 references conformance advisory', () => {
    const config = makeConfig(dir, { language: 'typescript', governanceLevel: 'L2' })
    generateCheckAll(config)
    const checkAll = readFileSync(join(dir, 'scripts', 'check-all.mjs'), 'utf-8')
    expect(checkAll).toContain('conformance.mjs')
    expect(checkAll).toContain('runWarnCheck')
  })
})

// ─── INV-128 id-stability: catalog entry ─────────────────────────────────────

describe('INV-128 id-stability (catalog)', () => {
  it('catalog has exactly 1 entry with id INV-128', () => {
    const entries = INVARIANT_CATALOG.filter((inv) => inv.id === 'INV-128')
    expect(entries).toHaveLength(1)
  })

  it('INV-128 has selfOnly: false (targets, not just arbiter-self)', () => {
    const inv = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-128')
    expect(inv?.selfOnly).toBe(false)
  })

  it('INV-128 is operational tier', () => {
    const inv = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-128')
    expect(inv?.tier).toBe('operational')
  })

  it('INV-128 has minGovernanceLevel L1', () => {
    const inv = INVARIANT_CATALOG.find((inv) => inv.id === 'INV-128')
    expect(inv?.minGovernanceLevel).toBe('L1')
  })
})
