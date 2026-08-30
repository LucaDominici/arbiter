// SPDX-License-Identifier: Apache-2.0
// #2412 (2026-08-29 enforcement audit) — ten SYSTEM/ADR/architecture corrections:
// ADR-023 frontmatter disagreed with its own body ("Accepted" vs the documented
// supersession), INV-73/INV-30 catalog.ts enforcement strings drifted from the real
// gate wiring, ADR-007's title/body/code label counts disagreed (15 vs 14 vs 11+3),
// check-all.mjs hand-counted its own hard-check totals (126/151, both stale),
// check-workflow-runners.mjs cited a foreign INV-13 (dependency CVEs) for runner
// labels instead of its own INV-89, scripts/data/fail-closed-baseline.json carried
// nonexistent-file entries, and TESTING.md's action-SHA table/workflow attribution/
// RESULTS claim/exit-code sample were all stale. Each assertion below pins one fix so
// the class of drift cannot silently regress.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text)
  if (match === null) return {}
  const fm: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    fm[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
  return fm
}

function sliceCatalogEntry(catalogSrc: string, id: string, nextId: string): string {
  const start = catalogSrc.indexOf(`id: '${id}'`)
  const end = catalogSrc.indexOf(`id: '${nextId}'`)
  expect(start, `${id} not found in catalog.ts`).toBeGreaterThan(-1)
  expect(end, `${nextId} not found in catalog.ts`).toBeGreaterThan(-1)
  return catalogSrc.slice(start, end)
}

// ─── ADR-023: frontmatter status ────────────────────────────────────────────────

describe('#2412 — ADR-023 frontmatter agrees with its own documented supersession', () => {
  const path = 'docs/internal/ADR/023-self-hosted-ci-runner.md'

  it('frontmatter status is superseded, not active/Accepted', () => {
    const fm = parseFrontmatter(read(path))
    expect(fm.status).toBe('superseded')
  })

  it('body no longer claims a contradictory "partially superseded ... intact" status line', () => {
    expect(read(path)).not.toMatch(/partially superseded/i)
  })
})

// ─── INV-73: minPresent + AGENTS.md migrationStatus ─────────────────────────────

describe('#2412 — INV-73 minPresent matches the true 8-file canonical contract', () => {
  it('catalog.ts INV-73 minPresent is 8', () => {
    const catalogSrc = read('src/invariants/catalog.ts')
    const entry = sliceCatalogEntry(catalogSrc, 'INV-73', 'INV-74')
    expect(entry).toMatch(/minPresent:\s*8/)
  })

  it('AGENTS.md no longer cites a migrationStatus field for INV-73', () => {
    expect(read('AGENTS.md')).not.toContain('migrationStatus')
  })
})

// ─── INV-30: enforcement string ─────────────────────────────────────────────────

describe('#2412 — INV-30 enforcement string points at the real gate (05-release.yml), not removed pitest-in-check-all', () => {
  it('catalog.ts INV-30 enforcement cites 05-release.yml mutation-blocking', () => {
    const catalogSrc = read('src/invariants/catalog.ts')
    const entry = sliceCatalogEntry(catalogSrc, 'INV-30', 'INV-31')
    expect(entry).toMatch(/05-release\.yml/)
    expect(entry).toMatch(/mutation-blocking/)
    expect(entry).not.toContain('pitest in check-all.mjs')
  })
})

// ─── ADR-007: label count agreement ─────────────────────────────────────────────

describe('#2412 — ADR-007 title/body agree with the real 14-label (11+3) count', () => {
  const path = 'docs/internal/ADR/007-standard-labels.md'

  it('no longer claims 15 standard labels', () => {
    const text = read(path)
    expect(text).not.toContain('15 standard labels')
    expect(text).not.toMatch(/15 is deliberately minimal/)
  })

  it('website/reference/cli.md agrees (14, not 15)', () => {
    expect(read('website/reference/cli.md')).not.toContain('15 standard labels')
  })
})

// ─── check-all.mjs: hand-counted header drift ───────────────────────────────────

