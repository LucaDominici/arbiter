// SPDX-License-Identifier: Apache-2.0
// #1422 — `arbiter close-gold-gap <gapId>` is the LIVE consumer of the remediation catalog/handlers.
// It runs the gold-audit engine (reusing runGoldAudit, ONE engine), finds the requested N/P gap, and
// prints the handler's deterministic recipe. It NEVER executes the recipe (anti-fake-green).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCloseGoldGap } from '../../src/commands/close-gold-gap.js'

// A registry with a present doc (Y), a missing doc (N → doc-set recipe), and a manual check (NV).
const REGISTRY = `version: '1.0.0'
profile: tooling
dimensions:
  - id: D-DOCS
    title: Documentation
  - id: D-SUPPLY-CHAIN
    title: Supply chain
checks:
  - id: GA-DOC-01
    dimension: D-DOCS
    title: README present
    type: file_exists
    args: { path: README.md }
    weight: 1
    risk: SAFE
  - id: GA-DOC-99
    dimension: D-DOCS
    title: Security policy present
    type: file_exists
    args: { path: SECURITY.md }
    weight: 1
    risk: SAFE
  - id: GA-SUP-99
    dimension: D-SUPPLY-CHAIN
    title: Attestation human-verified
    type: manual
    weight: 1
    risk: SAFE
`

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'close-gap-'))
  mkdirSync(join(dir, 'standards'), { recursive: true })
  writeFileSync(join(dir, 'standards', 'gold-registry.yml'), REGISTRY)
  writeFileSync(join(dir, 'README.md'), '# r\n') // GA-DOC-01 → Y
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runCloseGoldGap (#1422)', () => {
  it('emits a doc-set recipe (P, not Y) for a missing-doc gap', () => {
    const res = runCloseGoldGap({ gapId: 'GA-DOC-99', repo: dir, json: true })
    expect(res.exitCode).toBe(0)
    expect(res.plan).toBeTruthy()
    expect(res.plan!.kind).toBe('doc-set')
    expect(res.plan!.expectedVerdict).toBe('P')
    expect(res.plan!.expectedVerdict).not.toBe('Y')
    expect(res.plan!.ssot.length).toBeGreaterThan(0)
  })

  it('emits a process (human-only, NV) recipe for a manual gap', () => {
    const res = runCloseGoldGap({ gapId: 'GA-SUP-99', repo: dir, json: true })
    expect(res.exitCode).toBe(0)
    expect(res.plan!.kind).toBe('process')
    expect(res.plan!.code).toBe(false)
    expect(res.plan!.expectedVerdict).toBe('NV')
    expect(res.plan!.steps.every((s) => s.delegateCommand === undefined)).toBe(true)
  })

  it('refuses a non-actionable (Y) check — exit 1, no plan', () => {
    const res = runCloseGoldGap({ gapId: 'GA-DOC-01', repo: dir, json: true })
    expect(res.exitCode).toBe(1)
    expect(res.plan).toBeNull()
  })

  it('errors on an unknown gap id — exit 1', () => {
    const res = runCloseGoldGap({ gapId: 'GA-NOPE', repo: dir, json: true })
    expect(res.exitCode).toBe(1)
    expect(res.plan).toBeNull()
  })

  it('errors (exit 1) when there is no registry', () => {
    const empty = mkdtempSync(join(tmpdir(), 'close-gap-empty-'))
    try {
      const res = runCloseGoldGap({ gapId: 'GA-DOC-99', repo: empty, json: true })
      expect(res.exitCode).toBe(1)
      expect(res.plan).toBeNull()
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('is deterministic — same gap ⇒ identical plan', () => {
    const a = runCloseGoldGap({ gapId: 'GA-DOC-99', repo: dir, json: true })
    const b = runCloseGoldGap({ gapId: 'GA-DOC-99', repo: dir, json: true })
    expect(a.plan).toEqual(b.plan)
  })
})
