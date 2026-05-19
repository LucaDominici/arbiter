// SPDX-License-Identifier: Apache-2.0
// CANON-11: brownfield tests for F9 API contract baseline template wiring (#896)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateContractTesting } from '../../src/generators/contract-testing.js'

describe('brownfield: F9 API contract baselines (CANON-11, #896)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  const baseConfig = () => ({
    language: 'java' as const,
    buildTool: 'gradle' as const,
    basePackage: 'com.example.svc',
    contractType: 'rest-owned' as const,
    hasPublicApi: true,
    governanceLevel: 'L2' as const,
  })

  // ─── api-snapshot stubs: skipIfExists ──────────────────────────────────────

  it('does not overwrite existing openapi-baseline.json on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'src', 'test', 'resources', 'api-snapshots', 'openapi-baseline.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"customized": true}')
    generateContractTesting(config)
    const content = JSON.parse(readFileSync(path, 'utf-8'))
    expect(content).toHaveProperty('customized', true)
  })

  it('does not overwrite existing openapi-paths-baseline.json on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(
      dir,
      'src',
      'test',
      'resources',
      'api-snapshots',
      'openapi-paths-baseline.json',
    )
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '["/custom-path"]')
    generateContractTesting(config)
    const content = JSON.parse(readFileSync(path, 'utf-8'))
    expect(content).toContain('/custom-path')
  })

  it('does not overwrite existing test-snapshot.json on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'src', 'test', 'resources', 'api-snapshots', 'test-snapshot.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"contract":"closed","version":"v2"}')
    generateContractTesting(config)
    const content = JSON.parse(readFileSync(path, 'utf-8'))
    expect(content).toHaveProperty('version', 'v2')
  })

  // ─── pact-sample stubs: skipIfExists ──────────────────────────────────────

  it('does not overwrite existing assignment-response.json on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'src', 'test', 'resources', 'pact-samples', 'assignment-response.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"uuid":"custom-uuid","status":"CANCELLED"}')
    generateContractTesting(config)
    const content = JSON.parse(readFileSync(path, 'utf-8'))
    expect(content).toHaveProperty('uuid', 'custom-uuid')
  })

  it('does not overwrite existing capacity-response.json on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'src', 'test', 'resources', 'pact-samples', 'capacity-response.json')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '{"resources":[],"customField":true}')
    generateContractTesting(config)
    const content = JSON.parse(readFileSync(path, 'utf-8'))
    expect(content).toHaveProperty('customField', true)
  })

  // ─── validator scripts: skipIfExists ──────────────────────────────────────

  it('does not overwrite existing validate-api-snapshots.mjs on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'scripts', 'validate-api-snapshots.mjs')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-customised validator\n')
    generateContractTesting(config)
    expect(readFileSync(path, 'utf-8')).toContain('user-customised validator')
  })

  it('does not overwrite existing validate-openapi-field-types.mjs on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'scripts', 'validate-openapi-field-types.mjs')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-customised\n')
    generateContractTesting(config)
    expect(readFileSync(path, 'utf-8')).toContain('user-customised')
  })

  it('does not overwrite existing validate-postman-collection.mjs on re-run', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const path = join(dir, 'scripts', 'validate-postman-collection.mjs')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '// user-customised postman validator\n')
    generateContractTesting(config)
    expect(readFileSync(path, 'utf-8')).toContain('user-customised postman validator')
  })

  // ─── All F9 files skipped on second run ────────────────────────────────────

  it('all F9 files are skipped on second run (idempotency)', () => {
    const config = makeConfig(dir, baseConfig())
    generateContractTesting(config)
    const result2 = generateContractTesting(config)

    const f9Files = result2.files.filter(
      (f) =>
        (f.path.includes('/api-snapshots/') && f.path.endsWith('.json')) ||
        (f.path.includes('/pact-samples/') && f.path.endsWith('.json')) ||
        f.path.endsWith('validate-api-snapshots.mjs') ||
        f.path.endsWith('validate-openapi-field-types.mjs') ||
        f.path.endsWith('validate-postman-collection.mjs'),
    )

    expect(f9Files.length).toBeGreaterThan(0)
    for (const f of f9Files) {
      expect(f.action, `${f.path} should be skipped on re-run`).toBe('skipped')
    }
  })
})
