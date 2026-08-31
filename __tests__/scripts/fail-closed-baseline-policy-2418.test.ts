// #2418 — the INV-96 fail-closed baseline is dated, owned and ratcheting.
//
// The baseline used to be a bare list of 184 path strings: no date, no owner, no expiry,
// no way to tell a two-day-old exemption from a fifteen-month-old one, and no mechanism
// that ever forced one to be repaid. It also grandfathered `scripts/check-all.mjs` and the
// meta-check family — the gates whose own subject is arbiter's enforcement machinery — so
// the audit that enforces fail-closed doctrine exempted the auditors from it.
//
// These tests pin the three properties that make the ledger decay instead of accumulate:
// every row is dated + owned + bounded, the auditors are OUT of the ledger, and the
// governance text names the live size and the decay rule.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8')

type Entry = {
  file: string
  since: string
  owner: string
  expires?: string
  permanent?: string
}
type Baseline = { schema: string; generated_at: string | null; files: Entry[] }

const baseline = JSON.parse(read('scripts/data/fail-closed-baseline.json')) as Baseline

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_WINDOW_DAYS = 90
const DAY_MS = 86_400_000

/** Gates whose subject is arbiter's own enforcement machinery — the meta-check family. */
const META_CHECKS = [
  'scripts/check-all.mjs',
  'scripts/check-adr-enforcement.mjs',
  'scripts/check-agent-dispatch.mjs',
  'scripts/check-canon-references.mjs',
  'scripts/check-catalog-agents-parity.mjs',
  'scripts/check-ci-tiers.mjs',
  'scripts/check-emission-coherence.mjs',
  'scripts/check-exit-code-contract.mjs',
  'scripts/check-gold-registries.mjs',
  'scripts/check-hook-contracts.mjs',
  'scripts/check-id-stability.mjs',
  'scripts/check-inline-suppressions.mjs',
  'scripts/check-inv-enforcement-wired.mjs',
  'scripts/check-local-ci-parity.mjs',
  'scripts/check-orchestrator-coverage.mjs',
  'scripts/check-self-dogfood.mjs',
  'scripts/check-suppression-expiry.mjs',
  'scripts/check-tdd-evidence.mjs',
  'scripts/check-tool-claims.mjs',
]

describe('#2418 AC-1 — every baseline row is dated, owned and bounded', () => {
  it('uses the v2 schema (bare path strings can no longer be expressed)', () => {
    expect(baseline.schema).toBe('arbiter-fail-closed-baseline-v2')
    expect(baseline.files.every((e) => typeof e === 'object' && e !== null)).toBe(true)
  })

  it('carries `since` + `owner` on every row', () => {
    const bad = baseline.files.filter(
      (e) => !ISO_DATE.test(e.since ?? '') || typeof e.owner !== 'string' || e.owner.trim() === '',
    )
    expect(bad.map((e) => e.file)).toEqual([])
  })

  it('carries either an `expires` date or a permanent rationale — never both, never neither', () => {
    const bad = baseline.files.filter((e) => {
      const hasExpiry = typeof e.expires === 'string'
      const hasRationale = typeof e.permanent === 'string' && e.permanent.trim().length >= 24
      return hasExpiry === hasRationale
    })
    expect(bad.map((e) => e.file)).toEqual([])
  })

  it('holds no expired row and no window longer than 90 days', () => {
    const today = Date.now()
    const expired: string[] = []
    const overlong: string[] = []
    for (const e of baseline.files) {
      if (typeof e.expires !== 'string') continue
      expect(ISO_DATE.test(e.expires), `${e.file}: malformed expires`).toBe(true)
      const days = (Date.parse(`${e.expires}T00:00:00Z`) - today) / DAY_MS
      if (days < 0) expired.push(e.file)
      if (days > MAX_WINDOW_DAYS) overlong.push(e.file)
    }
    expect(expired).toEqual([])
    expect(overlong).toEqual([])
  })

  it('lists no duplicate and no dead path', () => {
    const paths = baseline.files.map((e) => e.file)
    expect(paths.length).toBe(new Set(paths).size)
    expect(paths.filter((p) => !existsSync(resolve(ROOT, p)))).toEqual([])
  })
})

describe('#2418 AC-2 — the auditors are not exempt from the audit', () => {
  it.each(META_CHECKS)('%s is no longer grandfathered', (rel) => {
    expect(baseline.files.map((e) => e.file)).not.toContain(rel)
  })
})

describe('#2418 AC-3 — the governance text names the size and the decay rule', () => {
  const agents = read('AGENTS.md')
  const section = agents.slice(agents.indexOf('## Fail-Closed Audit (INV-96)'))
  const inv96 = section.slice(0, section.indexOf('\n## '))

  it('names the live baseline size', () => {
    const m = inv96.match(/grandfathers exactly (\d+) file/)
    expect(m, 'AGENTS.md INV-96 must state "grandfathers exactly N file(s)"').not.toBeNull()
    expect(Number(m?.[1])).toBe(baseline.files.length)
  })

  it('states the decay rule: 90-day cap, expiry fails the gate, list may only shrink', () => {
    expect(inv96).toContain('90 days')
    expect(inv96.toLowerCase()).toContain('expired')
    expect(inv96.toLowerCase()).toContain('only shrink')
  })

  it('tightens the canon-01 divergence ratchet to the observed count', () => {
    const canon = JSON.parse(read('scripts/canon01-baseline.json')) as { divergences: number }
    const ledger = JSON.parse(read('.dogfood-divergences.json')) as unknown[]
    expect(canon.divergences).toBe(ledger.length)
    expect(canon.divergences).toBe(72)
  })
})
