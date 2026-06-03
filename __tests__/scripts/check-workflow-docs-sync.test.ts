// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-workflow-docs-sync.mjs')

function run(dir: string) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf-8' })
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function makeTemp(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-sync-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-workflow-docs-sync.mjs (INV-89 workflow documentation sync)', () => {
  it('exits 0 when all workflows are documented in docs/', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'test-workflow.yml'),
        'name: test\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
      )
      writeFileSync(
        join(dir, 'docs', 'REFERENCE.md'),
        '# Workflows\n\nThe test-workflow is our main CI workflow.\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 1 when a workflow is not referenced in any docs', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'undocumented.yml'),
        'name: undoc\non: push\n',
      )
      writeFileSync(join(dir, 'docs', 'REFERENCE.md'), '# Workflows\n\nSome other workflow here.\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('undocumented.yml')
      expect(result.stderr).toContain('INV-89')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when workflow name is referenced without extension', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'deploy.yaml'),
        'name: deploy\non: workflow_dispatch\n',
      )
      writeFileSync(join(dir, 'docs', 'README.md'), 'The deploy workflow runs on demand.\n')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('skips workflows with underscore prefix', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, '.github', 'workflows', '_internal.yml'), 'name: internal\n')
      writeFileSync(join(dir, 'docs', 'REFERENCE.md'), '# Workflows\n')
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('exits 0 when .github/workflows directory does not exist (SKIP)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'README.md'), '# Docs\n')
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 0 when docs directory does not exist (SKIP)', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      writeFileSync(join(dir, '.github', 'workflows', 'test.yml'), 'name: test\n')
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('SKIP')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when multiple workflows are undocumented', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      mkdirSync(join(dir, 'docs'), { recursive: true })
      writeFileSync(join(dir, '.github', 'workflows', 'foo.yml'), 'name: foo\n')
      writeFileSync(join(dir, '.github', 'workflows', 'bar.yml'), 'name: bar\n')
      writeFileSync(join(dir, 'docs', 'REFERENCE.md'), '# Workflows\n\nsome doc\n')
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('2/')
    } finally {
      cleanup()
    }
  })

  it('finds workflow referenced in nested docs subdirectories', () => {
    const { dir, cleanup } = makeTemp()
    try {
      mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
      mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true })
      writeFileSync(
        join(dir, '.github', 'workflows', 'nested-test.yml'),
        'name: nested\non: push\n',
      )
      writeFileSync(
        join(dir, 'docs', 'architecture', 'workflows.md'),
        'nested-test is documented\n',
      )
      expect(run(dir).status).toBe(0)
    } finally {
      cleanup()
    }
  })
})
