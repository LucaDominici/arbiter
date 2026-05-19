// SPDX-License-Identifier: Apache-2.0
// CANON-11: brownfield tests for Postman/Newman contract template wiring (#894)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateContractTesting } from '../../src/generators/contract-testing.js'

describe('brownfield: Postman/Newman contract wiring (CANON-11, #894)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('java')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing run-postman-tests.sh on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })

    generateContractTesting(config)
    const path = join(dir, 'scripts', 'run-postman-tests.sh')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '#!/usr/bin/env bash\n# user-customised')

    generateContractTesting(config)
    expect(readFileSync(path, 'utf-8')).toContain('user-customised')
  })

  it('does not overwrite existing inject-pact-samples.sh on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })

    generateContractTesting(config)
    const path = join(dir, 'scripts', 'inject-pact-samples.sh')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '#!/usr/bin/env bash\n# user-customised')

    generateContractTesting(config)
    expect(readFileSync(path, 'utf-8')).toContain('user-customised')
  })

  it('does not overwrite existing _contract-postman.yml on re-run (skipIfExists)', () => {
    const config = makeConfig(dir, {
      language: 'java',
      buildTool: 'gradle',
      basePackage: 'com.example.svc',
      contractType: 'rest-owned',
      hasPublicApi: true,
      governanceLevel: 'L2',
    })

    generateContractTesting(config)
    const path = join(dir, '.github', 'workflows', '_contract-postman.yml')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, 'name: user-customised-workflow')

    generateContractTesting(config)
    expect(readFileSync(path, 'utf-8')).toContain('user-customised-workflow')
  })

  it('Postman files skipped on second run (idempotency)', () => {
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

    const postmanFiles = result2.files.filter(
      (f) =>
        f.path.endsWith('run-postman-tests.sh') ||
        f.path.endsWith('inject-pact-samples.sh') ||
        f.path.endsWith('_contract-postman.yml'),
    )
    for (const f of postmanFiles) {
      expect(f.action).toBe('skipped')
    }
  })
})
