// SPDX-License-Identifier: Apache-2.0
//
// #1744 — the dogfood template-drift check (INV-45) must run at L1, inside the anti-drift
// validator family, so self↔template drift is caught at commit time rather than push time.
//
// The assertion anchors to the RUNTIME boundary token `l1EndIdx =` — the assignment that
// snapshots the end of the L1 block and defines the slice hashed into parityContentHash
// (INV-59). Anchoring to the code construct (not the section comments) means the test moves
// with the true boundary by construction: a comment reword cannot flip it either way
// (red-team RT-01, #1744).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'scripts', 'check-all.mjs'), 'utf-8')

describe('dogfood gate level (#1744, INV-45)', () => {
  it('registers the dogfood check BEFORE the l1EndIdx capture — i.e. inside the L1 slice', () => {
    const dogfoodIdx = source.indexOf("runCheck('dogfood'")
    const boundaryIdx = source.indexOf('l1EndIdx =')
    expect(dogfoodIdx).toBeGreaterThan(0)
    expect(boundaryIdx).toBeGreaterThan(0)
    expect(dogfoodIdx).toBeLessThan(boundaryIdx)
  })

  it('registers the dogfood check exactly once (L2 runs it via the L1 block — no double run)', () => {
    const occurrences = source.split("runCheck('dogfood'").length - 1
    expect(occurrences).toBe(1)
  })
})
