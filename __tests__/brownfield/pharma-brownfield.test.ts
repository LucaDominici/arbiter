// SPDX-License-Identifier: Apache-2.0
// CANON-11: brownfield tests for pharma overlay generator (#888)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePharma } from '../../src/generators/pharma.js'

describe('brownfield: pharma overlay generator (CANON-11, #888)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing AuditEvent.java on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })

    // First run — creates the file; second call shows skipped action
    generatePharma(config)
    // First-run file already written; let's simulate user editing it
    const path = join(
      dir,
      'src',
      'main',
      'java',
      'com',
      'example',
      'pharmaapp',
      'audit',
      'AuditEvent.java',
    )
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-customised AuditEvent')

    // Second run — must NOT overwrite
    const result2 = generatePharma(config)
    expect(readFileSync(path, 'utf-8')).toBe('// user-customised AuditEvent')
    const f = result2.files.find((f) => f.path.endsWith('AuditEvent.java'))
    expect(f?.action).toBe('skipped')
  })

  it('does not overwrite existing AuditMapper.java on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })

    generatePharma(config)
    const path = join(
      dir,
      'src',
      'main',
      'java',
      'com',
      'example',
      'pharmaapp',
      'audit',
      'AuditMapper.java',
    )
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-customised AuditMapper')

    generatePharma(config)
    expect(readFileSync(path, 'utf-8')).toBe('// user-customised AuditMapper')
  })

  it('does not overwrite existing PharmaArchUnitTest.java on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })

    generatePharma(config)
    const path = join(
      dir,
      'src',
      'test',
      'java',
      'com',
      'example',
      'pharmaapp',
      'architecture',
      'PharmaArchUnitTest.java',
    )
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-customised PharmaArchUnitTest')

    generatePharma(config)
    expect(readFileSync(path, 'utf-8')).toBe('// user-customised PharmaArchUnitTest')
  })

  it('second run returns all actions as skipped (idempotency contract)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })

    generatePharma(config)
    const result2 = generatePharma(config)
    for (const f of result2.files) {
      expect(f.action).toBe('skipped')
    }
  })
})
