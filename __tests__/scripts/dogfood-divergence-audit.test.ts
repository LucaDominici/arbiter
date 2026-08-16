/**
 * #2275 — the divergence ledger must not carry un-audited pins.
 *
 * 44 of the 72 entries in .dogfood-divergences.json carried a verbatim boilerplate
 * reason ending "NOT individually audited/read line-by-line ... tracked for a dedicated
 * per-file audit". A pin whose reason does not explain its own diff is a whole-file skip
 * wearing a rationale, and re-dating it is how a carve-out becomes permanent by neglect.
 *
 * These are the two properties the per-file audit established, asserted so the ledger
 * cannot regress to them:
 *   1. no entry defers its own justification to a later audit (AC-1);
 *   2. every entry is EITHER permanent-by-design (no `expires`) OR carries a dated
 *      expiry tied to a named issue (AC-2) — a date pointing at nothing is the
 *      lapsed-deadline pattern the ledger doctrine bans.
 *
 * Also guards the shape the audit relies on: a non-empty reason, and a pinned diffHash
 * (the CANON-14 auto-diff contract — an entry without one would skip a file wholesale).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Divergence {
  path: string
  dest?: string
  reason: string
  expires?: string
  diffHash?: string
}

/** Override with DOGFOOD_LEDGER to check a historical or fixture ledger. */
const LEDGER = process.env.DOGFOOD_LEDGER ?? resolve('.dogfood-divergences.json')
const entries: Divergence[] = JSON.parse(readFileSync(LEDGER, 'utf-8'))

/** The marker the #2275 audit removed, in both phrasings it was written in. */
const DEFERRED_AUDIT = /NOT individually (audited|read)/i

/** A dated expiry must name the issue that will close it. */
const CITES_ISSUE = /#\d+/

describe('.dogfood-divergences.json — no un-audited pins (#2275)', () => {
  it('has entries to check (a ledger that parsed to nothing would pass vacuously)', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it('AC-1: no entry defers its own justification to a later per-file audit', () => {
    const deferred = entries.filter((e) => DEFERRED_AUDIT.test(e.reason)).map((e) => e.path)
    expect(deferred, `${deferred.length} pin(s) still un-audited`).toEqual([])
  })

  it('AC-2: every dated entry cites the issue its expiry is tied to', () => {
    const dangling = entries
      .filter((e) => e.expires !== undefined && !CITES_ISSUE.test(e.reason))
      .map((e) => e.path)
    expect(dangling, 'a dated expiry pointing at no issue is a lapsed deadline').toEqual([])
  })

  it('every entry carries a substantive reason', () => {
    const thin = entries.filter((e) => (e.reason ?? '').trim().length < 40).map((e) => e.path)
    expect(thin).toEqual([])
  })

  it('every entry pins a diffHash (CANON-14: allowlisting a file, not skipping it)', () => {
    const unpinned = entries.filter((e) => !e.diffHash).map((e) => e.path)
    expect(unpinned).toEqual([])
  })
})
