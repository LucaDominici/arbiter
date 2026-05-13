import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateSeed } from '../../src/generators/seed.js'

describe('brownfield: seed generator (CANON-11)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
  })

  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('does not overwrite existing seed-test-data.sh on re-run', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      governanceLevel: 'L2',
    })
    generateSeed(config)

    const path = join(dir, 'scripts', 'seed-test-data.sh')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '#!/bin/bash\n# user-edited')

    generateSeed(config)
    expect(readFileSync(path, 'utf-8')).toBe('#!/bin/bash\n# user-edited')
  })

  it('does not overwrite existing seed-common.sh on re-run', () => {
    const config = makeConfig(dir, {
      archetype: 'backend-web-db',
      governanceLevel: 'L3',
    })
    generateSeed(config)

    const path = join(dir, 'scripts', 'lib', 'seed-common.sh')
    expect(existsSync(path)).toBe(true)
    writeFileSync(path, '# user-edited-common')

    generateSeed(config)
    expect(readFileSync(path, 'utf-8')).toBe('# user-edited-common')
  })
})
