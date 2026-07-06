// SPDX-License-Identifier: Apache-2.0
// A9/A10 (#1817): CLI-layer wiring for the opt-in java/fe kit checks. Real tmp-dir fixtures
// exercise the fs-walk + read path; the pure validation logic itself is unit-tested in
// __tests__/kit/checks/*.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runKitCheckFlyway,
  runKitCheckTestTaxonomy,
  runKitCheckTokenHygiene,
} from '../../src/commands/kit.js'

let root: string
let stdoutSpy: ReturnType<typeof vi.spyOn>
let stderrSpy: ReturnType<typeof vi.spyOn>
let exitSpy: ReturnType<typeof vi.spyOn>
let exitCode: number | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbiter-kit-checks-'))
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    exitCode = Number(code)
    throw new Error(`exit:${String(code)}`)
  })
  exitCode = undefined
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
  exitSpy.mockRestore()
})

function output(): string {
  return [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls].map((c) => String(c[0])).join('')
}

describe('runKitCheckFlyway', () => {
  it('exits 0 for a clean migration set', () => {
    mkdirSync(join(root, 'migration'), { recursive: true })
    writeFileSync(join(root, 'migration', 'V1__init.sql'), 'CREATE TABLE IF NOT EXISTS t (id int);')

    try {
      runKitCheckFlyway({ dir: join(root, 'migration') })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(0)
  })

  it('exits 1 and reports the violation for a bad file name', () => {
    mkdirSync(join(root, 'migration'), { recursive: true })
    writeFileSync(join(root, 'migration', 'not_a_migration.sql'), 'SELECT 1;')

    try {
      runKitCheckFlyway({ dir: join(root, 'migration') })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(1)
    expect(output()).toContain('naming')
  })

  it('checks dual-set parity when a secondary dir is given', () => {
    mkdirSync(join(root, 'migration'), { recursive: true })
    mkdirSync(join(root, 'migration-sqlite'), { recursive: true })
    writeFileSync(join(root, 'migration', 'V1__init.sql'), 'CREATE TABLE IF NOT EXISTS t (id int);')
    // secondary set missing V1 entirely

    try {
      runKitCheckFlyway({
        dir: join(root, 'migration'),
        secondaryDir: join(root, 'migration-sqlite'),
      })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(1)
    expect(output()).toContain('dual-set-parity')
  })
})

describe('runKitCheckTestTaxonomy', () => {
  it('exits 0 when every test file is tagged', () => {
    mkdirSync(join(root, 'test'), { recursive: true })
    writeFileSync(
      join(root, 'test', 'FooTest.java'),
      '@Tag("unit")\nclass FooTest {\n  @Test void ok() {}\n}\n',
    )

    try {
      runKitCheckTestTaxonomy({ dir: join(root, 'test') })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(0)
  })

  it('exits 1 and names the untagged file', () => {
    mkdirSync(join(root, 'test'), { recursive: true })
    writeFileSync(join(root, 'test', 'BarTest.java'), 'class BarTest {\n  @Test void ok() {}\n}\n')

    try {
      runKitCheckTestTaxonomy({ dir: join(root, 'test') })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(1)
    expect(output()).toContain('BarTest.java')
  })
})

describe('runKitCheckTokenHygiene', () => {
  it('exits 0 for token-clean files', () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Card.vue'), '<div class="bg-surface-muted">hi</div>')

    try {
      runKitCheckTokenHygiene({ dirs: [join(root, 'src')] })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(0)
  })

  it('exits 1 and reports a raw palette class', () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Card.vue'), '<div class="bg-red-500">hi</div>')

    try {
      runKitCheckTokenHygiene({ dirs: [join(root, 'src')] })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(1)
    expect(output()).toContain('bg-red-500')
  })

  it('exits 0 when the only violation is grandfathered in the baseline', () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'Card.vue'), '<div class="bg-red-500">hi</div>')
    const baselinePath = join(root, 'baseline.json')
    writeFileSync(
      baselinePath,
      JSON.stringify({
        grandfathered: [{ file: join(root, 'src', 'Card.vue'), line: 1, pattern: 'bg-red-500' }],
      }),
    )

    try {
      runKitCheckTokenHygiene({ dirs: [join(root, 'src')], baselinePath })
    } catch {
      // exit() throws
    }
    expect(exitCode).toBe(0)
  })
})