function deriveHardCheckCount(source: string, startMarker: string, endMarker: string): number {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
  expect(end, `marker not found: ${endMarker}`).toBeGreaterThan(-1)
  const section = source.slice(start, end)
  return (section.match(/\brunCheck\(|\brunToolCheck\(/g) ?? []).length
}

describe('#2412 — check-all.mjs header hard-check counts do not silently drift', () => {
  it('any hand-stated hard-check count in the header matches a freshly derived count (or the header states none)', () => {
    const text = read('scripts/check-all.mjs')
    const header = text.slice(0, text.indexOf('\nimport '))
    expect(header).not.toContain('126 hard checks')
    expect(header).not.toContain('151 hard checks')

    const claims = [...header.matchAll(/(\d+)\s+hard checks?/g)].map((m) => Number(m[1]))
    if (claims.length === 0) return // preferred fix: header no longer hand-states a count

    const checkCount = deriveHardCheckCount(
      text,
      '// ─── check: T1 fast checks',
      '// ─── gate: T1+T2 extended checks',
    )
    const gateCount = deriveHardCheckCount(text, '// ─── check: T1 fast checks', '// ─── Summary')
    expect(claims).toContain(checkCount)
    expect(claims).toContain(gateCount)
  })
})

// ─── check-workflow-runners.mjs: foreign INV-13 citation ────────────────────────

describe('#2412 — check-workflow-runners.mjs cites its own INV-89, not foreign INV-13', () => {
  it('no INV-13 citation remains', () => {
    expect(read('scripts/check-workflow-runners.mjs')).not.toContain('INV-13')
  })

  it('still self-identifies as INV-89', () => {
    expect(read('scripts/check-workflow-runners.mjs')).toContain('INV-89')
  })
})

// ─── fail-closed-baseline.json: no dead paths ───────────────────────────────────

describe('#2412 — fail-closed-baseline.json lists no deleted paths', () => {
  it('every grandfathered path still exists on disk', () => {
    const baseline = JSON.parse(read('scripts/data/fail-closed-baseline.json')) as {
      files: string[]
    }
    const dead = baseline.files.filter((p) => !existsSync(resolve(p)))
    expect(dead).toEqual([])
  })
})

// ─── TESTING.md: stale SHAs, misattributed workflow, stale claims ───────────────

describe('#2412 — TESTING.md action-SHA claims match the real workflow pins (or the table is gone)', () => {
  it('no hardcoded SHA table entries diverge from .github/workflows/_nightly.yml', () => {
    const text = read('docs/internal/METHOD/TESTING.md')
    // The old (stale) canonical-SHAs table pinned this exact checkout SHA — must be gone.
    expect(text).not.toContain('48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e')
    const shaRefs = [...text.matchAll(/`([\w./-]+)@([0-9a-f]{40})`/g)]
    if (shaRefs.length === 0) return // preferred fix: table removed, pointer to check-action-pins.mjs
    const nightly = read('.github/workflows/_nightly.yml')
    for (const [, action, sha] of shaRefs) {
      expect(nightly, `${action}@${sha} not found in _nightly.yml`).toContain(`${action}@${sha}`)
    }
  })

  it('bake-e2e-native is attributed to _nightly.yml, not 06-nightly.yml', () => {
    const text = read('docs/internal/METHOD/TESTING.md')
    expect(text).not.toMatch(/bake-e2e-native[^\n]*`06-nightly\.yml`/)
    expect(text).not.toContain(
      'mirror the same step into `src/templates/github/workflows/06-nightly.yml.ejs`',
    )
  })

  it('Known Posture no longer claims the RESULTS array is missing fuzz/soak (it is present)', () => {
    const text = read('docs/internal/METHOD/TESTING.md')
    expect(text).not.toMatch(/fuzz.*and.*soak-e2e.*are in `needs:` but NOT in the `RESULTS/)
  })

  it('Phase-C sample output shows exit 2, not exit 0, matching the exit-code contract table', () => {
    const text = read('docs/internal/METHOD/TESTING.md')
    expect(text).not.toMatch(/PASS\s+C \(error\)\s+.*exit 0\s+\(expected 0\)/)
    expect(text).toMatch(/PASS\s+C \(error\)\s+.*exit 2\s+\(expected 2\)/)
  })
})

// ─── CI-TIER-MODEL.md: which repo/track the tables describe ────────────────────

describe('#2412 — CI-TIER-MODEL.md states which repo/track its tables describe', () => {
  it('mentions Track A / Track B (or self / generated-target) explicitly', () => {
    const text = read('docs/internal/SYSTEM/CI-TIER-MODEL.md')
    expect(text).toMatch(/Track A|Track B/)
  })
})

// ─── ARCHITECTURE.md: gate model no longer hand-tabulates a stale L1-L3 shape ───

describe('#2412 — ARCHITECTURE.md gate section points at check-all.mjs subcommands, not a stale L1-L3 table', () => {
  it('no longer claims L1 is "Format + lint + unit tests" only (current L1 includes more)', () => {
    const text = read('docs/internal/architecture/ARCHITECTURE.md')
    expect(text).not.toMatch(/\|\s*L1\s*\|\s*Format \+ lint \+ unit tests\s*\|/)
  })

  it('mentions L4', () => {
    expect(read('docs/internal/architecture/ARCHITECTURE.md')).toMatch(/L4/)
  })
})

// ─── doc-gate-allowlist.json: #2412-owned entry removed once its fix lands ─────

describe('#2412 — ADR-051 dead related: path fixed, allowlist entry removed', () => {
  it('ADR-051 related: no longer cites the nonexistent WORKFLOW-MODEL.md', () => {
    const text = read('docs/internal/ADR/051-collaboration-mode-workflow-axis.md')
    expect(text).not.toContain('docs/SYSTEM/WORKFLOW-MODEL.md')
  })

  it('doc-gate-allowlist.json no longer carries a #2412 entry', () => {
    const allowlist = JSON.parse(read('scripts/data/doc-gate-allowlist.json')) as {
      entries: Array<{ issue: string }>
    }
    expect(allowlist.entries.some((e) => e.issue === '#2412')).toBe(false)
  })
})
