// SPDX-License-Identifier: Apache-2.0
// CANON-05: generator unit tests for src/generators/infra.ts (#893)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
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

  it('returns empty files when deployTarget is not azure-container-app (default off)', () => {
    const result = generateInfra(makeConfig(dir))
    expect(result.files.length).toBe(0)
  })

  it('returns empty files when deployTarget is none', () => {
    const result = generateInfra(makeConfig(dir, { deployTarget: 'none' }))
    expect(result.files.length).toBe(0)
  })

  it('emits exactly one file when deployTarget is azure-container-app', () => {
    const result = generateInfra(makeConfig(dir, { deployTarget: 'azure-container-app' }))
    expect(result.files.length).toBe(1)
  })

  it('emits containerapp.tpl.yaml to infra/azure/', () => {
    generateInfra(makeConfig(dir, { deployTarget: 'azure-container-app' }))
    expect(existsSync(join(dir, 'infra', 'azure', 'containerapp.tpl.yaml'))).toBe(true)
  })

  it('result.files path includes containerapp.tpl.yaml', () => {
    const result = generateInfra(makeConfig(dir, { deployTarget: 'azure-container-app' }))
    expect(result.files[0].path).toContain('containerapp.tpl.yaml')
  })

  it('emitted file contains project name from config', () => {
    generateInfra(makeConfig(dir, { deployTarget: 'azure-container-app', projectName: 'my-svc' }))
    const content = readFileSync(join(dir, 'infra', 'azure', 'containerapp.tpl.yaml'), 'utf-8')
    expect(content).toContain('my-svc')
  })

  it('emitted file preserved across governance levels (L1/L2/L3)', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const levelDir = mkdtempSync(join(tmpdir(), `arbiter-infra-${level}-`))
      try {
        const result = generateInfra(
          makeConfig(levelDir, { deployTarget: 'azure-container-app', governanceLevel: level }),
        )
        expect(result.files.length, `${level}: expected 1 file`).toBe(1)
        expect(existsSync(join(levelDir, 'infra', 'azure', 'containerapp.tpl.yaml'))).toBe(true)
      } finally {
        rmSync(levelDir, { recursive: true, force: true })
      }
    }
  })
})

// #9002: nas-compose deployTarget infra scaffold
describe('generateInfra — nas-compose', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-infra-nas-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits exactly one file when deployTarget is nas-compose', () => {
    const result = generateInfra(makeConfig(dir, { deployTarget: 'nas-compose' }))
    expect(result.files.length).toBe(1)
  })

  it('emits deploy.sh to infra/nas-compose/', () => {
    generateInfra(makeConfig(dir, { deployTarget: 'nas-compose' }))
    expect(existsSync(join(dir, 'infra', 'nas-compose', 'deploy.sh'))).toBe(true)
  })

  it('result.files path includes deploy.sh', () => {
    const result = generateInfra(makeConfig(dir, { deployTarget: 'nas-compose' }))
    expect(result.files[0].path).toContain('deploy.sh')
  })

  it('deploy.sh is executable (0o755)', () => {
    generateInfra(makeConfig(dir, { deployTarget: 'nas-compose' }))
    const mode = statSync(join(dir, 'infra', 'nas-compose', 'deploy.sh')).mode & 0o777
    expect(mode).toBe(0o755)
  })

  it('deploy.sh contains pull-by-digest, cosign verify on NAS, and compose lifecycle', () => {
    generateInfra(makeConfig(dir, { deployTarget: 'nas-compose' }))
    const content = readFileSync(join(dir, 'infra', 'nas-compose', 'deploy.sh'), 'utf-8')
    expect(content).toContain('docker pull')
    expect(content).toContain('cosign verify')
    expect(content).toContain('docker-compose')
    expect(content).not.toContain('<%')
  })
})
