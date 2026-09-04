// SPDX-License-Identifier: Apache-2.0
/**
 * #2328 — direct tests for the ENGINE-side verifier, `src/evidence/gate-binding.ts`.
 *
 * `arbiter task advance` calls this copy, not `scripts/lib/gate-evidence.mjs`,
 * and it deliberately carries its own copy of the policy: a command that gates a
 * tree must not take its verdict from a script inside that tree. Until now it was
 * only exercised incidentally through task.ts, so the copy that actually guards
 * the phase transition was the one nobody tested directly (66% branch coverage).
 *
 * Every case here runs the SAME marker through BOTH verifiers and asserts they
 * return the SAME verdict, so this file is also the behavioural half of the
 * anti-drift guard. The existing parity test pins the policy CONSTANTS (schema,
 * TTL, level ranks, field list, toolchain inputs); constants alone cannot catch a
 * copy whose *logic* drifted — an axis dropped from one verifier keeps every
 * constant identical. That gap is what this file closes.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyGatePassMarker } from '../../src/evidence/gate-binding.js'
import {
  GATE_EVIDENCE_STRING_FIELDS,
  buildGateEvidence,
  captureGateStart,
  verifyGateEvidence,
} from '../../scripts/lib/gate-evidence.mjs'

const BRANCH = 'task/2328-engine'
type Marker = Record<string, unknown>
type Verdict = { ok: boolean; reason?: string }
type Opts = { root: string; minLevel?: string; maxAgeMin?: number; taskId?: string; now?: number }

const dirs: string[] = []
function track(dir: string): string {
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim()
}

function makeRepo(): string {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-engine-'))))
  git(dir, ['init', '-q', '-b', BRANCH])
  git(dir, ['config', 'user.email', 'test@arbiter.dev'])
  git(dir, ['config', 'user.name', 'Arbiter Test'])
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0' }))
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
  writeFileSync(join(dir, 'src.txt'), 'hello\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init', '--no-gpg-sign'])
  return dir
}

function markerFor(root: string, overrides: Marker = {}): Marker {
  const built = buildGateEvidence({
    root,
    level: 'L2',
    taskId: '#2328',
    start: captureGateStart(root),
  })
  expect(built).not.toBeNull()
  return { ...(built as Marker), ...overrides }
}

/**
 * Run one marker through both verifiers and assert they AGREE, then return the
 * engine-side verdict for the case's own assertion.
 */
function verdictOf(marker: unknown, opts: Opts): Verdict {
  const engine = verifyGatePassMarker(marker, opts) as Verdict
  const script = verifyGateEvidence(marker, opts) as Verdict
  expect(
    engine,
    'engine (gate-binding.ts) and script (gate-evidence.mjs) verifiers disagree — ' +
      'the two copies have drifted in BEHAVIOUR while their policy constants still match',
  ).toEqual(script)
  return engine
}

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString()
}

describe('#2328 engine verifier — negative control', () => {
  it('ACCEPTS a marker the writer just produced for this exact tree', () => {
    const dir = makeRepo()
    expect(verdictOf(markerFor(dir), { root: dir, minLevel: 'L2', maxAgeMin: 240 })).toEqual({
      ok: true,
    })
  })

  it('ACCEPTS with no minLevel/maxAgeMin supplied (the L2 / 240 defaults)', () => {
    const dir = makeRepo()
    expect(verdictOf(markerFor(dir), { root: dir })).toEqual({ ok: true })
  })

  it('ACCEPTS when the required task id matches (anti-replay satisfied)', () => {
    const dir = makeRepo()
    expect(verdictOf(markerFor(dir), { root: dir, taskId: '#2328' })).toEqual({ ok: true })
  })

  it('ACCEPTS evidence recorded ABOVE the required level', () => {
    const dir = makeRepo()
    const marker = buildGateEvidence({
      root: dir,
      level: 'L3',
      taskId: '#2328',
      start: captureGateStart(dir),
    })
    expect(verdictOf(marker, { root: dir, minLevel: 'L2' })).toEqual({ ok: true })
  })

  it('ACCEPTS when the caller passes a blank task id (no anti-replay requested)', () => {
    const dir = makeRepo()
    expect(verdictOf(markerFor(dir), { root: dir, taskId: '   ' })).toEqual({ ok: true })
  })
})

