// SPDX-License-Identifier: Apache-2.0
// #2419 AC-2/AC-3 — the police of advisory-forever gates was itself an advisory gate, and only in
// the L2 partition, so an expired promoteBy could never fail anything a commit had to pass.
// AC-2 makes it a hard L1 check. AC-3 makes the advisory labels in AGENTS.md carry a date that the
// (now hard) ledger detector can actually expire.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SELF_CHECK_ALL = 'scripts/check-all.mjs'
const LEDGER = 'scripts/data/advisory-ledger.json'
const PARITY = 'scripts/check-local-ci-parity.mjs'
const AGENTS = 'AGENTS.md'
const CHECK_NAME = 'bypass ceremony (E4 #1949)'

interface LedgerEntry {
  check: string
  promoteBy?: string
  permanent?: boolean
  rationale?: string
}

function ledgerEntries(): LedgerEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(LEDGER, 'utf-8'))
  const entries = (parsed as { entries?: unknown }).entries
  expect(Array.isArray(entries)).toBe(true)
  return entries as LedgerEntry[]
}

function promoteByOf(check: string): string {
  const entry = ledgerEntries().find((e) => e.check === check)
  expect(entry, `no advisory-ledger entry for "${check}"`).toBeDefined()
  const date = (entry as LedgerEntry).promoteBy
  expect(date, `advisory-ledger entry "${check}" has no promoteBy`).toBeTruthy()
  return date as string
}

describe('#2419 AC-2 — bypass-ceremony is a hard check that runs at L1', () => {
  it("arbiter's own check-all.mjs runs it as a hard check, not a warn", () => {
    const line = readFileSync(SELF_CHECK_ALL, 'utf-8')
      .split('\n')
      .find((l) => l.includes("'scripts/check-bypass-ceremony.mjs'"))
    expect(line, 'check-bypass-ceremony.mjs is not wired into scripts/check-all.mjs').toBeDefined()
    expect(line as string).toContain('runCheck(')
    expect(line as string).not.toContain('runWarnCheck(')
  })

  it('the call site sits in the L1 partition, ahead of the `subcommand !== check` boundary', () => {
    const source = readFileSync(SELF_CHECK_ALL, 'utf-8')
    const site = source.indexOf("'scripts/check-bypass-ceremony.mjs'")
    const l2Boundary = source.indexOf("if (subcommand !== 'check')")
    expect(site).toBeGreaterThan(-1)
    expect(l2Boundary).toBeGreaterThan(-1)
    expect(site).toBeLessThan(l2Boundary)
  })

  it('the self-referential ledger entry is pruned — it is no longer a runWarnCheck site', () => {
    expect(ledgerEntries().map((e) => e.check)).not.toContain(CHECK_NAME)
  })

  it('the promoted check has a CI_COVERAGE entry so check-level parity stays green', () => {
    expect(readFileSync(PARITY, 'utf-8')).toContain(`['${CHECK_NAME}'`)
  })
})

describe('#2419 AC-3 — advisory guards are labelled advisory WITH their promotion date', () => {
  it('AGENTS.md marks the INV-70 reuse survey advisory, citing the ledger promoteBy verbatim', () => {
    const agents = readFileSync(AGENTS, 'utf-8')
    const line = agents.split('\n').find((l) => l.includes('**INV-70:**'))
    expect(line, 'no INV-70 line in AGENTS.md').toBeDefined()
    expect(line as string).toMatch(/advisory/i)
    expect(line as string).toContain(promoteByOf('reuse survey (INV-70)'))
  })

  it('AGENTS.md marks the gh-audit anti-fake-green guards advisory with their promotion date', () => {
    const agents = readFileSync(AGENTS, 'utf-8')
    const line = agents.split('\n').find((l) => l.includes('anti-fake-green gh-audit guards'))
    expect(line, 'no gh-audit guards enforcement claim in AGENTS.md').toBeDefined()
    expect(line as string).toMatch(/advisory/i)
    expect(line as string).toContain(promoteByOf('min-review-time'))
    expect(line as string).toContain(promoteByOf('ownership-distribution'))
  })

  it('every gh-audit guard in the roster has a dated ledger entry (no silent advisory-forever)', () => {
    const roster = readFileSync('scripts/lib/anti-fake-green-guards.mjs', 'utf-8')
    const ghAudit = [...roster.matchAll(/\{[^{}]*\}/g)]
      .map((m) => m[0])
      .filter((o) => /class:\s*'gh-audit'/.test(o))
      .map((o) => /name:\s*'([^']+)'/.exec(o)?.[1])
      .filter((n): n is string => typeof n === 'string')
    expect(ghAudit.length).toBeGreaterThan(0)
    const ledgered = new Set(ledgerEntries().map((e) => e.check))
    for (const name of ghAudit) expect(ledgered).toContain(name)
  })
})
