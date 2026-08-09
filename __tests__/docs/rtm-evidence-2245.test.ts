// SPDX-License-Identifier: Apache-2.0
// #2245 — RTM evidence backfill: REQ-021..REQ-025 (the 5 stack-support rows) gained
// test_ref citations (bake-tier golden-master harness + each stack's content-asserting
// generator test). Pins the presence of those citations so the backfill can't silently
// regress. Reads are lazy (inside each `it`) — file was pre-fix content before #2245.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MATRIX = resolve('docs/internal/PRODUCT/FEATURE_MATRIX.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2245 — FEATURE_MATRIX.md stack-support rows cite bake-tier evidence', () => {
  it('REQ-021 (TypeScript) cites fixture-bake.test.ts and boundaries.test.ts', () => {
    const doc = read(MATRIX)
    expect(doc).toContain(
      '| REQ-021 | TypeScript stack support |  | L1 | Partial | src/generators/boundaries.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/boundaries.test.ts |',
    )
  })

  it('REQ-022 (Java) cites fixture-bake.test.ts and archunit.test.ts', () => {
    const doc = read(MATRIX)
    expect(doc).toContain(
      '| REQ-022 | Java stack support |  | L1 | Partial | src/generators/archunit.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/archunit.test.ts |',
    )
  })

  it('REQ-023 (Python) cites fixture-bake.test.ts and playwright-python.test.ts', () => {
    const doc = read(MATRIX)
    expect(doc).toContain(
      '| REQ-023 | Python stack support |  | L2 | Partial | src/generators/playwright-python.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/playwright-python.test.ts |',
    )
  })

  it('REQ-024 (Go) cites fixture-bake.test.ts and go-boundaries.test.ts', () => {
    const doc = read(MATRIX)
    expect(doc).toContain(
      '| REQ-024 | Go stack support |  | L2 | Partial | src/generators/go-boundaries.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/go-boundaries.test.ts |',
    )
  })

  it('REQ-025 (Rust) cites fixture-bake.test.ts and rust-boundaries.test.ts', () => {
    const doc = read(MATRIX)
    expect(doc).toContain(
      '| REQ-025 | Rust stack support |  | L2 | Partial | src/generators/rust-boundaries.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/rust-boundaries.test.ts |',
    )
  })
})
