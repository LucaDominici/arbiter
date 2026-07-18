// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-runners.mjs')

function run(dir: string, runner?: string) {
  const args = [SCRIPT, '--dir', dir]
  if (runner) args.push('--runner', runner)
  const r = spawnSync('node', args, { encoding: 'utf-8' })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'runner-check-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-workflow-runners.mjs (INV-89 runner label drift)', () => {
  it('exits 0 when workflows/ directory does not exist', () => {
    const { dir, cleanup } = makeTemp()
    try {
      // .github/workflows/ missing — no files to scan, zero violations
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when all jobs use the expected runner (ubuntu-latest default)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'test.yml'),
        ['name: Test', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps: []'].join(
          '\n',
        ),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
      expect(result.stdout).toContain('ubuntu-latest')
    } finally {
      cleanup()
    }
  })

  it('exits 1 with FAIL when a job uses a non-standard runner (enforcing)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'custom.yml'),
        ['name: Custom', 'jobs:', '  build:', '    runs-on: custom-runner', '    steps: []'].join(
          '\n',
        ),
      )
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('custom-runner')
      expect(result.stdout).toContain('FAIL')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with custom --runner flag when all jobs match the custom label', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'custom.yml'),
        ['name: Custom', 'jobs:', '  build:', '    runs-on: macos-latest', '    steps: []'].join(
          '\n',
        ),
      )
      const result = run(dir, 'macos-latest')
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
      expect(result.stdout).toContain('macos-latest')
    } finally {
      cleanup()
    }
  })

  it('exits 1 with FAIL when custom --runner flag does not match actual runners', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'ubuntu.yml'),
        ['name: Ubuntu', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    steps: []'].join(
          '\n',
        ),
      )
      const result = run(dir, 'windows-latest')
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('windows-latest')
    } finally {
      cleanup()
    }
  })

  it('skips matrix expressions and env var refs (does not count as violations)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'matrix.yml'),
        [
          'name: Matrix',
          'jobs:',
          '  build:',
          '    runs-on: ${{ matrix.os }}',
          '    steps: []',
          '  other:',
          '    runs-on: $CI_RUNNER',
          '    steps: []',
        ].join('\n'),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      // No WARN — matrix and env ref expressions are allowed
      expect(result.stdout).toContain('OK')
      expect(result.stderr).toEqual('')
    } finally {
      cleanup()
    }
  })

  it('trims quotes from runner labels', () => {
    const { dir, cleanup } = makeTemp()
    try {
      const workflowDir = join(dir, '.github', 'workflows')
      mkdirSync(workflowDir, { recursive: true })
      writeFileSync(
        join(workflowDir, 'quoted.yml'),
        ['name: Quoted', 'jobs:', '  build:', '    runs-on: "ubuntu-latest"', '    steps: []'].join(
          '\n',
        ),
      )
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
    } finally {
      cleanup()
    }
  })
})
