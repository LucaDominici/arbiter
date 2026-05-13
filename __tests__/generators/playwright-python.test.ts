import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
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

  it('returns 2 files for frontend-spa', () => {
    const config = makeConfig(dir, {
      language: 'python',
      archetype: 'frontend-spa',
    })
    const result = generatePlaywrightPython(config)
    expect(result.files).toHaveLength(2)
  })
})
