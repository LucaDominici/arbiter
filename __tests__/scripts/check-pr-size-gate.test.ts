// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-pr-size-gate.mjs')

function run(cwd: string) {
  const r = spawnSync('node', [SCRIPT], {
    encoding: 'utf-8',
    cwd,
  })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pr-size-gate-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-pr-size-gate.mjs (INV-89)', () => {
  it('exits 0 when config file exists with valid JSON and valid thresholds', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(
        join(dir, 'config', 'pr-size-config.json'),
        JSON.stringify({
          warnLines: 500,
          errorLines: 3000,
        }),
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when config file contains invalid JSON', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(join(dir, 'config', 'pr-size-config.json'), '{invalid json}')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('invalid JSON')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when warnLines exceeds maximum (1000)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(
        join(dir, 'config', 'pr-size-config.json'),
        JSON.stringify({
          warnLines: 1001,
          errorLines: 3000,
        }),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('warnLines')
      expect(result.stderr).toContain('exceeds maximum 1000')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when errorLines exceeds maximum (5000)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'config'), { recursive: true })
      writeFileSync(
        join(dir, 'config', 'pr-size-config.json'),
        JSON.stringify({
          warnLines: 500,
          errorLines: 5001,
        }),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('errorLines')
      expect(result.stderr).toContain('exceeds maximum 5000')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when no config file but size-check is referenced in a workflow', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'ci.yml'),
        'name: CI\non: [push]\njobs:\n  check: run size-check\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when no config file and no workflows directory (SKIP case)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with --help flag', () => {
    const r = spawnSync('node', [SCRIPT, '--help'], {
      encoding: 'utf-8',
      cwd: resolve('.'),
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Usage')
  })
})
