// SPDX-License-Identifier: Apache-2.0
// #2520: scripts/check-nightly-freshness.mjs (INV-93) and scripts/check-monthly-freshness.mjs
// had no writer for their stamp artifacts anywhere in the repo and exited 0 vacuously when the
// artifact was absent BY DESIGN — structurally incapable of ever failing. 09-heartbeat.yml's
// assert-nightly-freshness / assert-monthly-freshness jobs already enforce the real property via
// the GitHub Actions API (and, unlike the stamp gates, fail when the workflow has never run).
// Decision: delete both stamp scripts and their check-all.mjs wiring rather than wire a writer —
// a writer alone would still leave the gate disarmed whenever the write itself failed.
//
// This is a deletion, so the regression this test guards against is a silent RE-ADDITION of a
// vacuous freshness gate: no check-all.mjs step, no catalog `enforcement` field, and no
// self-only/baseline registry entry may reference either deleted script again.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string => readFileSync(resolve(p), 'utf8')

const DELETED_SCRIPTS = [
  'scripts/check-nightly-freshness.mjs',
  'scripts/check-monthly-freshness.mjs',
]
const DELETED_BASENAMES = ['check-nightly-freshness.mjs', 'check-monthly-freshness.mjs']

describe('#2520 — nightly/monthly stamp-file freshness gates deleted (INV-93 retired, INV-82 repointed)', () => {
  it('the stamp validator scripts no longer exist on disk', () => {
    for (const p of DELETED_SCRIPTS) {
      expect(existsSync(resolve(p)), `${p} must be deleted`).toBe(false)
    }
  })

  it('check-all.mjs no longer runs either deleted script', () => {
    const checkAll = read('scripts/check-all.mjs')
    for (const basename of DELETED_BASENAMES) {
      expect(checkAll, `check-all.mjs must not reference ${basename}`).not.toContain(basename)
    }
  })

  it('catalog.ts carries no `enforcement` field pointing at either deleted script', () => {
    const catalog = read('src/invariants/catalog.ts')
    for (const basename of DELETED_BASENAMES) {
      expect(catalog, `catalog.ts must not reference ${basename}`).not.toContain(basename)
    }
  })

  it('INV-93 is retired as a tombstone (ID-STABILITY), not deleted from the catalog', () => {
    const catalog = read('src/invariants/catalog.ts')
    const idx = catalog.indexOf("id: 'INV-93'")
    expect(idx, 'INV-93 entry must still exist in the catalog').toBeGreaterThan(-1)
    const nextIdx = catalog.indexOf("id: 'INV-", idx + 1)
    const entry = catalog.slice(idx, nextIdx === -1 ? undefined : nextIdx)
    expect(entry).toContain("status: 'retired'")
    expect(entry).toContain('retiredReason')
    expect(entry).not.toContain('enforcement:')
  })

  it('INV-93 has no row in AGENTS.md (retired tombstones drop their row)', () => {
    const agents = read('AGENTS.md')
    expect(agents).not.toMatch(/\*\*INV-93:\*\*/)
  })

  it('INV-82 keeps its title and content but repoints enforcement at the heartbeat job, not the deleted stamp script', () => {
    const catalog = read('src/invariants/catalog.ts')
    const idx = catalog.indexOf("id: 'INV-82'")
    expect(idx).toBeGreaterThan(-1)
    const nextIdx = catalog.indexOf("id: 'INV-", idx + 1)
    const entry = catalog.slice(idx, nextIdx === -1 ? undefined : nextIdx)
    expect(entry).not.toContain('check-monthly-freshness.mjs')
    expect(entry).toMatch(/09-heartbeat\.yml/)
    expect(entry).toMatch(/assert-monthly-freshness/)
    expect(entry).not.toContain('status: ')

    const agents = read('AGENTS.md')
    expect(agents).toContain(
      '**INV-82:** Monthly (T5b) workflow present + heartbeat asserts ≤32d freshness',
    )
  })

  it('scripts/canon01-self-only.json no longer allowlists either deleted script (dead-entry avoidance)', () => {
    const registry = JSON.parse(read('scripts/canon01-self-only.json')) as {
      selfOnly: Array<{ path: string }>
    }
    const paths = registry.selfOnly.map((e) => e.path)
    for (const p of DELETED_SCRIPTS) {
      expect(paths, `canon01-self-only.json must drop ${p}`).not.toContain(p)
    }
  })

  it('scripts/canon01-baseline.json selfOnly count matches the shrunk registry length', () => {
    const registry = JSON.parse(read('scripts/canon01-self-only.json')) as {
      selfOnly: Array<{ path: string }>
    }
    const baseline = JSON.parse(read('scripts/canon01-baseline.json')) as { selfOnly: number }
    expect(baseline.selfOnly).toBe(registry.selfOnly.length)
  })

  it('scripts/data/script-catalog-baseline.json no longer lists either deleted script', () => {
    const baseline = JSON.parse(read('scripts/data/script-catalog-baseline.json')) as {
      files: string[]
    }
    for (const p of DELETED_SCRIPTS) {
      expect(baseline.files, `script-catalog-baseline.json must drop ${p}`).not.toContain(p)
    }
  })

  it('scripts/constraint-map.json no longer maps a prose entry to a deleted enforcer', () => {
    const map = JSON.parse(read('scripts/constraint-map.json')) as Record<
      string,
      { enforcer?: string }
    >
    for (const entry of Object.values(map)) {
      if (entry && typeof entry === 'object' && typeof entry.enforcer === 'string') {
        for (const basename of DELETED_BASENAMES) {
          expect(
            entry.enforcer,
            'constraint-map.json entry must not enforce via a deleted script',
          ).not.toBe(basename)
        }
      }
    }
  })

  it('orchestrator-coverage-allowlist.json no longer asserts check-monthly-freshness.mjs is the only freshness-shaped check-all step', () => {
    const allowlist = JSON.parse(read('scripts/data/orchestrator-coverage-allowlist.json')) as {
      allowlist: Array<{ script: string; rationale: string }>
    }
    const entry = allowlist.allowlist.find((e) => e.script === 'check-doc-freshness.mjs')
    expect(entry).toBeDefined()
    expect(entry?.rationale).not.toContain(
      'stays the only freshness-shaped gate check-all.mjs itself runs',
    )
  })

  it('the CANON-24 inversion-proof ledger is untouched — freshness gates were never on it (do not edit its ceiling)', () => {
    const registry = read('scripts/data/inversion-proof-registry.json')
    expect(registry).not.toMatch(/freshness/i)
  })
})
