// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateResilience } from '../../src/generators/resilience.js'
import { buildRegistry } from '../../src/generators/registry.js'

// CANON-05 — every generator has a unit test covering happy path + idempotency + negative case.

describe('generateResilience', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  // --------------------------------------------------------------------------
  // Negative: wrong archetype or L1 → no files
  // --------------------------------------------------------------------------

  it('returns no files for non-backend-web-db archetype (cli)', () => {
    const config = makeConfig(dir, {
      archetype: 'cli',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    expect(generateResilience(config).files).toHaveLength(0)
  })

  it('returns no files for non-backend-web-db archetype (library)', () => {
    const config = makeConfig(dir, {
      archetype: 'library',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    expect(generateResilience(config).files).toHaveLength(0)
  })

  it('returns no files at L1 (internal guard — direct call)', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L1',
    })
    expect(generateResilience(config).files).toHaveLength(0)
  })

  // --------------------------------------------------------------------------
  // Happy path: ts + java + multi
  // --------------------------------------------------------------------------

  it('generates 1 file for typescript backend-web-db at L2', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    expect(generateResilience(config).files).toHaveLength(1)
  })

  it('generates 1 file for java backend-web-db at L2', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'java',
      governanceLevel: 'L2',
    })
    expect(generateResilience(config).files).toHaveLength(1)
  })

  it('generates 1 file for multi backend-web-db at L2', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'multi',
      governanceLevel: 'L2',
    })
    expect(generateResilience(config).files).toHaveLength(1)
  })

  it('generates 1 file at L3', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L3',
    })
    expect(generateResilience(config).files).toHaveLength(1)
  })

  it('generates 1 file at L4', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L4',
    })
    expect(generateResilience(config).files).toHaveLength(1)
  })

  // --------------------------------------------------------------------------
  // Output path
  // --------------------------------------------------------------------------

  it('emits docs/governance/RESILIENCE.md relative to targetDir', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    generateResilience(config)
    expect(existsSync(join(dir, 'docs', 'governance', 'RESILIENCE.md'))).toBe(true)
  })

  // --------------------------------------------------------------------------
  // Content
  // --------------------------------------------------------------------------

  it('ts output contains cockatiel config block', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    generateResilience(config)
    const content = readFileSync(join(dir, 'docs', 'governance', 'RESILIENCE.md'), 'utf-8')
    expect(content).toContain('cockatiel')
  })

  it('java output contains Resilience4j config block', () => {
    const javaDir = createTestProject('java')
    try {
      const config = makeConfig(javaDir, {
        archetype: 'backend-web-db',
        language: 'java',
        governanceLevel: 'L2',
      })
      generateResilience(config)
      const content = readFileSync(join(javaDir, 'docs', 'governance', 'RESILIENCE.md'), 'utf-8')
      expect(content).toContain('Resilience4j')
    } finally {
      cleanupTestProject(javaDir)
    }
  })

  it('multi output contains both cockatiel and Resilience4j blocks', () => {
    const multiDir = createTestProject('typescript')
    try {
      const config = makeConfig(multiDir, {
        archetype: 'backend-web-db',
        language: 'multi',
        governanceLevel: 'L2',
      })
      generateResilience(config)
      const content = readFileSync(join(multiDir, 'docs', 'governance', 'RESILIENCE.md'), 'utf-8')
      expect(content).toContain('cockatiel')
      expect(content).toContain('Resilience4j')
    } finally {
      cleanupTestProject(multiDir)
    }
  })

  // --------------------------------------------------------------------------
  // Null-guard: java config without basePackage must not throw
  // --------------------------------------------------------------------------

  it('java without basePackage renders without throwing', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'java',
      governanceLevel: 'L2',
      basePackage: undefined,
      framework: null,
    })
    expect(() => generateResilience(config)).not.toThrow()
    expect(generateResilience(config).files).toHaveLength(1)
  })

  // --------------------------------------------------------------------------
  // Idempotency (CANON-11 / skipIfExists)
  // --------------------------------------------------------------------------

  it('second run skips existing file (skipIfExists)', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      language: 'typescript',
      governanceLevel: 'L2',
    })
    generateResilience(config)
    const result2 = generateResilience(config)
    expect(result2.files[0]?.action).toBe('skipped')
  })

  // --------------------------------------------------------------------------
  // Registry gating
  // --------------------------------------------------------------------------

  it('registry spec is enabled for backend-web-db at L2', () => {
    const specs = buildRegistry(
      makeConfig(dir, {
        archetype: 'backend-web-db',
        language: 'typescript',
        governanceLevel: 'L2',
      }),
    )
    const spec = specs.find((s) => s.key === 'resilience')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('registry spec is disabled at L1', () => {
    const specs = buildRegistry(
      makeConfig(dir, {
        archetype: 'backend-web-db',
        language: 'typescript',
        governanceLevel: 'L1',
      }),
    )
    const spec = specs.find((s) => s.key === 'resilience')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(false)
  })

  it('registry spec is disabled for non-backend-web-db archetype', () => {
    const specs = buildRegistry(
      makeConfig(dir, { archetype: 'cli', language: 'typescript', governanceLevel: 'L2' }),
    )
    const spec = specs.find((s) => s.key === 'resilience')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(false)
  })

  it('registry spec is defined', () => {
    const specs = buildRegistry(makeConfig(dir))
    expect(specs.find((s) => s.key === 'resilience')).toBeDefined()
  })
})
