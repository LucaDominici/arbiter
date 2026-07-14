// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-audit-dry-pass.mjs (E3 #1943, M14 dry-pass termination).
 * Existing Code Survey (CANON-16): no dry-pass gate exists; closest is check-evidence-bundle.mjs
 * (per-task TDD bundle, not audit JSONL ledger). New script justified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-audit-dry-pass.mjs', import.meta.url).pathname

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 10000 })
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function ledger(lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

describe('check-audit-dry-pass.mjs', () => {
  let tmpDir: string
  let auditRoot: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dry-pass-'))
    auditRoot = join(tmpDir, '.arbiter', 'evidence', 'audit')
    mkdirSync(auditRoot, { recursive: true })
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('vacuous pass when no audit dirs exist', () => {
    expect(run(['--root', tmpDir]).exitCode).toBe(0)
  })

  it('passes an audit dir with no ledger and no conclusion', () => {
    mkdirSync(join(auditRoot, 'a1'))
    expect(run(['--root', tmpDir]).exitCode).toBe(0)
  })

  it('fails when a conclusion exists with no ledger', () => {
    const d = join(auditRoot, 'a2')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'report.md'), '# report\n')
    const r = run(['--dir', d])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/no pass-ledger/i)
  })

  it('fails when concluded but last pass is wet (newFindings:2)', () => {
    const d = join(auditRoot, 'a3')
    mkdirSync(d, { recursive: true })
    writeFileSync(
      join(d, 'pass-ledger.jsonl'),
      ledger([
        { pass: 1, seed: 'a', newFindings: 5 },
        { pass: 2, seed: 'b', newFindings: 0 },
        { pass: 3, seed: 'c', newFindings: 2 },
      ]),
    )
    writeFileSync(join(d, 'concluded.json'), '{}')
    const r = run(['--dir', d])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/not both dry/i)
  })

  it('passes two consecutive dry passes with distinct seeds', () => {
    const d = join(auditRoot, 'a4')
    mkdirSync(d, { recursive: true })
    writeFileSync(
      join(d, 'pass-ledger.jsonl'),
      ledger([
        { pass: 1, seed: 'a', newFindings: 5 },
        { pass: 2, seed: 'b', newFindings: 0 },
        { pass: 3, seed: 'c', newFindings: 0 },
      ]),
    )
    writeFileSync(join(d, 'report.md'), '# report\n')
    expect(run(['--dir', d]).exitCode).toBe(0)
  })

  it('fails two dry passes with the same seed (one sample)', () => {
    const d = join(auditRoot, 'a5')
    mkdirSync(d, { recursive: true })
    writeFileSync(
      join(d, 'pass-ledger.jsonl'),
      ledger([
        { pass: 1, seed: 'a', newFindings: 3 },
        { pass: 2, seed: 'a', newFindings: 0 },
        { pass: 3, seed: 'a', newFindings: 0 },
      ]),
    )
    writeFileSync(join(d, 'report.md'), '# report\n')
    const r = run(['--dir', d])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/same seed/i)
  })

  it('fails when concluded but ledger has <2 passes', () => {
    const d = join(auditRoot, 'a6')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'pass-ledger.jsonl'), ledger([{ pass: 1, seed: 'a', newFindings: 0 }]))
    writeFileSync(join(d, 'report.md'), '# report\n')
    const r = run(['--dir', d])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/<2 passes/i)
  })

  it('fails on a truncated/unparseable ledger line (fail-closed)', () => {
    const d = join(auditRoot, 'a7')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'pass-ledger.jsonl'), '{ pass: 1, \n')
    writeFileSync(join(d, 'report.md'), '# report\n')
    const r = run(['--dir', d])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toMatch(/malformed/i)
  })

  it('passes a wet ledger with NO conclusion (in-flight, not adjudicated)', () => {
    const d = join(auditRoot, 'a8')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'pass-ledger.jsonl'), ledger([{ pass: 1, seed: 'a', newFindings: 5 }]))
    expect(run(['--dir', d]).exitCode).toBe(0)
  })
})
