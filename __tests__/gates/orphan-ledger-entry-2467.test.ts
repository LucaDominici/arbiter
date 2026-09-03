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
import { readFileSync } from 'node:fs'
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

  it('scripts/check-bypass-ceremony.mjs exits 0 against the real repo tree (the direct gate)', () => {
    const script = new URL('../../scripts/check-bypass-ceremony.mjs', import.meta.url).pathname
    const r = spawnSync('node', [script], { encoding: 'utf-8', timeout: 15000 })
    expect(r.stdout + r.stderr).not.toMatch(/orphan/i)
    expect(r.status).toBe(0)
  })
})
