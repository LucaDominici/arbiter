// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit test for src/generators/anti-proforma.ts
// Red phase: all tests must FAIL until generator is implemented.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateAntiProforma } from '../../src/generators/anti-proforma.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('typescript')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generateAntiProforma (#1249, CANON-05)', () => {
  it('generateAntiProforma emits check-anti-proforma.mjs to scripts/ dir', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L1',
    })
    const result = generateAntiProforma(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('check-anti-proforma.mjs'))).toBe(true)
    const scriptFile = result.files.find((f) => f.path.endsWith('check-anti-proforma.mjs'))
    expect(existsSync(scriptFile!.path)).toBe(true)
  })

  it('emitted script contains CATALOG marker block (INV-94)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L1',
    })
    const result = generateAntiProforma(config)
    const scriptFile = result.files.find((f) => f.path.endsWith('check-anti-proforma.mjs'))
    const content = readFileSync(scriptFile!.path, 'utf-8')
    const catalogLines = content.split('\n').filter((l: string) => l.startsWith('// CATALOG:'))
    expect(catalogLines.length).toBeGreaterThanOrEqual(3)
  })

  it('generateAntiProforma is idempotent — second run produces same output', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
    })
    const result1 = generateAntiProforma(config)
    const scriptFile1 = result1.files.find((f) => f.path.endsWith('check-anti-proforma.mjs'))
    const content1 = readFileSync(scriptFile1!.path, 'utf-8')
    const result2 = generateAntiProforma(config)
    const scriptFile2 = result2.files.find((f) => f.path.endsWith('check-anti-proforma.mjs'))
    const content2 = readFileSync(scriptFile2!.path, 'utf-8')
    expect(content1).toBe(content2)
  })

  it('generateAntiProforma respects dryRun — no files written', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L1',
    })
    const result = generateAntiProforma(config, { dryRun: true })
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('check-anti-proforma.mjs'))).toBe(true)
    // dryRun: file must NOT exist on disk
    expect(existsSync(join(dir, 'scripts', 'check-anti-proforma.mjs'))).toBe(false)
    // dryRun returns prospective action ('created') without writing files to disk
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
  })

  it('emitted script targets the project directory in scan path', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      governanceLevel: 'L2',
      projectName: 'my-project',
    })
    const result = generateAntiProforma(config)
    const scriptFile = result.files.find((f) => f.path.endsWith('check-anti-proforma.mjs'))
    const content = readFileSync(scriptFile!.path, 'utf-8')
    // Should contain a test file pattern or directory reference
    expect(content).toMatch(/test|spec/i)
  })
})
