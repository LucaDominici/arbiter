// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createTestProject, initGit, cleanupTestProject, makeConfig } from '../helpers.js'
import { generateIntegrationTesting } from '../../src/generators/integration-testing.js'

// ── G1a unit 2 (#1317): integration-testing branches on databaseEngine ────────
describe('generateIntegrationTesting — databaseEngine branching (#1317)', () => {
  let goDir: string
  beforeEach(() => {
    goDir = createTestProject('go')
    initGit(goDir)
  })
  afterEach(() => {
    cleanupTestProject(goDir)
  })

  it('databaseEngine "sqlite" ⇒ containerless Go TestMain, no testcontainers import', () => {
    const config = makeConfig(goDir, {
      hasDatabase: true,
      databaseEngine: 'sqlite',
      governanceLevel: 'L2',
      language: 'go',
      buildTool: 'go',
    })
    const res = generateIntegrationTesting(config)
    expect(res.files).toHaveLength(1)
    const content = readFileSync(join(goDir, 'tests', 'main_test.go'), 'utf-8')
    expect(content).not.toContain('testcontainers')
    expect(content).toContain('func TestMain')
  })

  it('databaseEngine "none" ⇒ no DB test emitted (0 files)', () => {
    const config = makeConfig(goDir, {
      hasDatabase: false,
      databaseEngine: 'none',
      governanceLevel: 'L2',
      language: 'go',
      buildTool: 'go',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(0)
  })

  it('databaseEngine "postgresql" ⇒ testcontainers Go TestMain (unchanged)', () => {
    const config = makeConfig(goDir, {
      hasDatabase: true,
      databaseEngine: 'postgresql',
      governanceLevel: 'L2',
      language: 'go',
      buildTool: 'go',
    })
    const res = generateIntegrationTesting(config)
    expect(res.files).toHaveLength(1)
    const content = readFileSync(join(goDir, 'tests', 'main_test.go'), 'utf-8')
    expect(content).toContain('testcontainers')
  })

  it('contradictory hasDatabase:true + databaseEngine:"none" ⇒ no DB test (0 files)', () => {
    // Hand-edit reachable incoherence: engine is the source of truth, so an
    // explicit 'none' must win and emit nothing regardless of the stale boolean —
    // otherwise the generator falls through to the POSTGRES template (#1317 RT).
    const config = makeConfig(goDir, {
      hasDatabase: true,
      databaseEngine: 'none',
      governanceLevel: 'L2',
      language: 'go',
      buildTool: 'go',
    })
    expect(generateIntegrationTesting(config).files).toHaveLength(0)
  })

  it('legacy hasDatabase:true with engine unset ⇒ testcontainers (postgresql default)', () => {
    const config = makeConfig(goDir, {
      hasDatabase: true,
      governanceLevel: 'L2',
      language: 'go',
      buildTool: 'go',
    })
    const res = generateIntegrationTesting(config)
    expect(res.files).toHaveLength(1)
    const content = readFileSync(join(goDir, 'tests', 'main_test.go'), 'utf-8')
    expect(content).toContain('testcontainers')
  })
})

// ── G1a unit 4 (RT): emitted sqlite Go TestMain is gofmt-clean ────────────────
describe('sqlite Go TestMain — gofmt cleanliness (RT)', () => {
  let goDir: string
  beforeEach(() => {
    goDir = createTestProject('go')
    initGit(goDir)
  })
  afterEach(() => {
    cleanupTestProject(goDir)
  })

  function gofmtAvailable(): boolean {
    try {
      execFileSync('gofmt', ['-h'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  it('emitted file is gofmt -l clean (or structurally tab-indented if gofmt absent)', () => {
    const config = makeConfig(goDir, {
      hasDatabase: true,
      databaseEngine: 'sqlite',
      governanceLevel: 'L2',
      language: 'go',
      buildTool: 'go',
    })
    generateIntegrationTesting(config)
    const path = join(goDir, 'tests', 'main_test.go')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')

    if (gofmtAvailable()) {
      // gofmt -l prints the path if the file is NOT formatted; empty ⇒ clean.
      const out = execFileSync('gofmt', ['-l', path], { encoding: 'utf-8' })
      expect(out.trim()).toBe('')
    } else {
      // Structural surrogate: Go source uses tab indentation, no trailing
      // whitespace, no leading-space indent, and ends with a newline.
      const lines = content.split('\n')
      for (const line of lines) {
        expect(line).not.toMatch(/ +$/) // no trailing spaces
        expect(line).not.toMatch(/^ +\S/) // no space-indented lines
      }
      expect(content.endsWith('\n')).toBe(true)
    }
  })
})
