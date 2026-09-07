// SPDX-License-Identifier: Apache-2.0
/**
 * #2427 AC-1 — the gate marker must bind the tree the gate ACTUALLY tested.
 *
 * The incident: a `git push` was killed while its pre-push L2 ran; the orphaned
 * gate kept going, the branch got another commit, and the orphan finished green
 * and stamped `.arbiter/gate-pass.json` with the head_sha and tree hash captured
 * AT STAMP TIME — the newer commit — although most of its checks had executed
 * against the previous tree. The next push then reused that marker and skipped
 * the gate entirely. A marker bound a tree it never fully tested.
 *
 * The fix: identity is captured at gate START, re-captured at gate END, and the
 * marker is refused outright when the two disagree or when either end cannot be
 * resolved. The marker records BOTH ends; the verifier treats a start↔end
 * mismatch as unverifiable.
 *
 * DEFEAT-oriented: every case plants one specific defect through the REAL writer
 * path, with happy-path negative controls so "refuses everything" cannot pass.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GATE_EVIDENCE_SCHEMA,
  GATE_EVIDENCE_STRING_FIELDS,
  buildGateEvidence,
  captureGateStart,
  verifyGateEvidence,
} from '../../scripts/lib/gate-evidence.mjs'
import { GATE_PASS_POLICY, verifyGatePassMarker } from '../../src/evidence/gate-binding.js'

const BRANCH = 'task/#2427-gate-evidence-binding'

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

/** A real git repo carrying the toolchain files the fingerprint hashes. */
function makeRepo(): string {
  const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-'))))
  git(dir, ['init', '-q', '-b', BRANCH])
  git(dir, ['config', 'user.email', 'test@arbiter.dev'])
  git(dir, ['config', 'user.name', 'Arbiter Test'])
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0' }))
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
  writeFileSync(join(dir, '.nvmrc'), '22\n')
  writeFileSync(join(dir, 'src.txt'), 'hello\n')
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: {} }))
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

type Marker = Record<string, unknown>

describe('#2427 AC-1 — captureGateStart', () => {
  it('resolves head_sha, tree_hash and a start timestamp inside a real repo', () => {
    const dir = makeRepo()
    const start = captureGateStart(dir) as Record<string, string> | null
    expect(start).not.toBeNull()
    expect(start?.head_sha).toBe(git(dir, ['rev-parse', 'HEAD']))
    expect(start?.tree_hash).toMatch(/^[0-9a-f]{40}$/)
    expect(Number.isFinite(Date.parse(String(start?.started_at)))).toBe(true)
  })

  it('returns null (never a partial fact) where git cannot answer', () => {
    const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-2427-nogit-'))))
    expect(captureGateStart(dir)).toBeNull()
  })
})

describe('#2427 AC-1 — buildGateEvidence refuses to stamp what it did not test', () => {
  it('writes a marker recording BOTH ends when the tree is unchanged (negative control)', () => {
    const dir = makeRepo()
    const start = captureGateStart(dir)
    const marker = buildGateEvidence({ root: dir, level: 'L2', taskId: '#2427', start })
    expect(marker).not.toBeNull()
    const m = marker as Marker
    expect(m.schema).toBe(GATE_EVIDENCE_SCHEMA)
    expect(m.start_head_sha).toBe(m.head_sha)
    expect(m.start_tree_hash).toBe(m.tree_hash)
    expect(typeof m.gate_started_at).toBe('string')
    expect(verifyGateEvidence(m, { root: dir, minLevel: 'L2' })).toEqual({ ok: true })
  })

  it('REFUSES when HEAD moved mid-gate — the exact #2427 incident', () => {
    const dir = makeRepo()
    const start = captureGateStart(dir)
    // The branch takes another commit while the (orphaned) gate is still running.
    writeFileSync(join(dir, 'src.txt'), 'changed while the gate ran\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', 'second commit during the gate'])
    expect(buildGateEvidence({ root: dir, level: 'L2', taskId: '#2427', start })).toBeNull()
  })

  it('REFUSES when the working tree changed mid-gate without a commit', () => {
    const dir = makeRepo()
    const start = captureGateStart(dir)
    writeFileSync(join(dir, 'src.txt'), 'dirtied while the gate ran\n')
    expect(buildGateEvidence({ root: dir, level: 'L2', taskId: '#2427', start })).toBeNull()
  })

  it('REFUSES when an untracked file appears mid-gate', () => {
    const dir = makeRepo()
    const start = captureGateStart(dir)
    writeFileSync(join(dir, 'appeared.txt'), 'new file during the gate\n')
    expect(buildGateEvidence({ root: dir, level: 'L2', taskId: '#2427', start })).toBeNull()
  })

  it('REFUSES when no start identity was captured at all (fail closed)', () => {
    const dir = makeRepo()
    expect(buildGateEvidence({ root: dir, level: 'L2', taskId: '#2427' })).toBeNull()
  })

  it('REFUSES when the start identity is incomplete (fail closed)', () => {
    const dir = makeRepo()
    const start = captureGateStart(dir) as Record<string, unknown>
    expect(
      buildGateEvidence({
        root: dir,
        level: 'L2',
        taskId: '#2427',
        start: { ...start, tree_hash: null },
      }),
    ).toBeNull()
  })
})

