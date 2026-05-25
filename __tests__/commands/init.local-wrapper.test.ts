import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRegistry, runGeneratorsFromRegistry } from '../../src/generators/registry.js'
import { makeConfig } from '../helpers.js'

describe('arbiter init — local-wrapper generator integration (#879, W3)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-init-local-wrapper-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('buildRegistry includes local-wrapper entry', () => {
    const specs = buildRegistry(makeConfig(dir))
    const spec = specs.find((s) => s.key === 'local-wrapper')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('buildRegistry includes env-template entry', () => {
    const specs = buildRegistry(makeConfig(dir))
    const spec = specs.find((s) => s.key === 'env-template')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  it('runGeneratorsFromRegistry emits Makefile and run.sh', () => {
    const specs = buildRegistry(makeConfig(dir))
    runGeneratorsFromRegistry(specs, [], { dryRun: false })
    expect(existsSync(join(dir, 'Makefile'))).toBe(true)
    expect(existsSync(join(dir, 'run.sh'))).toBe(true)
  })

  it('runGeneratorsFromRegistry emits .env.example', () => {
    const specs = buildRegistry(makeConfig(dir))
    runGeneratorsFromRegistry(specs, [], { dryRun: false })
    expect(existsSync(join(dir, '.env.example'))).toBe(true)
  })
})
