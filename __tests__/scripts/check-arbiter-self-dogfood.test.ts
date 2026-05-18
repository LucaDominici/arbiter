// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-self-dogfood-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  const realSrc = join(process.cwd(), 'scripts', 'check-arbiter-self-dogfood.mjs')
  writeFileSync(
    join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'),
    readFileSync(realSrc, 'utf-8'),
  )
  return dir
}

describe('check-arbiter-self-dogfood.mjs', () => {
  it('exits 2 when no baseline file exists', () => {
    const dir = fixtureRepo()
    try {
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('no baseline')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--refresh-baseline writes baseline and exits 0', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'name: a\non: push\njobs: {}\n')
      const r = spawnSync(
        'node',
        [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'), '--refresh-baseline'],
        { cwd: dir, encoding: 'utf-8' },
      )
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('baseline refreshed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PASSES when violation count matches baseline', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(
        join(dir, '.github', 'workflows', 'a.yml'),
        'name: a\non: push\njobs: {}\n', // missing permissions
      )
      spawnSync(
        'node',
        [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'), '--refresh-baseline'],
        { cwd: dir, encoding: 'utf-8' },
      )
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('PASS')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('FAILS when violation count exceeds baseline', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(
        join(dir, '.github', 'workflows', 'a.yml'),
        'name: a\non: push\npermissions:\n  contents: read\njobs: {}\n',
      )
      // Baseline = 0 violations
      spawnSync(
        'node',
        [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'), '--refresh-baseline'],
        { cwd: dir, encoding: 'utf-8' },
      )
      // Add a violating workflow → 1 violation > baseline 0
      writeFileSync(join(dir, '.github', 'workflows', 'b.yml'), 'name: b\non: push\njobs: {}\n')
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('FAIL')
      expect(r.stderr).toContain('new violations introduced')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PASSES and notes improvement when count shrinks below baseline', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'name: a\non: push\njobs: {}\n')
      writeFileSync(join(dir, '.github', 'workflows', 'b.yml'), 'name: b\non: push\njobs: {}\n')
      // Baseline = 2 violations
      spawnSync(
        'node',
        [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'), '--refresh-baseline'],
        { cwd: dir, encoding: 'utf-8' },
      )
      // Fix one workflow → 1 violation < baseline 2
      writeFileSync(
        join(dir, '.github', 'workflows', 'b.yml'),
        'name: b\non: push\npermissions:\n  contents: read\njobs: {}\n',
      )
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('PASS')
      expect(r.stdout).toContain('improvement')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flags write-all as a violation', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(
        join(dir, '.github', 'workflows', 'a.yml'),
        'name: a\non: push\npermissions: write-all\njobs: {}\n',
      )
      const refresh = spawnSync(
        'node',
        [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'), '--refresh-baseline'],
        { cwd: dir, encoding: 'utf-8' },
      )
      expect(refresh.stdout).toContain('"workflowPermsViolations": 1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 with clear message when baseline JSON is malformed', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'name: a\non: push\njobs: {}\n')
      writeFileSync(join(dir, '.self-dogfood-baseline.json'), '{ not valid json')
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('malformed JSON')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when baseline file is missing required numeric keys', () => {
    const dir = fixtureRepo()
    try {
      writeFileSync(join(dir, '.github', 'workflows', 'a.yml'), 'name: a\non: push\njobs: {}\n')
      writeFileSync(
        join(dir, '.self-dogfood-baseline.json'),
        JSON.stringify({ capturedAt: '2025-01-01', actionPinsViolations: 'not-a-number' }),
      )
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('missing numeric keys')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to run when both .github/workflows and .github/actions are absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbiter-empty-'))
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(
      join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs'),
      readFileSync(join(process.cwd(), 'scripts', 'check-arbiter-self-dogfood.mjs'), 'utf-8'),
    )
    try {
      const r = spawnSync('node', [join(dir, 'scripts', 'check-arbiter-self-dogfood.mjs')], {
        cwd: dir,
        encoding: 'utf-8',
      })
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('neither')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
