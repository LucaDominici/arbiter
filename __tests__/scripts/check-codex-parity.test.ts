// SPDX-License-Identifier: Apache-2.0
// Codex-track parity contract — non-vacuity + unit suite (ADR-106, #1966).
//
// Mutation tests run against ISOLATED tmpdir bakes (real generators, mutated
// copies) — never the live worktree. The CANON-22-drop test below is the
// wave's TDD ceremony RED: it must fail against the harness skeleton and only
// pass once the real parity comparison lands (GREEN).

import { describe, it, expect, afterEach } from 'vitest'
import { runParityCheck } from '../../scripts/lib/codex-parity-lib.mjs'
import { bakeBothTracks, cleanupBake, dropCanon22, parityCtx } from './codex-parity-fixture.js'

interface Finding {
  kind: string
  file: string
  message: string
}
interface ParityResult {
  status: 'PASS' | 'FAIL'
  findings: Finding[]
  surface: { total: number; classified: number }
}

describe('check-codex-parity — non-vacuity mutations (#1966)', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir !== undefined) cleanupBake(dir)
    dir = undefined
  })

  it('goes RED when the codex derivation drops the CANON-22 section (mutation 3a — the #1966 regression)', () => {
    dir = bakeBothTracks()
    dropCanon22(dir)

    const result = runParityCheck(parityCtx(dir)) as ParityResult

    expect(result.status, 'a CANON-22-less codex exec protocol must fail the parity check').toBe(
      'FAIL',
    )
    const hit = result.findings.find(
      (f) =>
        f.file === '.agents/rules/90-exec-protocol.md' &&
        (f.kind === 'derived-drift' || f.kind === 'golden-mismatch'),
    )
    expect(
      hit,
      `expected a derived-drift/golden-mismatch finding for .agents/rules/90-exec-protocol.md, got: ${JSON.stringify(result.findings)}`,
    ).toBeDefined()
  })
})
