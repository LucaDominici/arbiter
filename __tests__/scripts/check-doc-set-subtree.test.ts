// SPDX-License-Identifier: Apache-2.0
// H2 (gold-doc-capability, Tranche 2) — subtree arc42/C4/ADR recognition.
//
// Before this tranche, `check-doc-set.mjs` was path-blind: it only recognized arc42/C4/ADR
// docs living FLAT under docs/architecture/ or docs/ADR|adr/. A real, conformant doc-set
// nested two-plus directories deep — a governed project's `docs/architecture/budget/`
// (arc42.md + c4-model.md + a docs/architecture/budget/adr/ subtree with 9 ADR-NNN_*.md
// records) — was invisible to it and reported MISSING.
//
// This fixture reproduces that real subtree structure (dogfood-proof was additionally run
// manually against a real external governed repo with this exact layout — see the task
// report — but the fixture below is the repeatable, CI-safe regression guard).
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
    applies: always
  - path: docs/architecture/ARCHITECTURE.md
    tier: mandatory
    applies: always
    accept_any:
      [
        'docs/architecture/ARCHITECTURE.md',
        'docs/architecture/arc42.md',
        'docs/architecture/**/arc42.md',
        'docs/**/c4-model.md',
      ]
  - path: docs/ADR
    tier: mandatory
    applies: always
    glob: 'docs/ADR/[0-9]*.md'
    adr: true
    accept_any: ['docs/ADR/[0-9]*.md', 'docs/adr/[0-9]*.md', 'docs/**/adr/ADR-*.md']
`

function makeSubtreeFixtureRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'doc-set-subtree-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), MANIFEST)
  writeFileSync(join(dir, 'README.md'), '# r')
  // Reproduce a real-world docs/architecture/budget/ subtree layout.
  const budget = join(dir, 'docs', 'architecture', 'budget')
  mkdirSync(join(budget, 'adr'), { recursive: true })
  writeFileSync(join(budget, 'arc42.md'), '# arc42\n\nSection 1...\n')
  writeFileSync(join(budget, 'c4-model.md'), '# C4 model\n\nContext diagram...\n')
  for (const n of ['006', '007', '008']) {
    writeFileSync(join(budget, 'adr', `ADR-${n}_decision.md`), `# ADR-${n}\n`)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function runStrict(dir: string): { status: number; stdout: string } {
  const r = spawnSync('node', [SCRIPT, '--strict'], { encoding: 'utf-8', cwd: dir })
  return { status: r.status ?? 1, stdout: r.stdout ?? '' }
}

function runJson(dir: string): {
  totals: { missingMandatory: number }
  missingMandatory: string[]
} {
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf-8', cwd: dir })
  return JSON.parse(r.stdout)
}

describe('check-doc-set: subtree arc42/C4/ADR recognition (H2, gold-doc-capability T2)', () => {
  it('RED (pre-T2 accept_any): flat-only architecture accept_any does NOT see budget/arc42.md', () => {
    // Simulates the pre-Tranche-2 manifest (no `**` entries) against the identical fixture —
    // this is exactly what shipped before T2 and is exactly why a project with this layout was reported as missing
    // its architecture doc (§6.3 of docs/design/gold-doc-capability.md). The ADR check keeps
    // `adr: true` here too (unrelated to this assertion) — see the note below on why the ADR
    // subtree fix, unlike this one, has no manifest-level on/off switch to simulate against.
    const { dir, cleanup } = makeSubtreeFixtureRepo()
    try {
      const flatOnlyManifest = `version: '1.0.0'
profile: tooling
checks:
  - path: README.md
    tier: mandatory
    applies: always
  - path: docs/architecture/ARCHITECTURE.md
    tier: mandatory
    applies: always
    accept_any: ['docs/architecture/ARCHITECTURE.md', 'docs/architecture/arc42.md']
`
      writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), flatOnlyManifest)
      const j = runJson(dir)
      expect(j.totals.missingMandatory).toBe(1)
      expect(j.missingMandatory).toEqual(['docs/architecture/ARCHITECTURE.md'])
    } finally {
      cleanup()
    }
  })

  // NOTE on the ADR side of H2: adrPresentAnywhere() is an unconditional structural fix keyed
  // only off `adr: true` (no manifest field toggles it off) — there is no "flat-only" manifest
  // left in the current codebase that reproduces the pre-T2 ADR-recognition gap, so it cannot be
  // red-pathed via a fixture against the CURRENT script (there is nothing left to disable). The
  // red/green comparison for the ADR side was verified directly against a real external governed repo with this layout, using
  // the pre-T2 script snapshot (git rev 40062674) — see the task report for the exact JSON
  // before/after. That is the authoritative red-path evidence for the ADR half of H2.

  it('GREEN: the widened `**` accept_any/adr-anywhere manifest recognizes the same budget/ subtree', () => {
    const { dir, cleanup } = makeSubtreeFixtureRepo()
    try {
      const j = runJson(dir)
      expect(j.totals.missingMandatory).toBe(0)
      const strict = runStrict(dir)
      expect(strict.status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('arc42.md alone (no c4-model.md) still satisfies the architecture check via accept_any', () => {
    const { dir, cleanup } = makeSubtreeFixtureRepo()
    try {
      rmSync(join(dir, 'docs', 'architecture', 'budget', 'c4-model.md'))
      const j = runJson(dir)
      expect(j.missingMandatory).not.toContain('docs/architecture/ARCHITECTURE.md')
    } finally {
      cleanup()
    }
  })

  it('ADR recognition is case-insensitive on the parent dir name (lowercase adr/, uppercase ADR-NNN filenames)', () => {
    const { dir, cleanup } = makeSubtreeFixtureRepo()
    try {
      rmSync(join(dir, 'docs', 'architecture', 'budget', 'adr'), { recursive: true })
      // Only a top-level, differently-cased ADR dir remains.
      mkdirSync(join(dir, 'docs', 'ADR'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'ADR', 'ADR-001-foo.md'), '# adr')
      const j = runJson(dir)
      expect(j.missingMandatory).not.toContain('docs/ADR')
    } finally {
      cleanup()
    }
  })

  it('a non-`**` glob check (docs/api/*) is unaffected by the recursive-walk upgrade (no regression)', () => {
    const { dir, cleanup } = makeSubtreeFixtureRepo()
    try {
      const manifestWithFlatGlob = MANIFEST.replace(
        'checks:\n',
        `checks:\n  - path: docs/api\n    tier: conditional\n    applies: has-api\n    glob: 'docs/api/*'\n`,
      )
      writeFileSync(join(dir, 'standards', 'gold-doc-set.yml'), manifestWithFlatGlob)
      mkdirSync(join(dir, '.arbiter'), { recursive: true })
      writeFileSync(join(dir, 'standards', 'doc-profile'), 'overlays:\n  - has-api\n')
      mkdirSync(join(dir, 'docs', 'api'), { recursive: true })
      writeFileSync(join(dir, 'docs', 'api', 'openapi.yaml'), 'openapi: 3.0.0\n')
      const j = runJson(dir)
      expect(j.totals.missingMandatory).toBe(0) // docs/api conditional gap is never mandatory anyway
      const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf-8', cwd: dir })
      const full = JSON.parse(r.stdout) as { totals: { na: number } }
      expect(full.totals.na).toBe(0) // has-api overlay on, docs/api/* present ⇒ not n/a
    } finally {
      cleanup()
    }
  })
})
