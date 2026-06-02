// SPDX-License-Identifier: Apache-2.0
// Brownfield test for generatePlaywrightPython — #1149 (CANON-11).
// Verifies that re-running init on an existing Python project with hand-edited
// a11y files respects skipIfExists semantics (action === 'skipped').
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePlaywrightPython } from '../../src/generators/playwright-python.js'

describe('generatePlaywrightPython brownfield (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('python')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing run_axe.py on re-run', () => {
    const a11yDir = join(dir, 'tests', 'e2e', 'a11y')
    mkdirSync(a11yDir, { recursive: true })
    const target = join(a11yDir, 'run_axe.py')
    const sentinel = '# User-modified axe runner — do not overwrite\n'
    writeFileSync(target, sentinel)

    generatePlaywrightPython(makeConfig(dir, { language: 'python', archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing test_a11y.py on re-run', () => {
    const e2eDir = join(dir, 'tests', 'e2e')
    mkdirSync(e2eDir, { recursive: true })
    const target = join(e2eDir, 'test_a11y.py')
    const sentinel = '# User-modified a11y spec — do not overwrite\n'
    writeFileSync(target, sentinel)

    generatePlaywrightPython(makeConfig(dir, { language: 'python', archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('all files are skipped on second run', () => {
    const config = makeConfig(dir, { language: 'python', archetype: 'frontend-spa' })
    generatePlaywrightPython(config)
    const result = generatePlaywrightPython(config)
    expect(result.files).toHaveLength(5)
    expect(result.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('does not overwrite existing conftest.py on re-run', () => {
    const e2eDir = join(dir, 'tests', 'e2e')
    mkdirSync(e2eDir, { recursive: true })
    const target = join(e2eDir, 'conftest.py')
    const sentinel = '# User-modified conftest — do not overwrite\n'
    writeFileSync(target, sentinel)

    generatePlaywrightPython(makeConfig(dir, { language: 'python', archetype: 'frontend-spa' }))

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })
})
