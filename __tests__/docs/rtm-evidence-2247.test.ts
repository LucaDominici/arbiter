// SPDX-License-Identifier: Apache-2.0
// #2247 — RTM evidence backfill: 8 artifact-only scaffold rows (REQ-012/013/034/035/
// 047/048/049/050) gained SCAFFOLD-tier test_ref citations (generator emission tests,
// some backed by the bake-tier golden master). Pins the presence of those citations so
// the backfill can't silently regress. Reads are lazy (inside each `it`) — file was
// pre-fix content before #2247.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MATRIX = resolve('docs/internal/PRODUCT/FEATURE_MATRIX.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2247 — FEATURE_MATRIX.md artifact-only scaffold rows cite emission evidence', () => {
  it('REQ-012 cites fixture-bake.test.ts and github-setup.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-012 | Git/GitHub governance | N59,N60,N61,N62 | L2 | Partial | src/generators/github-setup.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/github-setup.test.ts |',
    )
  })

  it('REQ-013 cites fixture-bake.test.ts and docs.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-013 | Documentation generation | N63,N64,N65,N66,N67,N68 | L2 | Partial | src/generators/docs.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/docs.test.ts |',
    )
  })

  it('REQ-034 cites observability.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-034 | Observability / structured logging |  | L2 | Partial | src/generators/observability.ts | __tests__/generators/observability.test.ts |',
    )
  })

  it('REQ-035 cites auth.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-035 | Auth scaffold (JWT/session) |  | L2 | Partial | src/generators/auth.ts | __tests__/generators/auth.test.ts |',
    )
  })

  it('REQ-047 cites infra.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-047 | Infra / cloud templates |  | L2 | Partial | src/generators/infra.ts | __tests__/generators/infra.test.ts |',
    )
  })

  it('REQ-048 cites fixture-bake.test.ts and stride-enforcement.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-048 | STRIDE / RACI governance |  | L2 | Partial | src/generators/stride-enforcement.ts | __tests__/integration/e2e/bake/fixture-bake.test.ts,__tests__/generators/stride-enforcement.test.ts |',
    )
  })

  it('REQ-049 cites risk-register.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-049 | Risk register |  | L3 | Partial | src/generators/risk-register.ts | __tests__/generators/risk-register.test.ts |',
    )
  })

  it('REQ-050 cites compliance.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-050 | Compliance mapping (ISO 27001 / GDPR) |  | L3 | Partial | src/generators/compliance.ts | __tests__/generators/compliance.test.ts |',
    )
  })
})
