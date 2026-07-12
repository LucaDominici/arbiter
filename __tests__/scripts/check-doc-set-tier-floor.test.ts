// SPDX-License-Identifier: Apache-2.0
// T1b (gold-doc-self-tier-and-coherence.md §1) — `tier_floor` in standards/doc-profile, with
// max() semantics on solo < small < enterprise. Closes the live regression the addendum found:
// self (arbiter.json `collaborationMode: trunk-solo`) silently graded itself on the SOLO column
// the moment tiers{} landed — 8 always-rows went dormant and self passed a materially weaker bar
// than the standard it enforces on others (§1.1). A floor can only RAISE the derived column,
// never lower it — the anti-cathedral guardrail (gold-doc-capability.md §2) survives untouched.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/check-doc-set.mjs')

const MANIFEST = `version: '1.1.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    tiers: { solo: 'R', small: 'R', enterprise: 'R' }
    applies: always
  - path: docs/GOVERNANCE.md
    tier: mandatory
    tiers: { solo: 'o', small: 'r', enterprise: 'R' }
    applies: always
`

function makeRepo(
  collaborationMode: string | undefined,
  profileYaml?: string,
): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-set-tier-floor-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), MANIFEST)
  writeFileSync(join(dir, 'README.md'), '# r')
  if (collaborationMode) {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ collaborationMode }))
  }
  if (profileYaml !== undefined) {
    writeFileSync(join(dir, 'standards', 'doc-profile'), profileYaml)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runJson(dir: string): {
  tierColumn: string
  tierDerived: string
  tierFloor: string | null
  totals: { missingMandatory: number }
} {
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf-8', cwd: dir })
  return JSON.parse(r.stdout)
}

function runStrict(dir: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, '--strict'], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('check-doc-set: tier_floor (T1b, self-tier addendum §1)', () => {
  it('RED equivalent (live self regression, §1.1): trunk-solo with NO floor grades docs/GOVERNANCE.md dormant, exit 0', () => {
    const { dir, cleanup } = makeRepo('trunk-solo')
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('solo')
      expect(j.tierDerived).toBe('solo')
      expect(j.tierFloor).toBeNull()
      const strict = runStrict(dir)
      expect(strict.status).toBe(0) // GOVERNANCE.md dormant at solo ('o' cell) -> never a gap
    } finally {
      cleanup()
    }
  })

  it('GREEN: trunk-solo + tier_floor: enterprise raises the column — GOVERNANCE.md is now a mandatory gap, exit 1', () => {
    const { dir, cleanup } = makeRepo('trunk-solo', 'overlays: []\ntier_floor: enterprise\n')
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('enterprise')
      expect(j.tierDerived).toBe('solo')
      expect(j.tierFloor).toBe('enterprise')
      expect(j.totals.missingMandatory).toBe(1)
      const strict = runStrict(dir)
      expect(strict.status).toBe(1)
      expect(strict.stdout).toContain('docs/GOVERNANCE.md')
    } finally {
      cleanup()
    }
  })

  it('a floor never LOWERS the column: gated-review + tier_floor: solo still resolves to enterprise', () => {
    const { dir, cleanup } = makeRepo('gated-review', 'overlays: []\ntier_floor: solo\n')
    try {
      const j = runJson(dir)
      expect(j.tierDerived).toBe('enterprise')
      expect(j.tierFloor).toBe('solo')
      expect(j.tierColumn).toBe('enterprise') // max(enterprise, solo) = enterprise, floor is a floor
    } finally {
      cleanup()
    }
  })

  it('peer-review + tier_floor: enterprise raises small -> enterprise (mid-tier floor still works)', () => {
    const { dir, cleanup } = makeRepo('peer-review', 'overlays: []\ntier_floor: enterprise\n')
    try {
      const j = runJson(dir)
      expect(j.tierDerived).toBe('small')
      expect(j.tierColumn).toBe('enterprise')
    } finally {
      cleanup()
    }
  })

  it('an absent tier_floor key is 100% behavior-preserving (governed repos never auto-raised)', () => {
    const { dir, cleanup } = makeRepo('trunk-solo', 'overlays: []\n')
    try {
      const j = runJson(dir)
      expect(j.tierColumn).toBe('solo')
      expect(j.tierFloor).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('fail-closed (INV-96): an invalid tier_floor value is a config error, never silently ignored', () => {
    const { dir, cleanup } = makeRepo('trunk-solo', 'overlays: []\ntier_floor: banana\n')
    try {
      const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf-8', cwd: dir })
      expect(r.status).toBe(1) // check-doc-set.mjs's outer catch maps any thrown error to exit 1
      expect(r.stderr).toContain('tier_floor')
    } finally {
      cleanup()
    }
  })
})
