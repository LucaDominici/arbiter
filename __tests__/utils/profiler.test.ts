// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startProfiler,
  detectRuntime,
  ProfilerNotSupportedError,
} from '../../src/utils/profiler.js'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'profiler-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('detectRuntime', () => {
  it('returns false flags on plain Node.js', () => {
    expect(detectRuntime({} as typeof globalThis)).toEqual({ hasBun: false, hasDeno: false })
  })

  it('detects Bun global', () => {
    const fake = { Bun: {} } as unknown as typeof globalThis
    expect(detectRuntime(fake)).toEqual({ hasBun: true, hasDeno: false })
  })

  it('detects Deno global', () => {
    const fake = { Deno: {} } as unknown as typeof globalThis
    expect(detectRuntime(fake)).toEqual({ hasBun: false, hasDeno: true })
  })
})

describe('startProfiler', () => {
  it('captures a valid .cpuprofile JSON to baseDir/<runId>.cpuprofile', async () => {
    const handle = await startProfiler({ runId: 'p1', baseDir: testDir })
    // give the profiler something to sample
    let acc = 0
    for (let i = 0; i < 10_000; i++) acc += i
    expect(acc).toBeGreaterThan(0)
    const outPath = await handle.stop()
    expect(outPath).toBe(join(testDir, 'p1.cpuprofile'))
    expect(existsSync(outPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(outPath, 'utf-8')) as Record<string, unknown>
    // V8 cpuprofile minimum shape
    expect(parsed.nodes).toBeDefined()
    expect(Array.isArray(parsed.nodes)).toBe(true)
    expect(typeof parsed.startTime).toBe('number')
    expect(typeof parsed.endTime).toBe('number')
  })
})

describe('ProfilerNotSupportedError', () => {
  it('has descriptive message', () => {
    const err = new ProfilerNotSupportedError('Bun')
    expect(err.message).toContain('Bun')
    expect(err.name).toBe('ProfilerNotSupportedError')
  })
})
