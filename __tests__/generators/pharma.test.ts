// SPDX-License-Identifier: Apache-2.0
// RED tests for #888 — pharma overlay generator
// These tests will fail until src/generators/pharma.ts is implemented

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generatePharma } from '../../src/generators/pharma.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('java')
})

afterEach(() => {
  cleanupTestProject(dir)
})

describe('generatePharma', () => {
  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('returns non-empty files for java + industryOverlay=pharma (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('emits AuditEvent.java when java + pharma overlay (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const auditEventFile = result.files.find((f) => f.path.endsWith('AuditEvent.java'))
    expect(auditEventFile).toBeDefined()
    expect(auditEventFile!.action).toBe('created')
    expect(existsSync(auditEventFile!.path)).toBe(true)
  })

  it('emits AuditMapper.java when java + pharma overlay (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const mapperFile = result.files.find((f) => f.path.endsWith('AuditMapper.java'))
    expect(mapperFile).toBeDefined()
    expect(existsSync(mapperFile!.path)).toBe(true)
  })

  it('emits PharmaArchUnitTest.java when java + pharma overlay (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const archUnitFile = result.files.find((f) => f.path.endsWith('PharmaArchUnitTest.java'))
    expect(archUnitFile).toBeDefined()
    expect(existsSync(archUnitFile!.path)).toBe(true)
  })

  // ─── Content checks ───────────────────────────────────────────────────────────

  it('AuditEvent.java contains @Entity and audit fields (dim 73-75) (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const auditEventFile = result.files.find((f) => f.path.endsWith('AuditEvent.java'))
    const content = readFileSync(auditEventFile!.path, 'utf-8')
    expect(content).toContain('@Entity')
    expect(content).toContain('actorId')
    expect(content).toContain('action')
    expect(content).toContain('entityType')
  })

  it('AuditMapper.java contains @Mapper interface (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const mapperFile = result.files.find((f) => f.path.endsWith('AuditMapper.java'))
    const content = readFileSync(mapperFile!.path, 'utf-8')
    expect(content).toContain('@Mapper')
    expect(content).toContain('interface AuditMapper')
  })

  it('PharmaArchUnitTest.java contains R-35 through R-39 rule references (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const archUnitFile = result.files.find((f) => f.path.endsWith('PharmaArchUnitTest.java'))
    const content = readFileSync(archUnitFile!.path, 'utf-8')
    expect(content).toContain('R-35')
    expect(content).toContain('R-36')
    expect(content).toContain('R-37')
    expect(content).toContain('R-38')
    expect(content).toContain('R-39')
  })

  it('uses basePackage in generated files (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const auditEventFile = result.files.find((f) => f.path.endsWith('AuditEvent.java'))
    const content = readFileSync(auditEventFile!.path, 'utf-8')
    expect(content).toContain('com.example.pharmaapp')
  })

  it('places files in src/main/java tree (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const auditEventFile = result.files.find((f) => f.path.endsWith('AuditEvent.java'))
    expect(auditEventFile!.path).toContain('src/main/java')
  })

  it('places ArchUnit test in src/test/java tree (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'pharma',
    })
    const result = generatePharma(config)
    const archUnitFile = result.files.find((f) => f.path.endsWith('PharmaArchUnitTest.java'))
    expect(archUnitFile!.path).toContain('src/test/java')
  })

  // ─── Negative cases ───────────────────────────────────────────────────────────

  it('returns empty files for non-java language (#888)', () => {
    const tsDir = createTestProject('typescript')
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        industryOverlay: 'pharma',
      })
      const result = generatePharma(config)
      expect(result.files).toHaveLength(0)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('returns empty files when industryOverlay is absent (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
    })
    const result = generatePharma(config)
    expect(result.files).toHaveLength(0)
  })

  it('returns empty files when industryOverlay is none (#888)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.pharmaapp',
      industryOverlay: 'none',
    })
    const result = generatePharma(config)
    expect(result.files).toHaveLength(0)
  })

  // ─── Idempotency ──────────────────────────────────────────────────────────────

  it('is idempotent — second run returns skipped (#888)', () => {
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
