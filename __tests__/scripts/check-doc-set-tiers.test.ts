// SPDX-License-Identifier: Apache-2.0
// H3 (gold-doc-capability, Tranche 1) — tiers{} + collaborationMode column resolution.
//
// Before this tranche, `check-doc-set.mjs` resolved requirement strength from the flat
// `tier: mandatory|recommended|conditional` literal alone — every governed repo received
// the SAME mandatory set regardless of collaborationMode (the "cathedral" bug, H3). A solo
// (trunk-solo) repo missing docs/architecture/ARCHITECTURE.md and docs/GOVERNANCE.md was
// unconditionally reported as 2 missing-mandatory gaps.
//
// RED (pre-Tranche-1, reproduced below via the `enterprise` column — which intentionally
// preserves the old flat-mandatory-for-all behavior): the same fixture, same missing files,
// resolves to missingMandatory=2 under `gated-review` (enterprise).
// GREEN (post-Tranche-1): under `trunk-solo` (solo), the same fixture resolves to
// missingMandatory=0 — ARCHITECTURE.md degrades to a recommended gap, GOVERNANCE.md is
// dormant (skipped, counted as n/a), per the anti-cathedral guardrail.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-doc-set.mjs')

// Mirrors the production tiers{} cells for these two checks (standards/gold-doc-set.yml).
const MANIFEST = `version: '1.1.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    tiers: { solo: 'R', small: 'R', enterprise: 'R' }
    applies: always
  - path: docs/architecture/ARCHITECTURE.md
    tier: mandatory
    tiers: { solo: 'r', small: 'R', enterprise: 'R' }
    applies: always
  - path: docs/GOVERNANCE.md
    tier: mandatory
    tiers: { solo: 'o', small: 'r', enterprise: 'R' }
    applies: always
  - path: docs/operations/slo.md
    tier: conditional
    applies: deploys
  - path: docs/security/threat-model.md
    tier: conditional
    applies: customer-data
`

function makeRepo(collaborationMode?: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-set-tiers-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), MANIFEST)
  writeFileSync(join(dir, 'README.md'), '# r') // always-required at every tier; keep it present
  if (collaborationMode) {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode }))
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runJson(dir: string): {
  tierColumn: string
  totals: { missingMandatory: number; missingRecommended: number; na: number }
  missingMandatory: string[]
  missingRecommended: string[]
} {
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf-8', cwd: dir })
  return JSON.parse(r.stdout)
}

describe('check-doc-set: tiers{} + collaborationMode resolution (H3, gold-doc-capability T1)', () => {
  it('RED equivalent: gated-review (enterprise) reproduces the old tier-blind cathedral — both docs mandatory', () => {
    const { dir, cleanup } = makeRepo('gated-review')
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('enterprise')
      expect(j.totals.missingMandatory).toBe(2)
      expect(j.missingMandatory).toEqual(
        expect.arrayContaining(['docs/architecture/ARCHITECTURE.md', 'docs/GOVERNANCE.md']),
      )
    } finally {
      cleanup()
    }
  })

  it('GREEN: trunk-solo (solo) — 0 mandatory gaps for the same missing files (anti-cathedral guardrail)', () => {
    const { dir, cleanup } = makeRepo('trunk-solo')
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('solo')
      expect(j.totals.missingMandatory).toBe(0)
      // ARCHITECTURE.md degrades to a recommended (advisory) gap...
      expect(j.missingRecommended).toContain('docs/architecture/ARCHITECTURE.md')
      // ...GOVERNANCE.md is dormant (o ⇒ skip/na), never even a recommended gap.
      expect(j.missingRecommended).not.toContain('docs/GOVERNANCE.md')
    } finally {
      cleanup()
    }
  })

  it('peer-review (small) sits between solo and enterprise: ARCHITECTURE mandatory, GOVERNANCE only recommended', () => {
    const { dir, cleanup } = makeRepo('peer-review')
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('small')
      expect(j.totals.missingMandatory).toBe(1)
      expect(j.missingMandatory).toEqual(['docs/architecture/ARCHITECTURE.md'])
      expect(j.missingRecommended).toContain('docs/GOVERNANCE.md')
    } finally {
      cleanup()
    }
  })

  it('absent arbiter.json defaults to peer-review (small) — matches the codebase-wide default', () => {
    const { dir, cleanup } = makeRepo(undefined)
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('small')
    } finally {
      cleanup()
    }
  })

  it('anti-cathedral guardrail: solo never gets a MANDATORY conditional (overlay-gated) doc', () => {
    // Even with both overlay triggers firing, conditional checks (SLO, threat-model) have no
    // tiers{} in T1 and are governed entirely by the legacy `conditional` path — a missing
    // conditional doc is always advisory, never a --strict-blocking mandatory gap, at any tier.
    const { dir, cleanup } = makeRepo('trunk-solo')
    try {
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      mkdirSync(join(dir, 'standards'), { recursive: true })
      writeFileSync(
        join(dir, 'standards', 'doc-profile'),
        'overlays:\n  - deploys\n  - customer-data\n',
      )
      const strict = spawnSync('node', [SCRIPT, '--strict'], { encoding: 'utf-8', cwd: dir })
      // ARCHITECTURE.md (recommended for solo) + GOVERNANCE.md (skip) are still the only
      // non-conditional gaps; neither the SLO nor the threat-model conditional gap can fail
      // --strict regardless of the `deploys`/`customer-data` overlay being enabled.
      expect(strict.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('unrecognized collaborationMode value fails closed to mandatory (never silently drops a requirement)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-set-tiers-badcell-'))
    try {
      mkdirSync(join(dir, 'standards'), { recursive: true })
      writeFileSync(
        join(dir, 'standards', 'gold-doc-set.yml'),
        `version: '1.1.0'\nprofile: tooling\nchecks:\n  - path: docs/GOVERNANCE.md\n    tier: mandatory\n    tiers: { solo: 'X', small: 'r', enterprise: 'R' }\n    applies: always\n`,
      )
      writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode: 'trunk-solo' }))
      const j = runJson(dir)
      expect(j.totals.missingMandatory).toBe(1) // malformed cell 'X' ⇒ fail-closed to mandatory
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
