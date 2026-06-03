// SPDX-License-Identifier: Apache-2.0
// #1150: Kotlin beta stack — quality (Sonar) + modulith generation, matrix entries.
// Kotlin compiles to JVM bytecode, so the Java Sonar/Modulith/ArchUnit scaffolding
// applies; these tests assert Kotlin no longer silently under-generates.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { generateQuality } from '../../src/generators/quality.js'
import { generateModulith } from '../../src/generators/modulith.js'
import type { ProjectConfig } from '../../src/wizard/types.js'

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    language: 'kotlin',
    buildTool: 'gradle',
    targetDir: '',
    projectName: 'kotlin-service',
    governanceLevel: 'L2',
    archetype: 'backend-web-db',
    architectureStyle: 'hexagonal',
    useGitHub: true,
    basePackage: 'com.example',
    kitEnabled: true,
    ...overrides,
  } as ProjectConfig
}

let tmpDir: string
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arbiter-kotlin-'))
})
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Kotlin beta — quality generator (#1150)', () => {
  it('emits Sonar config for kotlin (previously silent under-generation)', () => {
    const result = generateQuality(makeConfig({ targetDir: tmpDir }))
    expect(result.files.length).toBeGreaterThan(0)
  })
})

describe('Kotlin beta — modulith generator (#1150)', () => {
  it('emits modulith scaffolding for a kotlin Spring project', () => {
    const result = generateModulith(makeConfig({ targetDir: tmpDir }))
    expect(result.files.length).toBeGreaterThan(0)
  })
})

describe('Kotlin beta — cross-language matrix (#1150)', () => {
  it('declares kotlin beta cells for the core enforcement areas', () => {
    const matrix = JSON.parse(
      readFileSync('src/compatibility/cross-language-matrix.json', 'utf-8'),
    ) as Record<string, Record<string, { maturity: string }>>
    for (const cat of ['static_analysis', 'coverage', 'architecture', 'mutation']) {
      expect(matrix[cat].kotlin).toBeDefined()
      expect(matrix[cat].kotlin.maturity).toBe('beta')
    }
  })
})
