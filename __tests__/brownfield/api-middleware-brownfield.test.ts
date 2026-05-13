import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
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
