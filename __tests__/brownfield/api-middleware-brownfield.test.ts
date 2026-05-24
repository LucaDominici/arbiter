import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateApiMiddleware } from '../../src/generators/api-middleware.js'

describe('generateApiMiddleware brownfield (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing payload-size-limit.ts on re-run', () => {
    const middlewareDir = join(dir, 'src', 'middleware')
    mkdirSync(middlewareDir, { recursive: true })
    const target = join(middlewareDir, 'payload-size-limit.ts')
    const sentinel = '// user-modified sentinel content — do not overwrite\n'
    writeFileSync(target, sentinel)

    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    generateApiMiddleware(config)

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })

  it('does not overwrite existing deprecation.ts on re-run', () => {
    const middlewareDir = join(dir, 'src', 'middleware')
    mkdirSync(middlewareDir, { recursive: true })
    const target = join(middlewareDir, 'deprecation.ts')
    const sentinel = '// user-modified deprecation — do not overwrite\n'
    writeFileSync(target, sentinel)

    const config = makeConfig(dir, {
      language: 'typescript',
      hasPublicApi: true,
    })
    generateApiMiddleware(config)

    expect(readFileSync(target, 'utf-8')).toBe(sentinel)
  })
})

describe('generateApiMiddleware — express dep injection', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('injects express and @types/express into package.json for TypeScript', () => {
    const pkgPath = join(dir, 'package.json')
    const config = makeConfig(dir, { language: 'typescript', hasPublicApi: true })
    generateApiMiddleware(config)

    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    const deps = pkg.dependencies as Record<string, string> | undefined
    const devDeps = pkg.devDependencies as Record<string, string> | undefined
    expect(deps?.['express']).toBeTruthy()
    expect(devDeps?.['@types/express']).toBeTruthy()
  })

  it('does not inject express for non-public-api projects', () => {
    const pkgPath = join(dir, 'package.json')
    const before = readFileSync(pkgPath, 'utf-8')
    const config = makeConfig(dir, { language: 'typescript', hasPublicApi: false })
    generateApiMiddleware(config)

    expect(readFileSync(pkgPath, 'utf-8')).toBe(before)
  })

  it('does not overwrite existing express version', () => {
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    pkg.dependencies = { express: '^4.18.0' }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    const config = makeConfig(dir, { language: 'typescript', hasPublicApi: true })
    generateApiMiddleware(config)

    const result = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
    expect((result.dependencies as Record<string, string>)['express']).toBe('^4.18.0')
  })
})