describe('#2427 AC-1 — the verifier treats a start↔end mismatch as unverifiable', () => {
  function markerFor(dir: string, overrides: Marker = {}): Marker {
    const built = buildGateEvidence({
      root: dir,
      level: 'L2',
      taskId: '#2427',
      start: captureGateStart(dir),
    })
    expect(built).not.toBeNull()
    return { ...(built as Marker), ...overrides }
  }

  it('rejects a marker whose start_head_sha does not equal its head_sha', () => {
    const dir = makeRepo()
    const marker = markerFor(dir, { start_head_sha: '0'.repeat(40) })
    const result = verifyGateEvidence(marker, { root: dir, minLevel: 'L2' })
    expect(result.ok).toBe(false)
    expect(String((result as { reason: string }).reason)).toMatch(/start/i)
  })

  it('rejects a marker whose start_tree_hash does not equal its tree_hash', () => {
    const dir = makeRepo()
    const marker = markerFor(dir, { start_tree_hash: '1'.repeat(40) })
    const result = verifyGateEvidence(marker, { root: dir, minLevel: 'L2' })
    expect(result.ok).toBe(false)
    expect(String((result as { reason: string }).reason)).toMatch(/start/i)
  })

  it('rejects a v2-shaped marker that carries no start fields at all', () => {
    const dir = makeRepo()
    const marker = markerFor(dir)
    delete marker.start_head_sha
    delete marker.start_tree_hash
    delete marker.gate_started_at
    const result = verifyGateEvidence(marker, { root: dir, minLevel: 'L2' })
    expect(result.ok).toBe(false)
  })

  it('requires the start fields presence-first, so a blank one is never unconstrained', () => {
    expect(GATE_EVIDENCE_STRING_FIELDS).toContain('start_head_sha')
    expect(GATE_EVIDENCE_STRING_FIELDS).toContain('start_tree_hash')
    expect(GATE_EVIDENCE_STRING_FIELDS).toContain('gate_started_at')
  })
})

describe('#2427 AC-1 — the engine twin enforces the same start↔end axis', () => {
  it('GATE_PASS_POLICY stays pinned to the script constants', () => {
    expect(GATE_PASS_POLICY.schema).toBe(GATE_EVIDENCE_SCHEMA)
    expect([...GATE_PASS_POLICY.stringFields]).toEqual([...GATE_EVIDENCE_STRING_FIELDS])
  })

  it('verifyGatePassMarker rejects the same start↔end mismatch', () => {
    const dir = makeRepo()
    const built = buildGateEvidence({
      root: dir,
      level: 'L2',
      taskId: '#2427',
      start: captureGateStart(dir),
    }) as Marker
    expect(verifyGatePassMarker(built, { root: dir, minLevel: 'L2' })).toEqual({ ok: true })
    const tampered = { ...built, start_tree_hash: '2'.repeat(40) }
    const result = verifyGatePassMarker(tampered, { root: dir, minLevel: 'L2' })
    expect(result.ok).toBe(false)
    expect(String((result as { reason: string }).reason)).toMatch(/start/i)
  })
})