describe('#2328 engine verifier — shape fails closed', () => {
  it.each([
    ['null', null],
    ['array', []],
    ['string', 'a stale marker'],
    ['number', 7],
  ] as const)('rejects a non-object marker: %s', (_label, value) => {
    const dir = makeRepo()
    const verdict = verdictOf(value, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/JSON object/i)
  })

  it('rejects an OLD v1 marker verbatim — no grandfathering', () => {
    const dir = makeRepo()
    const verdict = verdictOf(
      {
        head_sha: git(dir, ['rev-parse', 'HEAD']),
        branch: BRANCH,
        task_id: '#2328',
        timestamp: new Date().toISOString(),
        level: 'L2',
        node_version: process.version,
        git_user: 'Arbiter Test',
        tree_was_clean_at_run_time: true,
      },
      { root: dir },
    )
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/schema|missing or empty/i)
  })

  it('rejects a marker whose schema id is a different version', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { schema: 'arbiter-gate-pass-v1' }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/schema/i)
  })

  // The headline failure mode: an absent or blank field must never read as
  // "unconstrained" on the engine side either.
  it.each(GATE_EVIDENCE_STRING_FIELDS)('rejects %s deleted', (field: string) => {
    const dir = makeRepo()
    const marker = Object.fromEntries(
      Object.entries(markerFor(dir)).filter(([key]) => key !== field),
    )
    const verdict = verdictOf(marker, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toContain(field)
  })

  it.each(GATE_EVIDENCE_STRING_FIELDS)('rejects %s blank/null/whitespace', (field: string) => {
    const dir = makeRepo()
    for (const planted of ['', null, '   ']) {
      const verdict = verdictOf(markerFor(dir, { [field]: planted }), { root: dir })
      expect(verdict.ok, `${field} = ${JSON.stringify(planted)}`).toBe(false)
      expect(String(verdict.reason)).toContain(field)
    }
  })

  it('rejects a marker stamped over a dirty tree', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { tree_was_clean_at_run_time: false }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/tree_was_clean_at_run_time/i)
  })
})

describe('#2328 engine verifier — level', () => {
  it('rejects evidence below the required level', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { level: 'L1' }), { root: dir, minLevel: 'L2' })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/below the required/i)
  })

  it('rejects an unknown marker level rather than treating it as sufficient', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { level: 'LX' }), { root: dir, minLevel: 'L2' })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/not a known gate level/i)
  })

  it('rejects an unknown REQUIRED level rather than passing everything', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir), { root: dir, minLevel: 'LZ' })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/required gate level/i)
  })
})

describe('#2328 engine verifier — TTL', () => {
  it('rejects evidence older than the consumer budget', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { timestamp: minutesAgo(300) }), {
      root: dir,
      maxAgeMin: 240,
    })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/expired/i)
  })

  it('honours a SHORTER ttl_minutes carried by the marker itself', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { timestamp: minutesAgo(30), ttl_minutes: 10 }), {
      root: dir,
      maxAgeMin: 240,
    })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/expired/i)
  })

  it('refuses to let a forged ttl_minutes widen the consumer budget', () => {
    const dir = makeRepo()
    const verdict = verdictOf(
      markerFor(dir, { timestamp: minutesAgo(300), ttl_minutes: 1_000_000 }),
      { root: dir, maxAgeMin: 240 },
    )
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/expired/i)
  })

  it.each([
    ['deleted', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['non-numeric', 'forever'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ] as const)('rejects a marker whose ttl_minutes is %s', (_label, value) => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    if (value === undefined) delete marker.ttl_minutes
    else marker.ttl_minutes = value
    const verdict = verdictOf(marker, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/ttl_minutes/i)
  })

  it('rejects a non-positive consumer budget instead of accepting anything', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir), { root: dir, maxAgeMin: 0 })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/budget/i)
  })

  it('rejects a marker timestamped in the future', () => {
    const dir = makeRepo()
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const verdict = verdictOf(markerFor(dir, { timestamp: future }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/future/i)
  })

  it('rejects a marker whose timestamp is not a date', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { timestamp: 'yesterday-ish' }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/not a valid date/i)
  })

  it('accepts evidence stamped within the clock-skew tolerance', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    expect(verdictOf(marker, { root: dir, now: Date.now() - 60_000 })).toEqual({ ok: true })
  })
})

