// SPDX-License-Identifier: Apache-2.0
// #2467 AC-1 — an advisory-ledger.json entry whose check has been promoted from warn to hard
// rots silently: check-bypass-ceremony.mjs validated ledger entries only for checks that were
// still live advisory sites (runWarnCheck in check-all.mjs, or a class:'gh-audit' guard), never
// the reverse — that every ledger entry still names one of those sites. This test asserts the
// RELATIONSHIP, not any one check's name: no ledger entry may describe a check that check-all.mjs
// now runs as a hard runCheck, and every entry must resolve to a live advisory site. The one
// promoted check named in the issue (#2177 review completion) is covered because it IS one of
// these — never hardcoded here — so the next promotion is caught the same way.
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const CHECK_ALL = 'scripts/check-all.mjs'
const GUARD_ROSTER = 'scripts/lib/anti-fake-green-guards.mjs'
const LEDGER = 'scripts/data/advisory-ledger.json'

interface LedgerEntry {
  check: string
}

function ledgerEntries(): LedgerEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(LEDGER, 'utf-8'))
  const entries = (parsed as { entries?: unknown }).entries
  expect(Array.isArray(entries)).toBe(true)
  // Non-emptiness is load-bearing: the two relationship tests below are `for` loops over this,
  // so an emptied ledger would satisfy them by construction — asserting nothing while passing.
  expect((entries as LedgerEntry[]).length).toBeGreaterThan(0)
  return entries as LedgerEntry[]
}

function warnCheckNames(body: string): Set<string> {
  return new Set([...body.matchAll(/runWarnCheck\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))
}

function hardCheckNames(body: string): Set<string> {
  return new Set([...body.matchAll(/runCheck\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))
}

function ghAuditGuardNames(body: string): Set<string> {
  const names: string[] = []
  for (const m of body.matchAll(/\{[^{}]*\}/g)) {
    if (!/class:\s*['"]gh-audit['"]/.test(m[0])) continue
    const name = /name:\s*['"]([^'"]+)['"]/.exec(m[0])
    if (name !== null) names.push(name[1])
  }
  return new Set(names)
}

describe('#2467 AC-1 — no orphan advisory-ledger entries in the real tree', () => {
  const checkAllBody = readFileSync(CHECK_ALL, 'utf-8')
  const guardRosterBody = readFileSync(GUARD_ROSTER, 'utf-8')
  const advisoryNames = new Set([
    ...warnCheckNames(checkAllBody),
    ...ghAuditGuardNames(guardRosterBody),
  ])
  const hardNames = hardCheckNames(checkAllBody)

  it('every ledger entry names a check that is still an advisory site (assert the relationship, not a name)', () => {
    for (const entry of ledgerEntries()) {
      expect(
        advisoryNames.has(entry.check),
        `ledger entry "${entry.check}" is not a live advisory site (runWarnCheck or gh-audit guard) — orphan, prune it`,
      ).toBe(true)
    }
  })

  it('no ledger entry names a check that check-all.mjs now runs as a hard runCheck', () => {
    for (const entry of ledgerEntries()) {
      expect(
        hardNames.has(entry.check),
        `ledger entry "${entry.check}" has been promoted to a hard runCheck but its advisory-ledger row was never pruned (#2467)`,
      ).toBe(false)
    }
  })

  // A green-stays-green assertion on the real tree cannot fail when the detector is DELETED: the
  // script exits 0 and prints no "orphan" either way. So the AC is pinned by a mutation control —
  // plant the exact row #2467 pruned back into a fixture tree and require the gate to reject it.
  it('re-planting the pruned orphan row makes the gate reject it (mutation control)', () => {
    const script = new URL('../../scripts/check-bypass-ceremony.mjs', import.meta.url).pathname
    const dir = mkdtempSync(join(tmpdir(), 'orphan-ledger-2467-'))
    try {
      mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
      mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
      copyFileSync(CHECK_ALL, join(dir, CHECK_ALL))
      copyFileSync(GUARD_ROSTER, join(dir, GUARD_ROSTER))

      // `review completion (#2177)` is wired in check-all.mjs as a HARD runCheck (promoted by
      // #2435) and never as runWarnCheck — which is exactly what makes a ledger row for it an
      // orphan. Re-inserting it is the inversion of the prune this change shipped.
      const ledger = JSON.parse(readFileSync(LEDGER, 'utf-8')) as { entries: LedgerEntry[] }
      ledger.entries.push({
        check: 'review completion (#2177)',
        since: '2026-08-02',
        promoteBy: '2099-01-01',
        rationale:
          'synthetic re-insertion of the row #2467 pruned, to prove the detector rejects it rather than merely that the tree is currently clean',
      } as LedgerEntry)
      writeFileSync(join(dir, LEDGER), JSON.stringify(ledger, null, 2))

      const r = spawnSync('node', [script, '--root', dir], { encoding: 'utf-8', timeout: 15000 })
      const out = r.stdout + r.stderr
      expect(out, 'the re-planted orphan must be named in the output').toMatch(/orphan/i)
      expect(out).toContain('review completion (#2177)')
      expect(r.status, 'an orphan ledger row must fail the gate').toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the same fixture WITHOUT the planted row passes — so the failure above is the row, not the fixture', () => {
    const script = new URL('../../scripts/check-bypass-ceremony.mjs', import.meta.url).pathname
    const dir = mkdtempSync(join(tmpdir(), 'orphan-ledger-2467-clean-'))
    try {
      mkdirSync(join(dir, 'scripts', 'data'), { recursive: true })
      mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true })
      copyFileSync(CHECK_ALL, join(dir, CHECK_ALL))
      copyFileSync(GUARD_ROSTER, join(dir, GUARD_ROSTER))
      copyFileSync(LEDGER, join(dir, LEDGER))

      const r = spawnSync('node', [script, '--root', dir], { encoding: 'utf-8', timeout: 15000 })
      expect(r.stdout + r.stderr).not.toMatch(/orphan/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
