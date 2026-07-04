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

function writeArbiterJson(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ version: '0.2', ...config }, null, 2))
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

// ─── #1319.2: collaboration-mode / level-aware required-set layer (INV-73) ────
// When arbiter.json is present, the self checker ALSO verifies the collab-aware
// required tier set (the inverse of the github.ts generation predicates) — on top
// of the INV-73 minPresent floor. Trunk-solo's nightly slot is satisfied by either
// 06-nightly-lite.yml OR the full 06-nightly.yml (arbiter dogfoods the full suite).
describe('check-ci-tiers.mjs — collab/level-aware required set (#1319.2, INV-73)', () => {
  it('trunk-solo L3 FAILS when 09-heartbeat is missing', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 1)
      writeArbiterJson(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' })
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '06-nightly-lite.yml',
        // 09-heartbeat.yml absent → collab-aware layer must FAIL
      ])
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-73')
      expect(result.stderr).toContain('09-heartbeat.yml')
    } finally {
      cleanup()
    }
  })

  // PORT A2 (#1502): trunk-solo L3+ requires a deep weekly sweep — 07-weekly-lite
  // OR the full 07-weekly satisfies the slot.
  it('trunk-solo L3 FAILS when the weekly slot (07-weekly-lite / 07-weekly) is missing', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 1)
      writeArbiterJson(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' })
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '06-nightly-lite.yml',
        '09-heartbeat.yml',
        // 07-weekly-lite.yml absent → collab-aware layer must FAIL
      ])
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-73')
      expect(result.stderr).toContain('07-weekly-lite.yml')
    } finally {
      cleanup()
    }
  })

  it('trunk-solo L3 PASSES when 07-weekly-lite satisfies the weekly slot', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 1)
      writeArbiterJson(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L3' })
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '05-release.yml',
        '06-nightly-lite.yml',
        '07-weekly-lite.yml',
        '09-heartbeat.yml',
      ])
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('trunk-solo L2 FAILS when neither 06-nightly nor 06-nightly-lite present', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 1)
      writeArbiterJson(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' })
      writeWorkflows(dir, ['01-pr-fast.yml', '02-pr-extended.yml', '03-human-approval.yml'])
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('INV-73')
    } finally {
      cleanup()
    }
  })

  it('trunk-solo L2 PASSES when the full 06-nightly.yml satisfies the nightly slot', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 1)
      writeArbiterJson(dir, { collaborationMode: 'trunk-solo', governanceLevel: 'L2' })
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '06-nightly.yml',
      ])
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('peer-review L2 (standard) does NOT require 06/07/08 (no false-fail)', () => {
    const { dir, cleanup } = makeDir()
    try {
      writeCatalogWithMinPresent(dir, 1)
      writeArbiterJson(dir, { collaborationMode: 'peer-review', governanceLevel: 'L2' })
      writeWorkflows(dir, [
        '01-pr-fast.yml',
        '02-pr-extended.yml',
        '03-human-approval.yml',
        '05-release.yml',
      ])
      const result = run(dir)
      expect(result.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('regression guard: arbiter own .github/workflows exits 0 (RT TDD unit 5)', () => {
    // Run against the real repo root — arbiter.json (trunk-solo L2) + real workflows.
    const result = run(resolve('.'))
    expect(result.status).toBe(0)
  })
})
