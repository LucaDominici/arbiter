// SPDX-License-Identifier: Apache-2.0
// TDD guard for #903 — check-ci-tiers.mjs reads minPresent from catalog.ts (INV-73).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = resolve('scripts/check-ci-tiers.mjs')

const ALL_CANONICAL = [
  '01-pr-fast.yml',
  '02-pr-extended.yml',
  '03-human-approval.yml',
  '05-release.yml',
  '06-nightly.yml',
  '07-weekly.yml',
  '08-monthly.yml',
  '09-heartbeat.yml',
]

function run(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8', cwd: dir })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function makeDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'check-ci-tiers-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function writeCatalogWithMinPresent(dir: string, minPresent: number): void {
  const catalogDir = join(dir, 'src', 'invariants')
  mkdirSync(catalogDir, { recursive: true })
  const stub = `
export const invariants = [
  {
    id: 'INV-73',
    tier: 'operational',
    title: 'CI tier presence',
    description: 'stub',
    alwaysActive: false,
    enforcement: 'scripts/check-ci-tiers.mjs (L1 gate)',
    migrationStatus: 'transition',
    minPresent: ${minPresent},
  },
]`
  writeFileSync(join(catalogDir, 'catalog.ts'), stub)
}

function writeWorkflows(dir: string, files: string[]): void {
  const wfDir = join(dir, '.github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  for (const f of files) {
    writeFileSync(join(wfDir, f), `# ${f}\n`)
  }
}

describe('check-ci-tiers.mjs (#903, INV-73 minPresent)', () => {
  it('exits 0 when enough workflows are present (minPresent=4, 4 present)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 4)
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '09-heartbeat.yml',
      ])
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('OK')
      expect(result.stdout).toContain('minPresent=4')
    } finally {
      cleanup()
    }
  })

  it('exits 1 when fewer than minPresent workflows are present (minPresent=4, 3 present)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 4)
      writeWorkflows(dir, ['01-pr-fast.yml', '02-pr-extended.yml', '03-human-approval.yml'])
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('minPresent=4')
    } finally {
      cleanup()
    }
  })

  it('exits 0 and shows WARN for missing optional workflows when minPresent met', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 4)
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '09-heartbeat.yml',
      ])
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('WARN')
      expect(result.stdout).toContain('missing: .github/workflows/05-release.yml')
    } finally {
      cleanup()
    }
  })

  it('exits 0 with no warnings when all 8 canonical workflows are present', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 4)
      writeWorkflows(dir, ALL_CANONICAL)
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('WARN')
    } finally {
      cleanup()
    }
  })

  it('falls back to requiring all when no catalog is present (no src/invariants/catalog.ts)', () => {
    // When no catalog, minPresent = 8 (all canonical)
    const { dir, cleanup } = makeDir()
    try {
      writeWorkflows(dir, ALL_CANONICAL)
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('reads minPresent=8 correctly and fails when only 4 present', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 8)
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '09-heartbeat.yml',
      ])
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('FAIL')
      expect(result.stderr).toContain('minPresent=8')
    } finally {
      cleanup()
    }
  })
})
