// SPDX-License-Identifier: Apache-2.0
// #2239 (wave-4 docs) — the 2026-08-04 audit found arc42.md/c4-model.md/CANON.md materially
// drifted from the tree: a phantom `src/ship/fix-on-red.ts` component (removed in the T2 cut,
// docs/REFERENCE/fix-on-red.md already records this), stale hand-copied generator/template/CLI/
// invariant counts (the underlying baselines moved twice during this audit's own lifetime —
// the argument for pointer-only, not a new hand-copy), wrong verify-bridge paths, a phantom
// src/commands/plugin.ts, phantom bare-word commands (kit/conformance/ci/plugin never
// registered), and CANON.md:344 citing the wrong FEATURE_MATRIX.md path. Assertions are scoped
// to arc42.md/c4-model.md/CANON.md only — docs/REFERENCE/fix-on-red.md legitimately documents
// the removal and is never touched.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string): string => readFileSync(resolve(p), 'utf-8')
const ARC42 = 'docs/architecture/arc42.md'
const C4 = 'docs/architecture/c4-model.md'
const CANON = 'docs/internal/SYSTEM/CANON.md'

describe('#2239 — arc42/c4/CANON drift corrected, counts replaced by SSOT pointers', () => {
  it('no longer describes src/ship/fix-on-red.ts as a live component (arc42 + c4)', () => {
    expect(read(ARC42)).not.toContain('src/ship/fix-on-red.ts')
    expect(read(C4)).not.toContain('src/ship/fix-on-red.ts')
  })

  it('Gate Runner row no longer hand-copies a stale L1/L2 check count', () => {
    expect(read(ARC42)).not.toContain('~60 L1')
  })

  it('generator/template/CLI counts are pointers, not the stale hand-copied numbers', () => {
    const arc = read(ARC42)
    expect(arc).not.toContain('84 files, 8756 LOC')
    expect(arc).not.toContain('85 files / 8,694 LOC')
    expect(arc).not.toContain('554 files / 46,969 LOC')
    expect(arc).not.toContain('76 `.command()` registrations')
    const c4 = read(C4)
    expect(c4).not.toContain('Generators (85 files)')
    expect(c4).not.toContain('(554 files)')
    expect(c4).not.toContain('11 public + hidden experimental cmds')
    expect(c4).not.toContain('85 generators; each renders')
    expect(c4).not.toContain('554 `.ejs` files')
  })

  it('Verification Bridge row drops the nonexistent anti-fake-green.ts and qualifies real paths', () => {
    const arc = read(ARC42)
    expect(arc).not.toContain('anti-fake-green.ts')
    expect(arc).toContain('src/commands/verify-plan.ts')
  })

  it('Plugin API no longer cites the nonexistent src/commands/plugin.ts (arc42 + c4)', () => {
    expect(read(ARC42)).not.toContain('src/commands/plugin.ts')
    expect(read(C4)).not.toContain('src/commands/plugin.ts')
  })

  it('drops the phantom bare-word command list (kit/conformance/ci/plugin never registered)', () => {
    expect(read(ARC42)).not.toContain('`graph`, `kit`, `conformance`, `ci`, `plugin`')
  })

  it('glossary no longer claims `ci plan` is a walkable command (removed in the T2 cut)', () => {
    expect(read(ARC42)).not.toContain('`verify graph` / `ci plan` walk')
  })

  it('invariant count is a pointer, not the stale "134"', () => {
    expect(read(ARC42)).not.toMatch(/\b134\b/)
  })

  it('CANON.md:344 points at the real FEATURE_MATRIX.md path', () => {
    const canon = read(CANON)
    expect(canon).not.toContain('docs/PRODUCT/FEATURE_MATRIX.md')
    expect(canon).toContain('docs/internal/PRODUCT/FEATURE_MATRIX.md')
  })
})
