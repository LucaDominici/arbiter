// SPDX-License-Identifier: Apache-2.0
// #2246 — RTM evidence backfill: 10 arbiter-internal rows (REQ-017/018/019/020/030/
// 039/040/042/043/044) gained GATE-tier test_ref citations. Pins the presence of those
// citations so the backfill can't silently regress. Reads are lazy (inside each `it`) —
// file was pre-fix content before #2246.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MATRIX = resolve('docs/internal/PRODUCT/FEATURE_MATRIX.md')
const read = (p: string): string => readFileSync(resolve(p), 'utf-8')

describe('#2246 — FEATURE_MATRIX.md arbiter-internal rows cite GATE-tier evidence', () => {
  it('REQ-017 cites help-surface.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-017 | CLI command surface (count: see src/cli.ts `.command(...)` registrations) |  | L1 | Partial | src/cli.ts | __tests__/behavioral/help-surface.test.ts |',
    )
  })

  it('REQ-018 cites registry.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-018 | Generator scaffold (count: see .bloat-baseline.json → buckets.generators / src/generators/registry.ts) |  | L1 | Partial | src/generators/registry.ts | __tests__/generators/registry.test.ts |',
    )
  })

  it('REQ-019 cites agents-md-parity.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-019 | Invariant catalog & AGENTS.md parity (count: see src/invariants/catalog.ts) |  | L1 | Partial | src/invariants/catalog.ts | __tests__/governance/agents-md-parity.test.ts |',
    )
  })

  it('REQ-020 cites invariants/catalog.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-020 | Governance level dial (L1–L4) |  | L1 | Partial | src/wizard/types.ts | __tests__/invariants/catalog.test.ts |',
    )
  })

  it('REQ-030 cites check-adr-index.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-030 | ADR SSOT gate |  | L2 | Partial | scripts/check-adr-index.mjs | __tests__/scripts/check-adr-index.test.ts |',
    )
  })

  it('REQ-039 cites gen-ssot-core.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-039 | SSOT core set / knowledge map |  | L2 | Partial | scripts/gen-ssot-core.mjs | __tests__/scripts/gen-ssot-core.test.ts |',
    )
  })

  it('REQ-040 cites worktree.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-040 | Worktree / task lifecycle |  | L1 | Partial | src/commands/worktree.ts | __tests__/commands/worktree.test.ts |',
    )
  })

  it('REQ-042 cites doctor.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-042 | Doctor health check |  | L1 | Partial | src/commands/doctor.ts | __tests__/commands/doctor.test.ts |',
    )
  })

  it('REQ-043 cites task.test.ts and changeset-version.test.ts', () => {
    expect(read(MATRIX)).toContain(
      '| REQ-043 | Changeset / release tooling |  | L1 | Partial | src/commands/task.ts | __tests__/commands/task.test.ts,__tests__/scripts/changeset-version.test.ts |',
    )
  })

  it('REQ-044 cites check-plugin-api-stability.test.ts and flags the code_ref finding', () => {
    const doc = read(MATRIX)
    expect(doc).toContain(
      '| REQ-044 | Plugin system |  | L2 | Partial | src/commands/plugin.ts | __tests__/scripts/check-plugin-api-stability.test.ts |',
    )
    expect(doc).toContain('FINDING (#2246 backfill): code_ref src/commands/plugin.ts does not exist')
  })
})
