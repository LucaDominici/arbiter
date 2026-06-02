// Tests for generatePlaywrightPython — #349 (conftest+smoke) + #1149 (a11y wrapper + spec)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePlaywrightPython } from '../../src/generators/playwright-python.js'

describe('generatePlaywrightPython', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('python')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits conftest.py for frontend-spa', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'conftest.py'))).toBe(true)
  })

  it('emits test_smoke.py for frontend-spa', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'test_smoke.py'))).toBe(true)
  })

  it('emits conftest.py for backend-web-db', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'backend-web-db',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'conftest.py'))).toBe(true)
  })

  it('does NOT emit e2e files for library archetype', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'library',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'conftest.py'))).toBe(false)
  })

  // #1149: returns 5 files (conftest + smoke + a11y/__init__ + a11y wrapper + a11y spec)
  it('returns 5 files for frontend-spa', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    const result = generatePlaywrightPython(config)
    expect(result.files).toHaveLength(5)
  })

  // #1149: a11y files emitted
  it('emits tests/e2e/a11y/__init__.py for frontend-spa (Python package marker)', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', '__init__.py'))).toBe(true)
  })

  it('emits tests/e2e/a11y/run_axe.py for frontend-spa', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'))).toBe(true)
  })

  it('emits tests/e2e/test_a11y.py for frontend-spa', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'test_a11y.py'))).toBe(true)
  })

  it('emits a11y files for backend-web-db', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'backend-web-db',
    })
    generatePlaywrightPython(config)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', '__init__.py'))).toBe(true)
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'))).toBe(true)
    expect(existsSync(join(dir, 'tests', 'e2e', 'test_a11y.py'))).toBe(true)
  })

  it('emitted run_axe.py contains WCAG 2.2 AA tag set', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    const content = readFileSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'), 'utf-8')
    expect(content).toMatch(/wcag22aa/)
    expect(content).toMatch(/wcag2a/)
    expect(content).toMatch(/wcag2aa/)
    expect(content).toMatch(/wcag21a/)
    expect(content).toMatch(/wcag21aa/)
  })

  it('emitted run_axe.py enforces critical hard-fail (INV-61)', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    const content = readFileSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'), 'utf-8')
    expect(content).toMatch(/critical/)
    expect(content).toMatch(/INV-61/)
    // critical and unclassified trigger raise
    expect(content).toMatch(/raise/)
  })

  it('emitted run_axe.py uses resultTypes=violations to prevent payload bloat', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    const content = readFileSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'), 'utf-8')
    expect(content).toMatch(/resultTypes/)
    expect(content).toMatch(/violations/)
  })

  it('emitted run_axe.py imports axe_playwright_python sync module', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    generatePlaywrightPython(config)
    const content = readFileSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'), 'utf-8')
    expect(content).toMatch(/axe_playwright_python/)
    expect(content).toMatch(/sync_playwright/)
  })

  // #1149: language guard — TS frontend-spa must not emit Python files
  it('does NOT emit e2e files when language is typescript', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      archetype: 'frontend-spa',
    })
    const result = generatePlaywrightPython(config)
    expect(result.files).toHaveLength(0)
    expect(existsSync(join(dir, 'tests', 'e2e', 'conftest.py'))).toBe(false)
  })

  // dryRun: action is 'created' but file not written
  it('dryRun: returns created action for a11y files but does not write to disk', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    const result = generatePlaywrightPython(config, { dryRun: true })
    expect(result.files).toHaveLength(5)
    const a11yWrapper = result.files.find((f) => f.path.endsWith('run_axe.py'))
    const a11ySpec = result.files.find((f) => f.path.endsWith('test_a11y.py'))
    const a11yInit = result.files.find((f) => f.path.endsWith('__init__.py'))
    expect(a11yWrapper).toBeDefined()
    expect(a11ySpec).toBeDefined()
    expect(a11yInit).toBeDefined()
    expect(a11yWrapper?.action).toBe('created')
    expect(a11ySpec?.action).toBe('created')
    expect(a11yInit?.action).toBe('created')
    expect(existsSync(join(dir, 'tests', 'e2e', 'a11y', 'run_axe.py'))).toBe(false)
    expect(existsSync(join(dir, 'tests', 'e2e', 'test_a11y.py'))).toBe(false)
  })
})
