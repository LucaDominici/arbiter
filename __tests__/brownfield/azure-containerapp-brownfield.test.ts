// SPDX-License-Identifier: Apache-2.0
// CANON-11: brownfield skipIfExists tests for Azure ContainerApp infra template
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateInfra } from '../../src/generators/infra.js'

describe('brownfield: Azure ContainerApp infra generator (CANON-11, #893)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not emit containerapp.tpl.yaml when enableAzureContainerApp is false (default)', () => {
    const config = makeConfig(dir, { enableAzureContainerApp: false })
    generateInfra(config)
    const path = join(dir, 'infra', 'azure', 'containerapp.tpl.yaml')
    expect(existsSync(path)).toBe(false)
  })

  it('emits containerapp.tpl.yaml when enableAzureContainerApp is true', () => {
    const config = makeConfig(dir, { enableAzureContainerApp: true })
    generateInfra(config)
    const path = join(dir, 'infra', 'azure', 'containerapp.tpl.yaml')
    expect(existsSync(path)).toBe(true)
  })

  it('does not overwrite user-customized containerapp.tpl.yaml on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, { enableAzureContainerApp: true })
    generateInfra(config)

    const path = join(dir, 'infra', 'azure', 'containerapp.tpl.yaml')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-customized containerapp')

    generateInfra(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-customized containerapp')
  })

  it('generateInfra returns files array with containerapp path when enabled', () => {
    const config = makeConfig(dir, { enableAzureContainerApp: true })
    const result = generateInfra(config)
    const paths = result.files.map((f) => f.path)
    expect(paths.some((p) => p.includes('containerapp.tpl.yaml'))).toBe(true)
  })

  it('generateInfra returns empty files array when disabled', () => {
    const config = makeConfig(dir)
    const result = generateInfra(config)
    expect(result.files.length).toBe(0)
  })
})