describe('#2328 engine verifier — commit and task correlation', () => {
  it('rejects a marker for a different head_sha', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { head_sha: 'a'.repeat(40) }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/head_sha/i)
  })

  it('rejects a marker for a different branch', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { branch: 'task/other' }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/branch mismatch/i)
  })

  it('rejects a prior task the marker on this branch (anti-replay)', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { task_id: '#1' }), { root: dir, taskId: '#2328' })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/task_id/i)
  })

  it('reports UNVERIFIABLE — not a pass — when the root is not a git checkout', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    const notARepo = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-engine-nogit-'))))
    const verdict = verdictOf(marker, { root: notARepo })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/unverifiable/i)
  })
})

describe('#2328 engine verifier — checkout, toolchain and tree identity', () => {
  it('rejects evidence produced in a SIBLING checkout (same sha, same branch)', () => {
    const a = makeRepo()
    const b = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-engine-b-'))))
    rmSync(b, { recursive: true, force: true })
    execFileSync('git', ['clone', '-q', a, b], { stdio: 'ignore' })
    const bReal = realpathSync(b)
    dirs.push(bReal)
    git(bReal, ['config', 'user.email', 'test@arbiter.dev'])
    git(bReal, ['config', 'user.name', 'Arbiter Test'])

    const marker = markerFor(a)
    expect(git(bReal, ['rev-parse', 'HEAD'])).toBe(git(a, ['rev-parse', 'HEAD']))
    const verdict = verdictOf(marker, { root: bReal })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/checkout_root/i)
  })

  it('rejects a marker carrying a foreign checkout_root', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { checkout_root: '/nowhere/else' }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/checkout_root/i)
  })

  it('rejects a marker stamped under a different node version', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { node_version: 'v0.0.1' }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/node_version/i)
  })

  it('rejects evidence after a lockfile change under an unchanged head_sha', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    const headBefore = git(dir, ['rev-parse', 'HEAD'])
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, x: 1 }))
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(headBefore)

    const verdict = verdictOf(marker, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/toolchain_fingerprint/i)
  })

  it('rejects a marker carrying a forged toolchain_fingerprint', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { toolchain_fingerprint: 'sha256:dead' }), {
      root: dir,
    })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/toolchain_fingerprint/i)
  })

  it('rejects evidence once a TRACKED file changed under an unchanged head_sha', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    writeFileSync(join(dir, 'src.txt'), 'tampered\n')
    const verdict = verdictOf(marker, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/tree_hash/i)
  })

  it('rejects evidence once an UNTRACKED file appeared', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    writeFileSync(join(dir, 'sneaked-in.txt'), 'not committed, not gated\n')
    const verdict = verdictOf(marker, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/tree_hash/i)
  })

  it('rejects a marker carrying a forged tree_hash', () => {
    const dir = makeRepo()
    const verdict = verdictOf(markerFor(dir, { tree_hash: 'f'.repeat(40) }), { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/tree_hash/i)
  })

  it('is NOT disturbed by arbiter runtime state written under .arbiter/', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    mkdirSync(join(dir, '.arbiter', 'findings'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'findings', 'x.jsonl'), '{"k":1}\n')
    expect(verdictOf(marker, { root: dir })).toEqual({ ok: true })
  })

  it('reports UNVERIFIABLE when the tree hash cannot be recomputed', () => {
    // Config-driven plant (a required clean filter that exits non-zero): no mode
    // bit is involved, so it bites for every uid — including CI's root.
    const dir = makeRepo()
    const marker = markerFor(dir)
    writeFileSync(join(dir, '.gitattributes'), '* filter=arbiter-unhashable\n')
    git(dir, ['config', 'filter.arbiter-unhashable.clean', 'exit 1'])
    git(dir, ['config', 'filter.arbiter-unhashable.required', 'true'])

    const verdict = verdictOf(marker, { root: dir })
    expect(verdict.ok).toBe(false)
    expect(String(verdict.reason)).toMatch(/unverifiable|tree/i)
  })
})
