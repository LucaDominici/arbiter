// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-bypass-ceremony.mjs (E4 #1943/#1949, M15b ceremony detector).
 * Existing Code Survey (CANON-16): no ceremony/bypass-rate gate exists; closest analogs are
 * scripts/check-suppressions.mjs (dated-expiry discipline, different subject — suppressions not
 * gates) and scripts/check-audit-dry-pass.mjs (JSONL ledger + --root/--dir args, same shape but a
 * different predicate). New script justified — two detectors (bypass-rate ceiling +
 * advisory-permanent ledger) share one axis (enforcement theater) per the sealed spec (§E4).
 *
 * Two detectors:
 *  (a) bypass-rate ceiling over .arbiter/evidence/bypass-log.jsonl — a channel (env) with more
 *      than N `bypassed:true` entries in a trailing 30-day window fails.
 *  (b) advisory-permanent — every runWarnCheck(...) call site in scripts/check-all.mjs must have
 *      a scripts/data/advisory-ledger.json entry with either a future promoteBy or
 *      permanent:true + rationale.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = new URL('../../scripts/check-bypass-ceremony.mjs', import.meta.url).pathname

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 10000 })
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function jsonl(lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function isoDaysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function isoDaysBehind(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function bypassEntry(env: string, ts: string) {
  return { env, branch: 'main', ts, value: 'true', bypassed: true, reason: 'test' }
}

function writeCheckAll(root: string, warnCheckNames: string[]): void {
  const scriptsDir = join(root, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  const body = warnCheckNames
    .map((n) => `  runWarnCheck('${n}', 'node', ['scripts/noop.mjs'])`)
    .join('\n')
  writeFileSync(join(scriptsDir, 'check-all.mjs'), `function main() {\n${body}\n}\n`)
}

function writeLedger(root: string, entries: Record<string, unknown>[]): void {
  const dataDir = join(root, 'scripts', 'data')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    join(dataDir, 'advisory-ledger.json'),
    JSON.stringify({ schema: 'arbiter-advisory-ledger-v1', entries }, null, 2),
  )
}

describe('check-bypass-ceremony.mjs', () => {
  let tmpDir: string
  let evidenceDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'bypass-ceremony-'))
    evidenceDir = join(tmpDir, '.arbiter', 'evidence')
    mkdirSync(evidenceDir, { recursive: true })
    // Default: no runWarnCheck sites, so detector (b) is vacuous unless a test opts in.
    writeCheckAll(tmpDir, [])
    writeLedger(tmpDir, [])
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('detector (a): bypass-rate ceiling', () => {
    it('vacuous pass when no bypass-log exists', () => {
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails when a channel exceeds the ceiling within the 30-day window (13 > default 12/month)', () => {
      const lines = Array.from({ length: 13 }, () =>
        bypassEntry('ARBITER_PREPUSH_BYPASS', isoDaysAgo(1)),
      )
      writeFileSync(join(evidenceDir, 'bypass-log.jsonl'), jsonl(lines))
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/ARBITER_PREPUSH_BYPASS/)
      expect(r.stdout).toMatch(/demote/i)
    })

    it('passes when a channel is within the ceiling (11 <= default 12/month)', () => {
      const lines = Array.from({ length: 11 }, () =>
        bypassEntry('ARBITER_PREPUSH_BYPASS', isoDaysAgo(1)),
      )
      writeFileSync(join(evidenceDir, 'bypass-log.jsonl'), jsonl(lines))
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('ignores bypassed:false entries and entries outside the 30-day window', () => {
      const lines = [
        ...Array.from({ length: 20 }, () => bypassEntry('ARBITER_PREPUSH_BYPASS', isoDaysAgo(60))),
        bypassEntry('ARBITER_PREPUSH_BYPASS', isoDaysAgo(1)),
        { ...bypassEntry('ARBITER_PREPUSH_BYPASS', isoDaysAgo(1)), bypassed: false },
      ]
      writeFileSync(join(evidenceDir, 'bypass-log.jsonl'), jsonl(lines))
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('respects a per-env ceiling override in scripts/data/ceremony-thresholds.json', () => {
      const dataDir = join(tmpDir, 'scripts', 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(
        join(dataDir, 'ceremony-thresholds.json'),
        JSON.stringify({ default: 12, overrides: { ARBITER_PREPUSH_BYPASS: 20 } }),
      )
      const lines = Array.from({ length: 13 }, () =>
        bypassEntry('ARBITER_PREPUSH_BYPASS', isoDaysAgo(1)),
      )
      writeFileSync(join(evidenceDir, 'bypass-log.jsonl'), jsonl(lines))
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails closed on a malformed bypass-log line', () => {
      writeFileSync(join(evidenceDir, 'bypass-log.jsonl'), '{ env: "X", \n')
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/malformed|unparseable/i)
    })
  })

  describe('detector (b): advisory-permanent ledger', () => {
    it('vacuous pass when check-all.mjs has no runWarnCheck sites', () => {
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails when a runWarnCheck site is missing its ledger entry', () => {
      writeCheckAll(tmpDir, ['orchestrator coverage (#1410)'])
      writeLedger(tmpDir, [])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/orchestrator coverage \(#1410\)/)
      expect(r.stdout).toMatch(/missing/i)
    })

    it('passes when every runWarnCheck site has a future promoteBy entry', () => {
      writeCheckAll(tmpDir, ['conformance'])
      writeLedger(tmpDir, [
        {
          check: 'conformance',
          since: '2026-07-17',
          promoteBy: isoDaysAhead(90),
          rationale: 'OD-14',
        },
      ])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('passes when a runWarnCheck site is permanent:true with a rationale', () => {
      writeCheckAll(tmpDir, ['conformance'])
      writeLedger(tmpDir, [
        { check: 'conformance', permanent: true, rationale: 'genuinely informational surface' },
      ])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails when a ledger entry promoteBy date has expired', () => {
      writeCheckAll(tmpDir, ['orchestrator coverage (#1410)'])
      writeLedger(tmpDir, [
        {
          check: 'orchestrator coverage (#1410)',
          since: '2026-01-01',
          promoteBy: isoDaysBehind(1),
          rationale: 'stale',
        },
      ])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/expired|past/i)
    })

    it('fails when permanent:true has no rationale', () => {
      writeCheckAll(tmpDir, ['conformance'])
      writeLedger(tmpDir, [{ check: 'conformance', permanent: true }])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/rationale/i)
    })

    it('covers all sites when multiple runWarnCheck calls exist, all ledgered', () => {
      writeCheckAll(tmpDir, ['orchestrator coverage (#1410)', 'conformance'])
      writeLedger(tmpDir, [
        {
          check: 'orchestrator coverage (#1410)',
          since: '2026-07-17',
          promoteBy: isoDaysAhead(90),
          rationale: 'OD-14 (2026-07-17): dated promotion, not permanent.',
        },
        {
          check: 'conformance',
          since: '2026-07-17',
          promoteBy: isoDaysAhead(90),
          rationale: 'OD-14 (2026-07-17): dated promotion, not permanent.',
        },
      ])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })
  })

  it('supports --json output for the doctor surface', () => {
    writeCheckAll(tmpDir, ['conformance'])
    writeLedger(tmpDir, [{ check: 'conformance', permanent: true, rationale: 'informational' }])
    const r = run(['--root', tmpDir, '--json'])
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed).toHaveProperty('channels')
    expect(parsed).toHaveProperty('ledgerViolations')
  })
})
