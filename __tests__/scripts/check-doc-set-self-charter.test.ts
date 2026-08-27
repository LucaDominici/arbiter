// SPDX-License-Identifier: Apache-2.0
// T5(a) (gold-doc-tranches-t3-t5.md §3, self-tier addendum) — the `self-charter` overlay enrolls
// arbiter's own foundational docs (the standard, the methodology, and the 3 gold-doc design
// docs) as mandatory, all-R (tier-invariant) rows — mandatory on self even while the derived
// column reads non-enterprise, robust to T1b landing order. Fixture-based: proves the mechanism
// generically (not by depending on the real standards/gold-doc-set.yml's live charter rows,
// which are asserted directly in the "real manifest" describe block below).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

const SCRIPT = resolve('scripts/check-doc-set.mjs')
const SHIPPED_MANIFEST = resolve('standards/gold-doc-set.yml')
const SHIPPED_PROFILE = resolve('standards/doc-profile')

const CHARTER_MANIFEST = `version: '1.0.0'
profile: tooling
checks:
  - path: docs/research/standard.md
    tier: mandatory
    tiers: { solo: 'R', small: 'R', enterprise: 'R' }
    applies: self-charter
  - path: docs/methodology/hygiene.md
    tier: mandatory
    tiers: { solo: 'R', small: 'R', enterprise: 'R' }
    applies: self-charter
  - path: docs/design/capability.md
    tier: mandatory
    tiers: { solo: 'R', small: 'R', enterprise: 'R' }
    applies: self-charter
  - path: docs/design/addendum.md
    tier: mandatory
    tiers: { solo: 'R', small: 'R', enterprise: 'R' }
    applies: self-charter
`

const CHARTER_PATHS = [
  'docs/research/standard.md',
  'docs/methodology/hygiene.md',
  'docs/design/capability.md',
  'docs/design/addendum.md',
]

function makeRepo(overlayOn: boolean): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-set-self-charter-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), CHARTER_MANIFEST)
  writeFileSync(
    join(dir, 'standards', 'doc-profile'),
    overlayOn ? 'overlays:\n  - self-charter\ntier_floor: enterprise\n' : 'overlays: []\n',
  )
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('check-doc-set: self-charter overlay (T5a, fixture)', () => {
  it('RED-by-construction: self-charter OFF -> the 4 charter rows are n/a, never a gap', () => {
    const { dir, cleanup } = makeRepo(false)
    try {
      const r = spawnSync('node', [SCRIPT, '--strict', '--json'], { encoding: 'utf-8', cwd: dir })
      const j = JSON.parse(r.stdout)
      expect(j.totals.na).toBe(4)
      expect(j.totals.missingMandatory).toBe(0)
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('Presence, unit (§3.3): self-charter ON + none of the 4 files -> all 4 reported missing, exit 1', () => {
    const { dir, cleanup } = makeRepo(true)
    try {
      const r = spawnSync('node', [SCRIPT, '--strict', '--json'], { encoding: 'utf-8', cwd: dir })
      const j = JSON.parse(r.stdout)
      expect(j.tierColumn).toBe('enterprise')
      expect(j.totals.missingMandatory).toBe(4)
      expect(j.missingMandatory.sort()).toEqual([...CHARTER_PATHS].sort())
      expect(r.status).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('Presence, live (§3.3): creating all 4 charter docs flips the same repo to GREEN', () => {
    const { dir, cleanup } = makeRepo(true)
    try {
      for (const p of CHARTER_PATHS) {
        mkdirSync(join(dir, p.split('/').slice(0, -1).join('/')), { recursive: true })
        writeFileSync(join(dir, p), '# charter doc\n')
      }
      const r = spawnSync('node', [SCRIPT, '--strict'], { encoding: 'utf-8', cwd: dir })
      expect(r.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('removing ONE charter doc after enrollment goes RED again, naming exactly that file', () => {
    const { dir, cleanup } = makeRepo(true)
    try {
      for (const p of CHARTER_PATHS) {
        mkdirSync(join(dir, p.split('/').slice(0, -1).join('/')), { recursive: true })
        writeFileSync(join(dir, p), '# charter doc\n')
      }
      rmSync(join(dir, 'docs', 'design', 'capability.md'))
      const r = spawnSync('node', [SCRIPT, '--strict'], { encoding: 'utf-8', cwd: dir })
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('docs/design/capability.md')
      expect(r.stdout).not.toContain('docs/design/addendum.md')
    } finally {
      cleanup()
    }
  })
})

// ─── Real manifest: the actual 5 self-charter rows land on self, not just the fixture ─────────
describe('check-doc-set: the SHIPPED self manifest enrolls the 5 real charter rows (T5a)', () => {
  const manifest = parseYaml(readFileSync(SHIPPED_MANIFEST, 'utf-8')) as {
    checks: Array<{ path: string; applies: string; tiers?: Record<string, string> }>
  }
  const charterRows = manifest.checks.filter((c) => c.applies === 'self-charter')

  it('enrolls exactly the 6 designed charter rows, all-R (tier-invariant)', () => {
    const paths = charterRows.map((c) => c.path).sort()
    expect(paths).toEqual(
      [
        'docs/research/enterprise-doc-standard-2026.md',
        'docs/methodology/agent-orchestration-and-context-hygiene.md',
        'docs/design/gold-doc-capability.md',
        'docs/design/gold-doc-self-tier-and-coherence.md',
        'docs/design/gold-doc-tranches-t3-t5.md',
        // #2360: the public comparison tables had drifted from what the tool does.
        // Enrolling them as a high-churn charter row is what stops that recurring —
        // they now have a tracked freshness obligation instead of relying on notice.
        'website/comparisons',
      ].sort(),
    )
    for (const c of charterRows) {
      expect(c.tiers, `${c.path} must be all-R (robust to tier_floor landing order)`).toEqual({
        solo: 'R',
        small: 'R',
        enterprise: 'R',
      })
    }
  })

  it('self doc-profile enables self-charter and sets tier_floor: enterprise', () => {
    const profile = parseYaml(readFileSync(SHIPPED_PROFILE, 'utf-8')) as {
      overlays: string[]
      tier_floor?: string
    }
    expect(profile.overlays).toContain('self-charter')
    expect(profile.tier_floor).toBe('enterprise')
  })

  it('self resolves to the enterprise column (T1b) with the real manifest + profile', () => {
    const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf-8' })
    const j = JSON.parse(r.stdout)
    expect(j.tierColumn).toBe('enterprise')
    expect(j.tierDerived).toBe('solo') // arbiter.json is trunk-solo; the floor does the raising
    expect(j.tierFloor).toBe('enterprise')
  })
})
