// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { recordPhaseCost } from '../../src/cost/recorder.js'

describe('recordPhaseCost (#703)', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })

  function tmpDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'recorder-test-'))
    dirs.push(d)
    return d
  }

  function readReport(
    dir: string,
    taskId: string,
  ): {
    taskId: string
    byPhase: Record<string, { in: number; out: number; samples: number }>
    totals: { in: number; out: number; samples: number }
  } {
    const path = join(dir, '.arbiter', 'evidence', 'cost', `${taskId}.json`)
    return JSON.parse(readFileSync(path, 'utf-8')) as ReturnType<typeof readReport>
  }

  it('creates evidence file on first write', () => {
    const dir = tmpDir()
    recordPhaseCost('#703', 'red', { in: 1000, out: 200, samples: 3 }, dir)
    const report = readReport(dir, '#703')
    expect(report.taskId).toBe('#703')
    expect(report.byPhase.red).toEqual({ in: 1000, out: 200, samples: 3 })
    expect(report.totals).toEqual({ in: 1000, out: 200, samples: 3 })
  })

  it('merges second phase write without clobbering first', () => {
    const dir = tmpDir()
    recordPhaseCost('#703', 'red', { in: 1000, out: 200, samples: 3 }, dir)
    recordPhaseCost('#703', 'green', { in: 500, out: 100, samples: 2 }, dir)
    const report = readReport(dir, '#703')
    expect(report.byPhase.red).toEqual({ in: 1000, out: 200, samples: 3 })
    expect(report.byPhase.green).toEqual({ in: 500, out: 100, samples: 2 })
    expect(report.totals).toEqual({ in: 1500, out: 300, samples: 5 })
  })

  it('accumulates samples on second write to same phase', () => {
    const dir = tmpDir()
    recordPhaseCost('#703', 'red', { in: 1000, out: 200, samples: 2 }, dir)
    recordPhaseCost('#703', 'red', { in: 500, out: 100, samples: 1 }, dir)
    const report = readReport(dir, '#703')
    expect(report.byPhase.red).toEqual({ in: 1500, out: 300, samples: 3 })
  })

  it('evidence file contains no PII fields (only numeric + taskId)', () => {
    const dir = tmpDir()
    recordPhaseCost('#703', 'red', { in: 100, out: 20, samples: 1 }, dir)
    const path = join(dir, '.arbiter', 'evidence', 'cost', '#703.json')
    const raw = readFileSync(path, 'utf-8')
    expect(raw).not.toMatch(/@[a-zA-Z]/)
  })

  it('creates parent directories atomically', () => {
    const dir = tmpDir()
    recordPhaseCost('#703', 'plan', { in: 200, out: 40, samples: 1 }, dir)
    expect(existsSync(join(dir, '.arbiter', 'evidence', 'cost', '#703.json'))).toBe(true)
  })
})
