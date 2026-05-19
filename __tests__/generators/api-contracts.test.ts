// SPDX-License-Identifier: Apache-2.0
// RED tests for #896 — F9: API contract baselines template
// Tests will fail until api-snapshot stubs, pact-sample stubs, and validator scripts are implemented.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createTestProject, cleanupTestProject, makeConfig, initGit } from '../helpers.js'
import { generateContractTesting } from '../../src/generators/contract-testing.js'

let dir: string

beforeEach(() => {
  dir = createTestProject('java')
  initGit(dir)
})

afterEach(() => {
  cleanupTestProject(dir)
})

// ─── api-snapshots stubs ──────────────────────────────────────────────────────

describe('generateContractTesting — api-snapshot stubs (#896)', () => {
  it('emits openapi-baseline.json stub when contractType=rest-owned + java (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('api-snapshots/openapi-baseline.json'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits openapi-paths-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/openapi-paths-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits openapi-response-status-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/openapi-response-status-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits openapi-content-types-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/openapi-content-types-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits openapi-required-fields-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/openapi-required-fields-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits config-response-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/config-response-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits config-keys-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/config-keys-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits enum-values-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/enum-values-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits error-shape-baseline.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('api-snapshots/error-shape-baseline.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits test-snapshot.json stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('api-snapshots/test-snapshot.json'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('all api-snapshot stubs are valid JSON (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const snapshotFiles = result.files.filter(
      (f) => f.path.includes('/api-snapshots/') && f.path.endsWith('.json'),
    )
    expect(snapshotFiles.length).toBeGreaterThan(0)
    for (const f of snapshotFiles) {
      const content = readFileSync(f.path, 'utf-8')
      expect(() => JSON.parse(content), `${f.path} is not valid JSON`).not.toThrow()
    }
  })
})

// ─── pact-samples stubs ───────────────────────────────────────────────────────

describe('generateContractTesting — pact-sample stubs (#896)', () => {
  it('emits assignment-response.json pact stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('pact-samples/assignment-response.json'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits availability-response.json pact stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('pact-samples/availability-response.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits availability-rule-response.json pact stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('pact-samples/availability-rule-response.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits capacity-response.json pact stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('pact-samples/capacity-response.json'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits fully-booked-response.json pact stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('pact-samples/fully-booked-response.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits schedule-override-response.json pact stub (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) =>
      f.path.endsWith('pact-samples/schedule-override-response.json'),
    )
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('all pact-sample stubs are valid JSON (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const pactFiles = result.files.filter(
      (f) => f.path.includes('/pact-samples/') && f.path.endsWith('.json'),
    )
    expect(pactFiles.length).toBeGreaterThan(0)
    for (const f of pactFiles) {
      const content = readFileSync(f.path, 'utf-8')
      expect(() => JSON.parse(content), `${f.path} is not valid JSON`).not.toThrow()
    }
  })
})

// ─── validator scripts ────────────────────────────────────────────────────────

describe('generateContractTesting — validator scripts (#896)', () => {
  it('emits validate-api-snapshots.mjs when contractType=rest-owned + java (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('validate-api-snapshots.mjs'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits validate-openapi-field-types.mjs when contractType=rest-owned + java (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('validate-openapi-field-types.mjs'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('emits validate-postman-collection.mjs when contractType=rest-owned + java (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('validate-postman-collection.mjs'))
    expect(file).toBeDefined()
    expect(existsSync(file!.path)).toBe(true)
  })

  it('validate-api-snapshots.mjs contains checksum reference (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('validate-api-snapshots.mjs'))
    const content = readFileSync(file!.path, 'utf-8')
    expect(content.toLowerCase()).toContain('snapshot')
  })

  it('validate-openapi-field-types.mjs references openapi (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('validate-openapi-field-types.mjs'))
    const content = readFileSync(file!.path, 'utf-8')
    expect(content.toLowerCase()).toContain('openapi')
  })

  it('validate-postman-collection.mjs references postman or newman (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const file = result.files.find((f) => f.path.endsWith('validate-postman-collection.mjs'))
    const content = readFileSync(file!.path, 'utf-8')
    expect(content.toLowerCase()).toMatch(/postman|newman/)
  })

  it('all validator scripts start with ESM shebang or import (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const validators = result.files.filter(
      (f) =>
        f.path.endsWith('validate-api-snapshots.mjs') ||
        f.path.endsWith('validate-openapi-field-types.mjs') ||
        f.path.endsWith('validate-postman-collection.mjs'),
    )
    expect(validators).toHaveLength(3)
    for (const v of validators) {
      const content = readFileSync(v.path, 'utf-8')
      expect(content).toMatch(/^(#!\/usr\/bin\/env node|import |\/\/ SPDX)/)
    }
  })
})

// ─── Language gating ──────────────────────────────────────────────────────────

describe('generateContractTesting — F9 language gating (#896)', () => {
  it('does NOT emit api-snapshot stubs for contractType=graphql (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'graphql',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const snapshotFiles = result.files.filter(
      (f) => f.path.includes('/api-snapshots/') && f.path.endsWith('.json'),
    )
    expect(snapshotFiles).toHaveLength(0)
  })

  it('does NOT emit pact-sample stubs for typescript + rest-owned (#896)', () => {
    const tsDir = createTestProject('typescript')
    initGit(tsDir)
    try {
      const config = makeConfig(tsDir, {
        language: 'typescript',
        contractType: 'rest-owned',
        hasPublicApi: true,
        governanceLevel: 'L2',
      })
      const result = generateContractTesting(config)
      const pactFiles = result.files.filter(
        (f) => f.path.includes('/pact-samples/') && f.path.endsWith('.json'),
      )
      expect(pactFiles).toHaveLength(0)
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  it('does NOT emit validator scripts for contractType=none (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'none',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const validators = result.files.filter(
      (f) =>
        f.path.endsWith('validate-api-snapshots.mjs') ||
        f.path.endsWith('validate-openapi-field-types.mjs') ||
        f.path.endsWith('validate-postman-collection.mjs'),
    )
    expect(validators).toHaveLength(0)
  })
})

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('generateContractTesting — F9 idempotency (#896)', () => {
  it('api-snapshot stubs are idempotent on re-run (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    generateContractTesting(config)
    const result2 = generateContractTesting(config)
    const snapshotFiles = result2.files.filter(
      (f) => f.path.includes('/api-snapshots/') && f.path.endsWith('.json'),
    )
    for (const f of snapshotFiles) {
      expect(f.action, `${f.path} should be skipped`).toBe('skipped')
    }
  })

  it('pact-sample stubs are idempotent on re-run (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    generateContractTesting(config)
    const result2 = generateContractTesting(config)
    const pactFiles = result2.files.filter(
      (f) => f.path.includes('/pact-samples/') && f.path.endsWith('.json'),
    )
    for (const f of pactFiles) {
      expect(f.action, `${f.path} should be skipped`).toBe('skipped')
    }
  })

  it('validator scripts are idempotent on re-run (#896)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    generateContractTesting(config)
    const result2 = generateContractTesting(config)
    const validators = result2.files.filter(
      (f) =>
        f.path.endsWith('validate-api-snapshots.mjs') ||
        f.path.endsWith('validate-openapi-field-types.mjs') ||
        f.path.endsWith('validate-postman-collection.mjs'),
    )
    for (const v of validators) {
      expect(v.action, `${v.path} should be skipped`).toBe('skipped')
    }
  })
})
