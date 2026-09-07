// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for scripts/check-bypass-ceremony.mjs (E4 #1943/#1949, M15b ceremony detector).
 * Existing Code Survey (CANON-16): no ceremony/bypass-rate gate exists; closest analogs are
 * scripts/check-suppressions.mjs (dated-expiry discipline, different subject — suppressions not
 * gates) and scripts/check-audit-dry-pass.mjs (JSONL ledger + --root/--dir args, same shape but a
 * different predicate). New script justified — two detectors (bypass-rate ceiling +
 * advisory-permanent ledger) share one axis (enforcement theater) per the sealed spec (§E4).
 *
 * Three detectors:
 *  (a) bypass-rate ceiling over .arbiter/evidence/bypass-log.jsonl — a channel (env) with more
 *      than N `bypassed:true` entries in a trailing 30-day window fails.
 *  (b) advisory-permanent — every runWarnCheck(...) call site in scripts/check-all.mjs must have
 *      a scripts/data/advisory-ledger.json entry with either a future promoteBy or
 *      permanent:true + rationale.
 *  (c) orphan ledger entries (#2467) — the reverse direction of (b): every ledger entry must
 *      name a check that is STILL an advisory site (a runWarnCheck call or a gh-audit guard).
 *      A check promoted to a hard runCheck, renamed, or removed leaves its ledger entry an
 *      orphan — it describes an advisory bypass for a check that is no longer advisory.
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

function writeCheckAllMixed(
  root: string,
  warnCheckNames: string[],
  hardCheckNames: string[],
): void {
  const scriptsDir = join(root, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  const warnLines = warnCheckNames.map(
    (n) => `  runWarnCheck('${n}', 'node', ['scripts/noop.mjs'])`,
  )
  const hardLines = hardCheckNames.map((n) => `  runCheck('${n}', 'node', ['scripts/noop.mjs'])`)
  const body = [...warnLines, ...hardLines].join('\n')
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

  // ── #2419 AC-3: gh-audit guards are advisory too, and owe the same dated promotion ──
  // The anti-fake-green aggregate runs HARD, but its `class: 'gh-audit'` members exit 1 as
  // ADVISORY (only `--enforce` makes them fail). That is a second population of advisory-forever
  // gates, invisible to a detector that only reads runWarnCheck call sites. AGENTS.md now labels
  // them advisory WITH a promotion date; this is what makes that date able to go red.
  describe('detector (b): gh-audit guards in the anti-fake-green roster (#2419 AC-3)', () => {
    function writeGuardRoster(root: string, guards: { name: string; cls: string }[]): void {
      const libDir = join(root, 'scripts', 'lib')
      mkdirSync(libDir, { recursive: true })
      const body = guards
        .map(
          (g) =>
            `  { name: '${g.name}', script: 'scripts/check-${g.name}.mjs', class: '${g.cls}' },`,
        )
        .join('\n')
      writeFileSync(
        join(libDir, 'anti-fake-green-guards.mjs'),
        `export const GUARDS = [\n${body}\n]\n`,
      )
    }

    it('vacuous pass when the guard roster is absent (never reds a repo without one)', () => {
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails when a gh-audit guard has no ledger entry', () => {
      writeGuardRoster(tmpDir, [{ name: 'min-review-time', cls: 'gh-audit' }])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/min-review-time/)
      expect(r.stdout).toMatch(/missing/i)
    })

    it('passes when every gh-audit guard has a future promoteBy entry', () => {
      writeGuardRoster(tmpDir, [
        { name: 'min-review-time', cls: 'gh-audit' },
        { name: 'ownership-distribution', cls: 'gh-audit' },
      ])
      writeLedger(tmpDir, [
        { check: 'min-review-time', promoteBy: isoDaysAhead(90), rationale: 'gh-audit advisory' },
        {
          check: 'ownership-distribution',
          promoteBy: isoDaysAhead(90),
          rationale: 'gh-audit advisory',
        },
      ])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails when a gh-audit guard ledger entry has expired', () => {
      writeGuardRoster(tmpDir, [{ name: 'min-review-time', cls: 'gh-audit' }])
      writeLedger(tmpDir, [
        { check: 'min-review-time', promoteBy: isoDaysBehind(1), rationale: 'stale' },
      ])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/expired|past/i)
    })

    it('does NOT demand a ledger entry for file-scan or context-rot guards (they fail hard already)', () => {
      writeGuardRoster(tmpDir, [
        { name: 'muted-test', cls: 'file-scan' },
        { name: 'agent-return', cls: 'context-rot' },
      ])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })
  })

  // ── #2467: orphan ledger entries — the reverse direction of detector (b) ──
  describe('detector (c): orphan ledger entries (#2467)', () => {
    it('vacuous pass when the ledger is empty', () => {
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('passes when a ledger entry still names a live runWarnCheck site', () => {
      writeCheckAll(tmpDir, ['conformance'])
      writeLedger(tmpDir, [{ check: 'conformance', permanent: true, rationale: 'informational' }])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('FAILS when a ledger entry names a check that has been promoted to a hard runCheck', () => {
      // The check moved from runWarnCheck(...) to runCheck(...) in check-all.mjs but its
      // ledger row was never pruned — the exact #2467 shape (review completion (#2177)).
      writeCheckAllMixed(tmpDir, [], ['review completion (#2177)'])
      writeLedger(tmpDir, [
        {
          check: 'review completion (#2177)',
          since: '2026-08-02',
          promoteBy: isoDaysAhead(90),
          rationale: 'stale — this check is now hard',
        },
      ])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/review completion \(#2177\)/)
      expect(r.stdout).toMatch(/hard|promoted|no longer advisory|orphan/i)
    })

    it('FAILS when a ledger entry names a check not found anywhere in check-all.mjs', () => {
      writeCheckAll(tmpDir, [])
      writeLedger(tmpDir, [
        {
          check: 'a check that was renamed or deleted (#0000)',
          permanent: true,
          rationale: 'orphan',
        },
      ])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/a check that was renamed or deleted \(#0000\)/)
      expect(r.stdout).toMatch(/orphan|not found/i)
    })

    it('passes when a ledger entry still names a live gh-audit guard', () => {
      const libDir = join(tmpDir, 'scripts', 'lib')
      mkdirSync(libDir, { recursive: true })
      writeFileSync(
        join(libDir, 'anti-fake-green-guards.mjs'),
        `export const GUARDS = [\n  { name: 'min-review-time', script: 'scripts/check-min-review-time.mjs', class: 'gh-audit' },\n]\n`,
      )
      writeLedger(tmpDir, [
        { check: 'min-review-time', promoteBy: isoDaysAhead(90), rationale: 'gh-audit advisory' },
      ])
      expect(run(['--root', tmpDir]).exitCode).toBe(0)
    })

    it('fails closed when the advisory ledger itself is malformed JSON (cannot verify, must not silently pass)', () => {
      writeCheckAll(tmpDir, [])
      const dataDir = join(tmpDir, 'scripts', 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'advisory-ledger.json'), '{ not valid json')
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/malformed|not valid|invalid/i)
    })

    it('fails closed when check-all.mjs is missing entirely but the ledger has entries', () => {
      // No writeCheckAll() call here — check-all.mjs genuinely does not exist. With no source
      // of truth for advisory status, the detector must say so and fail, not pass vacuously.
      rmSync(join(tmpDir, 'scripts', 'check-all.mjs'), { force: true })
      writeLedger(tmpDir, [{ check: 'anything (#1)', permanent: true, rationale: 'x' }])
      const r = run(['--root', tmpDir])
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toMatch(/check-all\.mjs not found|cannot determine/i)
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
