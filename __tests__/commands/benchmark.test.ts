// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runBenchmarkHooks } from '../../src/commands/benchmark.js'

function makeHookDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-bench-'))
  const hooksDir = join(dir, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  // Minimal no-op hook
  writeFileSync(join(hooksDir, 'noop.mjs'), '#!/usr/bin/env node\nprocess.exit(0)\n')
  return dir
}

describe('runBenchmarkHooks (#544)', () => {
  let dir: string

  beforeEach(() => {
    dir = makeHookDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns timings for each .mjs hook', () => {
    const result = runBenchmarkHooks({ dir, iterations: 3 })
    expect(result.hooks).toHaveLength(1)
    expect(result.hooks[0]!.hook).toBe('noop.mjs')
    expect(result.hooks[0]!.p50).toBeGreaterThanOrEqual(0)
    expect(result.hooks[0]!.p95).toBeGreaterThanOrEqual(result.hooks[0]!.p50)
  })

  it('totalP95Ms is sum of hook p95 values', () => {
    const result = runBenchmarkHooks({ dir, iterations: 3 })
    const expected = result.hooks.reduce((s, h) => s + h.p95, 0)
    expect(result.totalP95Ms).toBeCloseTo(expected, 5)
  })

  it('regressions is empty when no baseline present', () => {
    const result = runBenchmarkHooks({ dir, iterations: 3 })
    expect(result.regressions).toHaveLength(0)
  })

  it('detects regression when hook exceeds baseline by >20%', () => {
    const baselineDir = join(dir, '.arbiter', 'benchmarks')
    mkdirSync(baselineDir, { recursive: true })
    const baselineFile = join(baselineDir, 'hooks-baseline.json')
    // Set baseline p95 to 0ms — any real run will be ">20%" over it
    writeFileSync(baselineFile, JSON.stringify({ 'noop.mjs': 0 }))
    const result = runBenchmarkHooks({ dir, iterations: 3, baselineFile })
    expect(result.regressions.length).toBeGreaterThan(0)
    expect(result.regressions[0]).toMatch(/noop\.mjs/)
  })

  it('no regression when hook p95 is within 20% of baseline', () => {
    const baselineDir = join(dir, '.arbiter', 'benchmarks')
    mkdirSync(baselineDir, { recursive: true })
    const baselineFile = join(baselineDir, 'hooks-baseline.json')
    // Unreachably high baseline — noop will always be far below 120% of 999999ms
    writeFileSync(baselineFile, JSON.stringify({ 'noop.mjs': 999_999 }))
    const result = runBenchmarkHooks({ dir, iterations: 3, baselineFile })
    expect(result.regressions).toHaveLength(0)
  })

  it('skips lib.mjs from measurement', () => {
    const hooksDir = join(dir, '.claude', 'hooks')
    writeFileSync(join(hooksDir, 'lib.mjs'), '// shared lib\n')
    const result = runBenchmarkHooks({ dir, iterations: 3 })
    expect(result.hooks.every((h) => h.hook !== 'lib.mjs')).toBe(true)
  })

  it('throws when hooks directory does not exist', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'arbiter-bench-empty-'))
    try {
      expect(() => runBenchmarkHooks({ dir: emptyDir, iterations: 1 })).toThrow(
        /No hooks directory/,
      )
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})
