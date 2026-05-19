// SPDX-License-Identifier: Apache-2.0
// RED tests for #894 — Postman/Newman contract test template wiring
// These tests will fail until Postman template wiring is implemented

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

describe('generateContractTesting — Postman/Newman (#894)', () => {
  // ─── Happy path ──────────────────────────────────────────────────────────────

  it('emits run-postman-tests.sh when contractType=rest-owned + java (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const postmanScript = result.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
    expect(postmanScript).toBeDefined()
    expect(existsSync(postmanScript!.path)).toBe(true)
  })

  it('emits inject-pact-samples.sh when contractType=rest-owned + java (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const injectScript = result.files.find((f) => f.path.endsWith('inject-pact-samples.sh'))
    expect(injectScript).toBeDefined()
    expect(existsSync(injectScript!.path)).toBe(true)
  })

  it('emits _contract-postman.yml when contractType=rest-owned + java (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const workflowFile = result.files.find((f) => f.path.endsWith('_contract-postman.yml'))
    expect(workflowFile).toBeDefined()
    expect(existsSync(workflowFile!.path)).toBe(true)
  })

  // ─── Content checks ───────────────────────────────────────────────────────────

  it('run-postman-tests.sh contains newman invocation (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const postmanScript = result.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
    const content = readFileSync(postmanScript!.path, 'utf-8')
    expect(content).toContain('newman')
  })

  it('run-postman-tests.sh has executable shebang (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const postmanScript = result.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
    const content = readFileSync(postmanScript!.path, 'utf-8')
    expect(content).toMatch(/^#!/)
  })

  it('inject-pact-samples.sh contains pact reference (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const injectScript = result.files.find((f) => f.path.endsWith('inject-pact-samples.sh'))
    const content = readFileSync(injectScript!.path, 'utf-8')
    expect(content.toLowerCase()).toContain('pact')
  })

  it('_contract-postman.yml is valid YAML structure with name key (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const workflowFile = result.files.find((f) => f.path.endsWith('_contract-postman.yml'))
    const content = readFileSync(workflowFile!.path, 'utf-8')
    expect(content).toContain('name:')
    expect(content).toContain('jobs:')
  })

  it('_contract-postman.yml references newman (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const workflowFile = result.files.find((f) => f.path.endsWith('_contract-postman.yml'))
    const content = readFileSync(workflowFile!.path, 'utf-8')
    expect(content.toLowerCase()).toContain('newman')
  })

  // ─── Negative cases ───────────────────────────────────────────────────────────

  it('does NOT emit Postman files for contractType=graphql (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'graphql',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const postmanScript = result.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
    expect(postmanScript).toBeUndefined()
  })

  it('does NOT emit Postman files for contractType=none (#894)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'none',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })
    const result = generateContractTesting(config)
    const postmanScript = result.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
    expect(postmanScript).toBeUndefined()
  })

  it('does NOT emit Postman files for typescript + rest-owned (java-specific) (#894)', () => {
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
      const postmanScript = result.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
      expect(postmanScript).toBeUndefined()
    } finally {
      cleanupTestProject(tsDir)
    }
  })

  // ─── Idempotency ──────────────────────────────────────────────────────────────

  it('Postman script emission is idempotent on re-run (#894)', () => {
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
    const postmanScript = result2.files.find((f) => f.path.endsWith('run-postman-tests.sh'))
    expect(postmanScript).toBeDefined()
    expect(postmanScript!.action).toBe('skipped')
  })
})
