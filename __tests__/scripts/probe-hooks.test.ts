// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/probe-hooks.mjs')
const ADVISORY_HOOK = 'debug-state-on-failure.mjs'

function fixture(hookBody?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'arbiter-probe-hooks-'))
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  writeFileSync(
    join(dir, '.arbiter-generated-manifest.json'),
    JSON.stringify({
      $schemaVersion: 1,
      files: { [`.claude/hooks/${ADVISORY_HOOK}`]: 'recorded-render-hash' },
    }),
  )
  if (hookBody !== undefined) {
    writeFileSync(join(dir, '.claude', 'hooks', ADVISORY_HOOK), hookBody)
  }
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'probe' + '@' + 'example.invalid'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Probe'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function run(dir: string) {
  return spawnSync('node', [SCRIPT, '--root', dir, '--language', 'typescript'], {
    cwd: dir,
    encoding: 'utf-8',
  })
}

describe('probe-hooks liveness contract (#2135)', () => {
  it('accepts an advisory hook only when it executes successfully in both states', () => {
    const dir = fixture('process.exit(0)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      const report = JSON.parse(result.stdout)
      expect(report.rows).toHaveLength(2)
      expect(report.rows.every((row: { verdict: string }) => row.verdict === 'ADVISORY')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('turns advisory exit 1 into a probe error instead of a healthy classification', () => {
    const dir = fixture('process.exit(1)\n')
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      const report = JSON.parse(result.stdout)
      expect(report.failures).toEqual(
        expect.arrayContaining([expect.objectContaining({ verdict: 'PROBE-ERROR' })]),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('turns a missing emitted advisory hook into a probe error', () => {
    const dir = fixture()
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('PROBE-ERROR')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses exit 2 for malformed invocation', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8' })
    expect(result.status).toBe(2)
  })
})
