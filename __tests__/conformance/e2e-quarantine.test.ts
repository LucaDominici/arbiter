// SPDX-License-Identifier: Apache-2.0
// #1817 (A3) — DISC-e2e-quarantine conformance probe.
//
// Rule (handoff A3): quarantine is allowed only with a linked issue + TTL; an
// EXPIRED quarantine entry must fail `arbiter conformance` (the literal AC).
// Verdict semantics:
//   - registry absent               → NA (vacuous pass, INV-130 self-SKIP parity)
//   - present, all complete+unexpired → Y
//   - present but malformed JSON    → N (fail-closed)
//   - present but wrong shape       → N (fail-closed)
//   - any entry expired/incomplete  → N (fail-closed — the literal AC)
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { probeE2eQuarantine } from '../../src/conformance/dimensions.js'

const created: string[] = []
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-quarantine-probe-'))
  created.push(dir)
  return dir
}

const validEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'flaky-checkout-redirect',
  fingerprint: 'fp_0123456789abcdef',
  reason: 'intermittent redirect race under load',
  owner: 'team-payments',
  added: '2026-01-01',
  expires: '2999-01-01',
  issue: '#9999',
  ...overrides,
})

function writeRegistry(root: string, body: string | object): void {
  const dir = join(root, '.arbiter', 'e2e')
  mkdirSync(dir, { recursive: true })
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  writeFileSync(join(dir, 'quarantine.json'), text, 'utf-8')
}

describe('probeE2eQuarantine (#1817, A3)', () => {
  it('is exported and returns a DISC-e2e-quarantine entry', () => {
    const root = tmpRoot()
    const entry = probeE2eQuarantine(root)
    expect(entry.id).toBe('DISC-e2e-quarantine')
    expect(entry.family).toBe('discipline')
  })

  it('NA when the quarantine registry is absent (vacuous pass, INV-130 parity)', () => {
    const root = tmpRoot()
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('NA')
    expect(entry.evidence).toHaveProperty('file')
  })

  it('Y when all entries are complete and unexpired (entries-wrapped form)', () => {
    const root = tmpRoot()
    writeRegistry(root, { entries: [validEntry()] })
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('Y')
  })

  it('Y when all entries are complete and unexpired (bare-array form)', () => {
    const root = tmpRoot()
    writeRegistry(root, [validEntry()])
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('Y')
  })

  it('N (fail-closed): an EXPIRED quarantine entry fails conformance — the literal AC', () => {
    const root = tmpRoot()
    writeRegistry(root, { entries: [validEntry({ expires: '2000-01-01' })] })
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('N')
    expect((entry.evidence as { detail: string }).detail).toContain('expired')
  })

  it('N (fail-closed): a quarantine entry missing a required field (e.g. linked issue)', () => {
    const root = tmpRoot()
    const e = validEntry()
    delete (e as Record<string, unknown>).issue
    writeRegistry(root, { entries: [e] })
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('N')
  })

  it('N (fail-closed): registry present but not valid JSON', () => {
    const root = tmpRoot()
    writeRegistry(root, '{ this is not json ')
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('N')
  })

  it('N (fail-closed): registry present but wrong shape (not array / no entries)', () => {
    const root = tmpRoot()
    writeRegistry(root, { foo: 'bar' })
    const entry = probeE2eQuarantine(root)
    expect(entry.verdict).toBe('N')
  })

  it('is tier-1 (must-pass gate), weight 0 — does not disturb weighted family scoring', () => {
    const root = tmpRoot()
    const entry = probeE2eQuarantine(root)
    expect(entry.tier).toBe(1)
    expect(entry.weight).toBe(0)
  })
})
