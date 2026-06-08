// SPDX-License-Identifier: Apache-2.0
// #1243 — Docs-Evo 4/5: delete the disposable tier (register §DELETE) + same-PR gate updates.
// These tests assert the deletion result against the ACTUAL repo state: every §DELETE target is
// gone, the INV-86 parity input (kit-canonical-mapping.json) is preserved (misclassified by the
// register's §DELETE; flagged), INV-86 still runs green, INDEX/SSOT are regenerated without the
// deleted paths, and no dangling doc-links remain.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = resolve('.')
const has = (p: string): boolean => existsSync(resolve(ROOT, p))
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8')

// ── §DELETE targets (104 files; kit-canonical-mapping.json deliberately excluded) ─────────────
const POINT_IN_TIME = [
  'docs/PRODUCT/RELEASE-V1-TRACKING.md',
  'docs/PRODUCT/CONVERGENCE-2026-06.md',
  'docs/STRUCTURE-AUDIT.md',
  'docs/plans/planning-skeleton-migration-plan.md',
  'docs/SYSTEM/CI-MIGRATION.md',
  'docs/GOVERNANCE/GOOD-FIRST-ISSUE-CURATION.md',
]
const DUPS = [
  'docs/GOVERNANCE/README.md',
  'docs/sponsors.md',
  'docs/COMMUNITY/DISCUSSIONS.md',
  'docs/internal/mobile-responsiveness-checklist.md',
  'docs/internal/qa-checklist.md',
]
const REFERENCE = [
  'docs/REFERENCE/GLOBAL_KIT.md',
  'docs/REFERENCE/SELF-KIT-AUDIT.md',
  'docs/REFERENCE/CLI.md',
  'docs/REFERENCE/HOOKS.md',
  'docs/REFERENCE/TEMPLATES.md',
  'docs/REFERENCE/STACK-SUPPORT.md',
]
const AUDITS = [
  'docs/audits/arbiter-skeleton-gap-analysis.md',
  'docs/audits/compat-fixes-854-855-2026-05-18.md',
  'docs/audits/cross-repo-kit-coverage-2026-05-29.md',
  'docs/audits/dual-adr-cli-followup-2026-06-02.md',
  'docs/audits/kit-canonical-mapping.md',
  'docs/audits/planning-orphan-debt.md',
  'docs/audits/planning-skeleton-audit.md',
  'docs/audits/planning-skeleton-inventory.json',
  'docs/audits/unwired-exports-2026-06-01.md',
]
const STRAY = ['docs/SYSTEM/branch-protection-snapshot-pre-tier.json']
const GUARD_TEST = ['__tests__/docs/structure-audit.test.ts']

describe('docs-evo #1243 — disposable tier deleted (no content loss)', () => {
  it('removes all docs/REFERENCE/coverage/ dim-NN stubs', () => {
    expect(has('docs/REFERENCE/coverage')).toBe(false)
  })

  it.each([...POINT_IN_TIME, ...DUPS, ...REFERENCE, ...AUDITS, ...STRAY, ...GUARD_TEST])(
    'deletes %s',
    (p) => {
      expect(has(p), `${p} should be deleted`).toBe(false)
    },
  )

  it('leaves docs/audits/ holding only the INV-86 parity input (kit-canonical-mapping.json)', () => {
    // The audits dir survives solely for the INV-86 gate input the register §DELETE misclassified.
    const survivors = has('docs/audits') ? readdirSync(resolve(ROOT, 'docs/audits')).sort() : []
    expect(survivors).toEqual(['kit-canonical-mapping.json'])
  })
})

describe('docs-evo #1243 — same-PR gate updates (no dangling reference)', () => {
  it('preserves the live INV-86 parity input and its gate runs green', () => {
    expect(has('docs/audits/kit-canonical-mapping.json')).toBe(true)
    // check-kit-catalog-parity.mjs must still exit 0 (INV-86 unbroken).
    expect(() =>
      execFileSync('node', ['scripts/check-kit-catalog-parity.mjs'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow()
  })

  it('drops the SELF-KIT-AUDIT allowlist entry from check-doc-style.mjs', () => {
    expect(read('scripts/check-doc-style.mjs')).not.toContain('SELF-KIT-AUDIT.md')
  })

  it('regenerates docs/INDEX.md without any deleted path', () => {
    const index = read('docs/INDEX.md')
    expect(index).not.toContain('REFERENCE/coverage/')
    expect(index).not.toContain('GLOBAL_KIT')
    expect(index).not.toContain('SELF-KIT-AUDIT')
    expect(index).not.toContain('STRUCTURE-AUDIT')
    expect(index).not.toContain('RELEASE-V1-TRACKING')
    expect(index).not.toContain('CI-MIGRATION')
    expect(index).not.toContain('GOOD-FIRST-ISSUE-CURATION')
  })

  it('regenerates docs/METHOD/SSOT_CORE_SET.md without any deleted path', () => {
    const ssot = read('docs/METHOD/SSOT_CORE_SET.md')
    expect(ssot).not.toContain('REFERENCE/coverage/')
    expect(ssot).not.toContain('GLOBAL_KIT')
    expect(ssot).not.toContain('SELF-KIT-AUDIT')
  })

  it('has no dangling doc-links after deletion (check-doc-links green)', () => {
    expect(() =>
      execFileSync('node', ['scripts/check-doc-links.mjs'], { cwd: ROOT, stdio: 'pipe' }),
    ).not.toThrow()
  })
})
