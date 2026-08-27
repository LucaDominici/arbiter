// SPDX-License-Identifier: Apache-2.0
// #2244 — RTM evidence backfill: REQ-003/004/009 gained the matrix's first
// functional-tier (fixture-functional.test.ts) citations, and REQ-045's tier was
// corrected E2E→GATE (check-self-dogfood.mjs is arbiter's own repo script, never
// generated into a target). Pins both so the backfill can't silently regress. Reads
// are lazy (inside each `it`) — file was pre-fix content before #2244.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MATRIX = resolve('docs/internal/PRODUCT/FEATURE_MATRIX.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2244 — FEATURE_MATRIX.md functional-tier citations + REQ-045 tier fix', () => {
  it('REQ-003 cites fixture-functional.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-003 | Static analysis & linting | N09,N10,N11,N12,N13,N14,N15,N16 | L2 | Partial | src/generators/quality.ts | __tests__/integration/e2e/functional/fixture-functional.test.ts |',
    )
  })

  it('REQ-004 cites fixture-functional.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-004 | Test framework wiring | N17,N18,N19,N20,N21,N22,N23 | L2 | Partial | src/generators/quality.ts | __tests__/integration/e2e/functional/fixture-functional.test.ts |',
    )
  })

  it('REQ-009 cites fixture-functional.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-009 | Gate script validation | N45,N46,N47,N48,N49,N50 | L2 | Partial | src/generators/check-all.ts | __tests__/integration/e2e/functional/fixture-functional.test.ts |',
    )
  })

  it('REQ-045 tier is corrected to GATE (was E2E)', () => {
    const doc = read(MATRIX)
    expect(doc).toContain('TIER CORRECTED E2E→GATE (#2244)')
    expect(doc).toMatch(/\| REQ-045 \|.*\|\s*GATE\s*\|\s*$/m)
  })
})
