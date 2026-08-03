import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateApiMiddleware } from '../../src/generators/api-middleware.js'

describe('generateApiMiddleware (#215)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('returns empty when hasPublicApi is false', () => {
    const config = makeConfig(dir, { hasPublicApi: false })
    const result = generateApiMiddleware(config)
    expect(result.files).toHaveLength(0)
  })

  it('emits deprecation.ts and 410-gone-handler.ts for TypeScript API projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    const result = generateApiMiddleware(config)
    expect(result.files.some((f) => f.path.endsWith('deprecation.ts'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('410-gone-handler.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'middleware', 'deprecation.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'middleware', '410-gone-handler.ts'))).toBe(true)
  })

  it('emits DeprecationInterceptor.java for Java API projects', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      hasPublicApi: true,
      basePackage: 'com.example',
    })
    const result = generateApiMiddleware(config)
    expect(result.files.some((f) => f.path.endsWith('DeprecationInterceptor.java'))).toBe(true)
  })

  it('emits error-handler.ts and correlation-id.ts for TypeScript API projects (#220)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    const result = generateApiMiddleware(config)
    expect(result.files.some((f) => f.path.endsWith('error-handler.ts'))).toBe(true)
    expect(result.files.some((f) => f.path.endsWith('correlation-id.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'middleware', 'error-handler.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'middleware', 'correlation-id.ts'))).toBe(true)
    // Consumers must import their handler return shape; Knip permits this entry point via emitted knip.json.
    expect(readFileSync(join(dir, 'src', 'middleware', 'error-handler.ts'), 'utf-8')).toContain(
      'export interface ProblemDetails',
    )
  })

  it('emits payload-size-limit.ts for TypeScript API projects (#222)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    const result = generateApiMiddleware(config)
    expect(result.files.some((f) => f.path.endsWith('payload-size-limit.ts'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'middleware', 'payload-size-limit.ts'))).toBe(true)
  })

  it('emits error-shape.contract.test.ts for TypeScript API projects (#220)', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    const result = generateApiMiddleware(config)
    expect(result.files.some((f) => f.path.endsWith('error-shape.contract.test.ts'))).toBe(true)
    expect(existsSync(join(dir, '__tests__', 'contract', 'error-shape.contract.test.ts'))).toBe(
      true,
    )
  })

  it('declares supertest types with the contract test that imports them', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    generateApiMiddleware(config)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
      devDependencies: Record<string, string>
    }
    expect(pkg.devDependencies.supertest).toBeDefined()
    expect(pkg.devDependencies['@types/supertest']).toBeDefined()
  })

  it('Java + hasPublicApi but no basePackage: silently skips Java file with no crash', () => {
    cleanupTestProject(dir)
    dir = createTestProject('java')
    const config = makeConfig(dir, {
      language: 'java',
      hasPublicApi: true,
      basePackage: undefined,
    })
    const result = generateApiMiddleware(config)
    expect(result.files.some((f) => f.path.endsWith('DeprecationInterceptor.java'))).toBe(false)
  })

  it('does not emit for TypeScript non-API projects', () => {
    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: false,
    })
    generateApiMiddleware(config)
    expect(existsSync(join(dir, 'src', 'middleware', 'deprecation.ts'))).toBe(false)
  })
})
