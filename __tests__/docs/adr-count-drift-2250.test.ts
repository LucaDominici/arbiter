// SPDX-License-Identifier: Apache-2.0
// #2250 (wave-4 docs) — found during #2249's current-state verification: adr-index.md:15 and
// architecture/README.md:29 both hand-state "106 Architecture Decision Records" while the
// verified actual count lives in docs/internal/ADR/ itself and in DECISIONS.md's generated
// digest — never hand-copied into prose. Same "hand-copied count drifts"
// pattern #2239 fixes in arc42/c4/CANON, but these two files are outside #2239's scope.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string): string => readFileSync(resolve(p), 'utf-8')
const ADR_INDEX = 'docs/architecture/adr-index.md'
const ARCH_README = 'docs/architecture/README.md'

describe('#2250 — adr-index.md / README.md stale ADR count fixed', () => {
  it('adr-index.md no longer hand-states the stale "106" count', () => {
    expect(read(ADR_INDEX)).not.toContain('106 Architecture Decision Records')
  })

  it('architecture/README.md no longer hand-states the stale "106" count', () => {
    expect(read(ARCH_README)).not.toContain('All 106 ADRs')
  })
})
