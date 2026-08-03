// Tests for #349 — generatePlaywrightTs emits the a11y wrapper + spec stub
// for TS web archetypes. CANON-02/05.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePlaywrightTs } from '../../src/generators/playwright-ts.js'

describe('generatePlaywrightTs (#349)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits tests/e2e/a11y/run-axe.ts for frontend-spa', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generatePlaywrightTs(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run-axe.ts'))).toBe(true)
  })

  it('emits tests/e2e/a11y.spec.ts for frontend-spa', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generatePlaywrightTs(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y.spec.ts'))).toBe(true)
  })

  it('emits the same pair for backend-web-db', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'backend-web-db' })
    generatePlaywrightTs(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run-axe.ts'))).toBe(true)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y.spec.ts'))).toBe(true)
  })

  it('does NOT emit for library archetype', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'library' })
    const result = generatePlaywrightTs(config)
    expect(result.files).toHaveLength(0)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run-axe.ts'))).toBe(false)
  })

  it('does NOT emit for non-typescript languages', () => {
    const config = makeConfig(dir, { language: 'python', archetype: 'frontend-spa' })
    const result = generatePlaywrightTs(config)
    expect(result.files).toHaveLength(0)
  })

  // #1606: a polyglot (multi) repo's frontend lane is a TS SPA — it must get the same
  // a11y/render harness, not be silently stripped of it.
  it('emits the a11y harness for language=multi frontend-spa (#1606)', () => {
    const config = makeConfig(dir, { language: 'multi', archetype: 'frontend-spa' })
    const result = generatePlaywrightTs(config)
    expect(result.files.length).toBeGreaterThan(0)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run-axe.ts'))).toBe(true)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y.spec.ts'))).toBe(true)
  })

  it('emitted run-axe.ts contains the critical-throw policy', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generatePlaywrightTs(config)
    const content = readFileSync(join(dir, 'tests', 'e2e', 'a11y', 'run-axe.ts'), 'utf-8')
    expect(content).toMatch(/critical/)
    expect(content).toMatch(/throw/)
  })

  it('emitted run-axe.ts classifies an undefined impact as unclassified (INV-61)', () => {
    const config = makeConfig(dir, { language: 'typescript', archetype: 'frontend-spa' })
    generatePlaywrightTs(config)
    const content = readFileSync(join(dir, 'tests', 'e2e', 'a11y', 'run-axe.ts'), 'utf-8')
    expect(content).toContain('v.impact === null || v.impact === undefined')
  })
})
