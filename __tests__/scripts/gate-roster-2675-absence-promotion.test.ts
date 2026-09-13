// SPDX-License-Identifier: Apache-2.0
// #2675 — promote the 19 #2560 ABSENCE_EXEMPT candidates to the CANON-25 family: each gets
// either a real flip proof (scripts/lib/guard-flip-registry.mjs) or a dated deferral-ledger
// row (scripts/data/inversion-proof-registry.json), and moves out of ABSENCE_EXEMPT into
// ABSENCE_FAMILY_ROSTER. Membership across the three gate-roster.mjs tables is exactly one
// (enforced by deriveAbsenceFamily itself); this test additionally pins that these 19 named
// gates specifically landed in the roster with exactly one proof mechanism, not zero and not two.
import { describe, it, expect } from 'vitest'
import {
  ABSENCE_EXEMPT,
  ABSENCE_FAMILY_ROSTER,
  loadInversionRegistry,
} from '../../scripts/lib/gate-roster.mjs'
import { FLIP_REGISTRY } from '../../scripts/lib/guard-flip-registry.mjs'

// The 19 gates named in #2675 (originally #2560 ABSENCE_EXEMPT candidates).
const PROMOTED_GATES = [
  'llms.txt drift (#1721)',
  'api snapshot',
  'npm-ci drift (#1684)',
  'gold registries no-false-gap (#1413)',
  'anti-drift: suppression rationale',
  'anti-drift: suppression expiry',
  'anti-drift: pii scan config',
  'anti-drift: secret scan',
  'anti-drift: drift manifest',
  'anti-drift: workflow runners',
  'anti-drift: docker action runner safety (#1756)',
  'anti-drift: workflow docs sync',
  'anti-drift: workflow integrity',
  'anti-drift: workflow parallelism (INV-120)',
  'anti-drift: pr size gate',
  'anti-drift: unwired guards (#2159)',
  'anti-drift: validator helptext',
  'anti-drift: tier coverage',
  'examples drift (#2222)',
]

describe('#2675 — the 19 ABSENCE_EXEMPT candidates are promoted', () => {
  it('none of the 19 gates remain in ABSENCE_EXEMPT', () => {
    const stillExempt = PROMOTED_GATES.filter((name) => ABSENCE_EXEMPT[name] !== undefined)
    expect(stillExempt).toEqual([])
  })

  it('every promoted gate is declared in ABSENCE_FAMILY_ROSTER', () => {
    const missing = PROMOTED_GATES.filter((name) => ABSENCE_FAMILY_ROSTER[name] === undefined)
    expect(missing).toEqual([])
  })

  it('every promoted gate carries exactly one proof mechanism (flip proof XOR ledger row)', () => {
    const registry = loadInversionRegistry(process.cwd())
    const ledgered = new Set(registry.deferred.map((row) => row.gate))
    const problems = []
    for (const name of PROMOTED_GATES) {
      const hasFlip = FLIP_REGISTRY[name] !== undefined
      const hasLedger = ledgered.has(name)
      if (hasFlip === hasLedger) {
        problems.push(
          `${name}: hasFlip=${hasFlip} hasLedger=${hasLedger} — must be exactly one, not both/neither`,
        )
      }
    }
    expect(problems).toEqual([])
  })
})
