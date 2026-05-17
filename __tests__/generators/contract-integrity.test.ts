// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateContractIntegrity } from '../../src/generators/contract-integrity.js'

describe('generateContractIntegrity (#716)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('emits zero files when contractIntegrity is absent', () => {
    const result = generateContractIntegrity(makeConfig(dir))
    expect(result.files).toHaveLength(0)
  })

  it('emits zero files when no gates are enabled', () => {
    const result = generateContractIntegrity(makeConfig(dir, { contractIntegrity: { gates: {} } }))
    expect(result.files).toHaveLength(0)
  })

  it('emits only the openapi-snapshot script when only openapiSnapshot is true', () => {
    const result = generateContractIntegrity(
      makeConfig(dir, {
        contractIntegrity: { gates: { openapiSnapshot: true } },
      }),
    )
    expect(result.files).toHaveLength(1)
    expect(existsSync(join(dir, 'scripts', 'contract-integrity', 'openapi-snapshot.mjs'))).toBe(
      true,
    )
  })

  it('emits only the dto-parity script when only dtoParity is true', () => {
    const result = generateContractIntegrity(
      makeConfig(dir, { contractIntegrity: { gates: { dtoParity: true } } }),
    )
    expect(result.files).toHaveLength(1)
    expect(existsSync(join(dir, 'scripts', 'contract-integrity', 'dto-parity.mjs'))).toBe(true)
  })

  it('emits all five scripts when all gates are true', () => {
    const result = generateContractIntegrity(
      makeConfig(dir, {
        contractIntegrity: {
          gates: {
            openapiSnapshot: true,
            dtoParity: true,
            operationSmoke: true,
            deadCode: true,
            testHygiene: true,
          },
        },
      }),
    )
    expect(result.files).toHaveLength(5)
    const scripts = [
      'openapi-snapshot',
      'dto-parity',
      'operation-smoke',
      'dead-code',
      'test-hygiene',
    ]
    for (const name of scripts) {
      expect(existsSync(join(dir, 'scripts', 'contract-integrity', `${name}.mjs`))).toBe(true)
    }
  })

  it('disabled gates produce zero files for those gates', () => {
    const result = generateContractIntegrity(
      makeConfig(dir, {
        contractIntegrity: {
          gates: { openapiSnapshot: true, dtoParity: false, operationSmoke: false },
        },
      }),
    )
    expect(result.files).toHaveLength(1)
    expect(existsSync(join(dir, 'scripts', 'contract-integrity', 'dto-parity.mjs'))).toBe(false)
  })

  it('is skipIfExists — does not overwrite an existing script', () => {
    const cfg = makeConfig(dir, {
      contractIntegrity: { gates: { openapiSnapshot: true } },
    })
    const r1 = generateContractIntegrity(cfg)
    expect(r1.files[0].action).toBe('created')
    const r2 = generateContractIntegrity(cfg)
    expect(r2.files[0].action).toBe('skipped')
  })
})
