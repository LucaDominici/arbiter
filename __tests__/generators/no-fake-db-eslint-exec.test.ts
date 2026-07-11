// SPDX-License-Identifier: Apache-2.0
// #1887-D: materialized execution of the emitted eslint.config.no-fake-db.mjs —
// proves the flat config actually catches a banned import (INV-34), not just
// that it renders. Placed under node_modules/ (gitignored, and Node's ESM bare-
// specifier resolution walks up parent node_modules/ directories) so the flat
// config's `import tseslint from 'typescript-eslint'` resolves against THIS
// repo's own installed dependency without needing a nested npm install.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { generateIntegrationTesting } from '../../src/generators/integration-testing.js'
import { makeConfig } from '../helpers.js'

describe('eslint.config.no-fake-db.mjs — materialized execution (#1887-D)', () => {
  let dir: string

  beforeEach(() => {
    const scratchRoot = resolve('node_modules', '.arbiter-test-scratch')
    mkdirSync(scratchRoot, { recursive: true })
    dir = mkdtempSync(join(scratchRoot, 'no-fake-db-'))
    generateIntegrationTesting(
      makeConfig(dir, { hasDatabase: true, governanceLevel: 'L2', language: 'typescript' }),
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function runEslint(file: string): { status: number; stdout: string } {
    const r = execFileSync(
      'node',
      [
        resolve('node_modules', '.bin', 'eslint'),
        '--config',
        'eslint.config.no-fake-db.mjs',
        '--no-config-lookup',
        '--no-error-on-unmatched-pattern',
        file,
      ],
      { cwd: dir, encoding: 'utf-8', stdio: 'pipe' },
    ).toString()
    return { status: 0, stdout: r }
  }

  it('flags an import of better-sqlite3 in a test file', () => {
    writeFileSync(
      join(dir, 'db.test.ts'),
      "import Database from 'better-sqlite3'\nconst db = new Database(':memory:')\n",
    )
    let threw = false
    let output = ''
    try {
      runEslint('db.test.ts')
    } catch (err) {
      threw = true
      output = String((err as { stdout?: Buffer }).stdout ?? '')
    }
    expect(threw, 'eslint should exit non-zero on a banned import').toBe(true)
    expect(output).toContain('better-sqlite3')
  })

  it('flags an import of sqlite3 in a test file', () => {
    writeFileSync(join(dir, 'db.test.ts'), "import sqlite3 from 'sqlite3'\n")
    expect(() => runEslint('db.test.ts')).toThrow()
  })

  it('passes a clean test file with no banned imports', () => {
    writeFileSync(join(dir, 'clean.test.ts'), "import { describe, it } from 'vitest'\n")
    expect(() => runEslint('clean.test.ts')).not.toThrow()
  })
})
