// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit tests for src/generators/infra.ts (#893)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateInfra } from '../../src/generators/infra.js'
import { makeConfig } from '../helpers.js'

describe('generateInfra', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-infra-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns empty files when enableAzureContainerApp is unset (default off)', () => {
    const result = generateInfra(makeConfig(dir))
    expect(result.files.length).toBe(0)
  })

  it('returns empty files when enableAzureContainerApp is false', () => {
    const result = generateInfra(makeConfig(dir, { enableAzureContainerApp: false }))
    expect(result.files.length).toBe(0)
  })

  it('emits exactly one file when enableAzureContainerApp is true', () => {
    const result = generateInfra(makeConfig(dir, { enableAzureContainerApp: true }))
    expect(result.files.length).toBe(1)
  })

  it('emits containerapp.tpl.yaml to infra/azure/', () => {
    generateInfra(makeConfig(dir, { enableAzureContainerApp: true }))
    expect(existsSync(join(dir, 'infra', 'azure', 'containerapp.tpl.yaml'))).toBe(true)
  })

  it('result.files path includes containerapp.tpl.yaml', () => {
    const result = generateInfra(makeConfig(dir, { enableAzureContainerApp: true }))
    expect(result.files[0].path).toContain('containerapp.tpl.yaml')
  })

  it('emitted file contains project name from config', () => {
    generateInfra(makeConfig(dir, { enableAzureContainerApp: true, projectName: 'my-svc' }))
    const content = readFileSync(join(dir, 'infra', 'azure', 'containerapp.tpl.yaml'), 'utf-8')
    expect(content).toContain('my-svc')
  })

  it('emitted file preserved across governance levels (L1/L2/L3)', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const levelDir = mkdtempSync(join(tmpdir(), `arbiter-infra-${level}-`))
      try {
        const result = generateInfra(
          makeConfig(levelDir, { enableAzureContainerApp: true, governanceLevel: level }),
        )
        expect(result.files.length, `${level}: expected 1 file`).toBe(1)
        expect(existsSync(join(levelDir, 'infra', 'azure', 'containerapp.tpl.yaml'))).toBe(true)
      } finally {
        rmSync(levelDir, { recursive: true, force: true })
      }
    }
  })
})
