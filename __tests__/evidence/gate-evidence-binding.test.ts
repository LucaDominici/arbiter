// SPDX-License-Identifier: Apache-2.0
/**
 * #2328 — gate-pass evidence binding (schema v2).
 *
 * `.arbiter/gate-pass.json` used to bind gate evidence to `head_sha` + branch +
 * a BOOLEAN snapshot of tree cleanliness. Three identity axes were missing, and
 * each was a way for a green marker to describe a tree that was never gated:
 * the actual tree content, the physical checkout it came from, and the
 * toolchain that produced it. The TTL existed only inside `.githooks/pre-push`.
 *
 * These tests are DEFEAT-oriented. Every case PLANTS one specific defect into a
 * marker built by the REAL writer path and proves the verifier flips red, with
 * a happy-path negative control so that "rejects everything" cannot pass.
 *
 * The load-bearing rule: a MISSING or EMPTY field must never read as
 * "unconstrained". Old-schema markers are rejected, not grandfathered.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GATE_EVIDENCE_SCHEMA,
  GATE_EVIDENCE_DEFAULT_TTL_MIN,
  GATE_EVIDENCE_LEVEL_RANK,
  GATE_EVIDENCE_STRING_FIELDS,
  GATE_EVIDENCE_TOOLCHAIN_INPUTS,
  GATE_EVIDENCE_FUTURE_SKEW_MIN,
  buildGateEvidence,
  captureGateStart,
  computeToolchainFingerprint,
  computeTreeHash,
  verifyGateEvidence,
} from '../../scripts/lib/gate-evidence.mjs'
import { GATE_PASS_POLICY } from '../../src/evidence/gate-binding.js'

const BRANCH = 'task/#2328-evidence-binding'

/** The subset of GATE_EVIDENCE_TOOLCHAIN_INPUTS that `makeRepo()` creates. */
const FIXTURE_TOOLCHAIN_FILES = [
  'package.json',
  'package-lock.json',
  'node_modules/.package-lock.json',
  '.nvmrc',
] as const

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

/** A real git repo with the toolchain files the fingerprint hashes. */
function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-gate-ev-')))
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

/** Build a marker through the REAL writer path, then plant `overrides` on it. */
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

function verify(marker: unknown, root: string, opts: Record<string, unknown> = {}) {
  return verifyGateEvidence(marker, { root, minLevel: 'L2', maxAgeMin: 240, ...opts })
}

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString()
}

describe('#2328 gate-evidence binding — negative control', () => {
  it('accepts a marker the real writer just produced for this exact tree', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir), dir)
    expect(result).toEqual({ ok: true })
  })

  it('accepts it with the task id the marker actually carries', () => {
    const dir = track(makeRepo())
    expect(verify(markerFor(dir), dir, { taskId: '#2328' })).toEqual({ ok: true })
  })
})

describe('#2328 gate-evidence binding — shape and schema fail closed', () => {
  it.each([
    ['null', null],
    ['array', []],
    ['string', 'a stale marker'],
    ['number', 7],
  ] as const)('rejects a non-object marker: %s', (_label, value) => {
    const dir = track(makeRepo())
    const result = verify(value, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/JSON object/i)
  })

  it('rejects an OLD v1 marker verbatim — no grandfathering', () => {
    const dir = track(makeRepo())
    const v1 = {
      head_sha: git(dir, ['rev-parse', 'HEAD']),
      branch: BRANCH,
      task_id: '#2328',
      timestamp: new Date().toISOString(),
      level: 'L2',
      node_version: process.version,
      git_user: 'Arbiter Test',
      tree_was_clean_at_run_time: true,
    }
    const result = verify(v1, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/schema|missing or empty/i)
  })

  it('rejects a marker whose schema id is a different version', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { schema: 'arbiter-gate-pass-v1' }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/schema/i)
  })

  // The headline failure mode: an absent field must never read as unconstrained.
  it.each(GATE_EVIDENCE_STRING_FIELDS)('rejects a marker with %s deleted', (field: string) => {
    const dir = track(makeRepo())
    // Rebuilt without the field rather than deleted in place (no-dynamic-delete).
    const marker = Object.fromEntries(
      Object.entries(markerFor(dir)).filter(([key]) => key !== field),
    )
    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toContain(field)
  })

  it.each(GATE_EVIDENCE_STRING_FIELDS)(
    'rejects a marker with %s present but empty',
    (field: string) => {
      const dir = track(makeRepo())
      const result = verify(markerFor(dir, { [field]: '' }), dir)
      expect(result.ok).toBe(false)
      expect(String(result.reason)).toContain(field)
    },
  )

  it.each(GATE_EVIDENCE_STRING_FIELDS)('rejects a marker with %s set to null', (field: string) => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { [field]: null }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toContain(field)
  })

  it.each(GATE_EVIDENCE_STRING_FIELDS)(
    'rejects a marker with %s set to whitespace',
    (field: string) => {
      const dir = track(makeRepo())
      const result = verify(markerFor(dir, { [field]: '   ' }), dir)
      expect(result.ok).toBe(false)
      expect(String(result.reason)).toContain(field)
    },
  )
})

describe('#2328 gate-evidence binding — tree identity', () => {
  it('rejects evidence once a TRACKED file changed under an unchanged head_sha', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    const headBefore = git(dir, ['rev-parse', 'HEAD'])
    writeFileSync(join(dir, 'src.txt'), 'tampered\n')
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(headBefore)

    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/tree_hash/i)
  })

  it('rejects evidence once an UNTRACKED file appeared (the old boolean ignored these)', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    writeFileSync(join(dir, 'sneaked-in.txt'), 'not committed, not gated\n')

    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/tree_hash/i)
  })

  it('rejects evidence once a tracked file was deleted from the working tree', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    rmSync(join(dir, 'src.txt'))

    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/tree_hash/i)
  })

  it('rejects a marker carrying a forged tree_hash', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { tree_hash: 'f'.repeat(40) }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/tree_hash/i)
  })

  it("works in a repo that GITIGNORES .arbiter/ — arbiter's own shape", () => {
    // Regression: excluding `.arbiter` with a `:(exclude)` pathspec makes
    // `git add` refuse ("paths are ignored by one of your .gitignore files")
    // in exactly the repos that ignore their own runtime state, so the writer
    // silently produced NO marker and every consumer went dark.
    const dir = track(makeRepo())
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.arbiter/\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', 'ignore .arbiter'])

    const marker = markerFor(dir)
    expect(marker.tree_hash).toEqual(expect.any(String))
    expect(verify(marker, dir)).toEqual({ ok: true })

    // …and the axis still bites in that shape.
    writeFileSync(join(dir, 'src.txt'), 'tampered\n')
    expect(verify(marker, dir).ok).toBe(false)
  })

  it('is NOT disturbed by arbiter runtime state written under .arbiter/', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    mkdirSync(join(dir, '.arbiter', 'findings'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', 'findings', 'x.jsonl'), '{"k":1}\n')
    expect(verify(marker, dir)).toEqual({ ok: true })
  })

  it('still requires tree_was_clean_at_run_time to be true', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { tree_was_clean_at_run_time: false }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/tree_was_clean_at_run_time/i)
  })
})

describe('#2328 gate-evidence binding — checkout identity', () => {
  it('rejects evidence produced in worktree A when verified in worktree B', () => {
    const a = track(makeRepo())
    const b = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-gate-ev-b-'))))
    rmSync(b, { recursive: true, force: true })
    execFileSync('git', ['clone', '-q', a, b], { stdio: 'ignore' })
    git(b, ['config', 'user.email', 'test@arbiter.dev'])
    git(b, ['config', 'user.name', 'Arbiter Test'])
    // node_modules/ is ignored, so the clone does not carry it — recreate the
    // toolchain inputs so ONLY checkout_root can be the discriminator.
    mkdirSync(join(b, 'node_modules'), { recursive: true })
    writeFileSync(join(b, 'node_modules', '.package-lock.json'), JSON.stringify({ packages: {} }))

    const marker = markerFor(a)
    // Same commit, same branch, same content — only the physical checkout differs.
    expect(git(b, ['rev-parse', 'HEAD'])).toBe(git(a, ['rev-parse', 'HEAD']))
    expect(git(b, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      git(a, ['rev-parse', '--abbrev-ref', 'HEAD']),
    )
    expect(verify(marker, a)).toEqual({ ok: true })

    const result = verify(marker, b)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/checkout_root/i)
  })

  it('rejects a marker carrying a foreign checkout_root', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { checkout_root: '/nowhere/other-worktree' }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/checkout_root/i)
  })
})

describe('#2328 gate-evidence binding — toolchain identity', () => {
  it('rejects evidence after a lockfile change under an unchanged head_sha', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    const headBefore = git(dir, ['rev-parse', 'HEAD'])
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, x: 1 }))
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(headBefore)

    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/toolchain_fingerprint/i)
  })

  it('rejects evidence after the INSTALLED tree changed (hidden lockfile), tree untouched', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    // node_modules/ is gitignored: this changes the toolchain, never the tree hash.
    writeFileSync(
      join(dir, 'node_modules', '.package-lock.json'),
      JSON.stringify({ packages: { 'node_modules/evil': { version: '9.9.9' } } }),
    )

    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/toolchain_fingerprint/i)
  })

  // Only the inputs this fixture actually carries: removing a file that was
  // already absent is a no-op by design (an absent input hashes to a sentinel).
  it.each(FIXTURE_TOOLCHAIN_FILES)('rejects evidence once %s is removed', (relPath: string) => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    rmSync(join(dir, relPath), { force: true })
    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/toolchain_fingerprint|tree_hash/i)
  })

  it('bites in a NON-NODE project — the fingerprint is not a constant there', () => {
    // arbiter ships this verifier into Java/Python/Go/Rust repos too. With a
    // Node-only input list the fingerprint was sha256(absent, absent, …) for
    // every one of them: an axis present in the marker that could never flip.
    const dir = track(makeRepo())
    for (const nodeFile of ['package.json', 'package-lock.json', '.nvmrc']) {
      rmSync(join(dir, nodeFile), { force: true })
    }
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true })
    writeFileSync(join(dir, 'go.mod'), 'module example.com/fx\n\ngo 1.22\n')
    writeFileSync(join(dir, 'go.sum'), 'example.com/dep v1.0.0 h1:abc=\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', 'go project'])

    const marker = markerFor(dir)
    expect(verify(marker, dir)).toEqual({ ok: true })

    writeFileSync(join(dir, 'go.sum'), 'example.com/dep v1.0.1 h1:xyz=\n')
    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/toolchain_fingerprint|tree_hash/i)
  })

  it('hashes every declared toolchain input, not just the Node ones', () => {
    for (const rel of FIXTURE_TOOLCHAIN_FILES) {
      expect(GATE_EVIDENCE_TOOLCHAIN_INPUTS).toContain(rel)
    }
    // The list must span the stacks arbiter ships into, or the axis is inert there.
    for (const rel of ['pom.xml', 'pyproject.toml', 'go.sum', 'Cargo.lock']) {
      expect(GATE_EVIDENCE_TOOLCHAIN_INPUTS).toContain(rel)
    }
  })

  it('gives two DIFFERENT projects two different fingerprints', () => {
    // The all-absent sentinel value must not be the answer for whole ecosystems.
    const a = track(makeRepo())
    const b = track(makeRepo())
    writeFileSync(join(b, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, b: true }))
    expect(computeToolchainFingerprint(a)).not.toBe(computeToolchainFingerprint(b))
  })

  it('rejects a marker carrying a forged toolchain_fingerprint', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { toolchain_fingerprint: 'sha256:deadbeef' }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/toolchain_fingerprint/i)
  })

  it('rejects a marker stamped under a different node version', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { node_version: 'v0.0.1' }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/node_version/i)
  })
})

describe('#2328 gate-evidence binding — TTL', () => {
  it('rejects evidence older than the consumer budget', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { timestamp: minutesAgo(300) }), dir, { maxAgeMin: 240 })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/expired|old/i)
  })

  it('honours a SHORTER ttl_minutes carried by the marker itself', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir, { timestamp: minutesAgo(30), ttl_minutes: 10 })
    const result = verify(marker, dir, { maxAgeMin: 240 })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/expired|old/i)
  })

  it('refuses to let a forged ttl_minutes widen the consumer budget', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir, { timestamp: minutesAgo(300), ttl_minutes: 1_000_000 })
    const result = verify(marker, dir, { maxAgeMin: 240 })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/expired|old/i)
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
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    if (value === undefined) delete marker.ttl_minutes
    else marker.ttl_minutes = value
    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/ttl_minutes/i)
  })

  it('rejects a marker timestamped in the future', () => {
    const dir = track(makeRepo())
    const future = new Date(Date.now() + 60 * 60_000).toISOString()
    const result = verify(markerFor(dir, { timestamp: future }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/future/i)
  })

  it('rejects a marker whose timestamp is not a date', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { timestamp: 'yesterday-ish' }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/timestamp/i)
  })
})

describe('#2328 gate-evidence binding — level', () => {
  it('rejects evidence recorded at a level below the one the consumer requires', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { level: 'L1' }), dir, { minLevel: 'L2' })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/level/i)
  })

  it('accepts evidence recorded ABOVE the required level', () => {
    const dir = track(makeRepo())
    const marker = buildGateEvidence({
      root: dir,
      level: 'L3',
      taskId: '#2328',
      start: captureGateStart(dir),
    })
    expect(verify(marker, dir, { minLevel: 'L2' })).toEqual({ ok: true })
  })

  it('rejects an unknown level rather than treating it as sufficient', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { level: 'LX' }), dir, { minLevel: 'L2' })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/level/i)
  })
})

describe('#2328 gate-evidence binding — commit and task correlation', () => {
  it('rejects a marker for a different head_sha', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { head_sha: 'a'.repeat(40) }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/head_sha/i)
  })

  it('rejects a marker for a different branch', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { branch: 'task/other' }), dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/branch/i)
  })

  it('rejects a marker from a prior task when a task id is required (anti-replay)', () => {
    const dir = track(makeRepo())
    const result = verify(markerFor(dir, { task_id: '#1' }), dir, { taskId: '#2328' })
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/task_id/i)
  })
})

describe('#2328 gate-evidence binding — writer fails closed', () => {
  it('refuses to build evidence outside a git checkout', () => {
    const dir = track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-gate-nogit-'))))
    expect(
      buildGateEvidence({ root: dir, level: 'L2', taskId: '#2328', start: captureGateStart(dir) }),
    ).toBeNull()
  })

  /**
   * Plant "the tree hash cannot be computed" in a way NO uid can bypass.
   *
   * A required `clean` filter that exits non-zero makes `git add` fail on
   * config, not on permissions — root is refused exactly like anyone else —
   * while `git rev-parse HEAD` keeps working, so ONLY the tree computation
   * breaks. The previous chmod-based plant (`.git/objects` 0o500) was inert
   * under root: mode bits do not restrain uid 0, so the writer returned a real
   * hash and the test asserted on an unplanted defect. It passed locally and
   * could only ever fail in CI, which runs as root.
   *
   * The precondition below is the loud part: if the plant ever stops biting,
   * this fails with a named reason instead of silently testing nothing.
   */
  function plantUnhashableTree(dir: string): void {
    writeFileSync(join(dir, '.gitattributes'), '* filter=arbiter-unhashable\n')
    git(dir, ['config', 'filter.arbiter-unhashable.clean', 'exit 1'])
    git(dir, ['config', 'filter.arbiter-unhashable.required', 'true'])

    const probeIndex = join(
      track(realpathSync(mkdtempSync(join(tmpdir(), 'arbiter-plant-probe-')))),
      'index',
    )
    const probe = spawnSync('git', ['add', '-A'], {
      cwd: dir,
      env: { ...process.env, GIT_INDEX_FILE: probeIndex },
      encoding: 'utf-8',
    })
    expect(
      probe.status,
      `plant did not take effect (uid ${process.getuid?.() ?? '?'}): git add still succeeds`,
    ).not.toBe(0)
  }

  it('refuses to build evidence when the tree hash cannot be computed', () => {
    // The writer's null-guard is the LOCAL fail-closed guarantee for
    // computeTreeHash's `catch { return null }` — it must not depend on a
    // downstream consumer noticing a blank axis.
    const dir = track(makeRepo())
    plantUnhashableTree(dir)

    expect(computeTreeHash(dir)).toBeNull()
    // HEAD still resolves — only the tree computation is broken.
    expect(git(dir, ['rev-parse', 'HEAD'])).toMatch(/^[0-9a-f]{40}$/)
    expect(
      buildGateEvidence({ root: dir, level: 'L2', taskId: '#2328', start: captureGateStart(dir) }),
    ).toBeNull()
  })

  it('rejects a marker whose tree hash cannot be recomputed at verify time', () => {
    const dir = track(makeRepo())
    const marker = markerFor(dir)
    plantUnhashableTree(dir)

    const result = verify(marker, dir)
    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/unverifiable|tree/i)
  })

  it('stamps every field the verifier requires', () => {
    const dir = track(makeRepo())
    const marker = buildGateEvidence({
      root: dir,
      level: 'L2',
      taskId: '#2328',
      start: captureGateStart(dir),
    }) as Marker
    for (const field of GATE_EVIDENCE_STRING_FIELDS) {
      expect(typeof marker[field], `field ${field}`).toBe('string')
      expect(String(marker[field]).trim().length, `field ${field}`).toBeGreaterThan(0)
    }
    expect(marker.schema).toBe(GATE_EVIDENCE_SCHEMA)
    expect(marker.ttl_minutes).toBe(GATE_EVIDENCE_DEFAULT_TTL_MIN)
    expect(marker.tree_was_clean_at_run_time).toBe(true)
  })
})

/**
 * The engine (`arbiter task advance`) must NOT delegate its verdict to a script
 * inside the tree it is gating, so `src/evidence/gate-binding.ts` carries its
 * own copy of the policy. This test is what stops the two copies from drifting
 * into a gate that validates nothing.
 */
describe('#2328 gate-evidence binding — engine/script policy parity', () => {
  it('pins the same schema id, TTL, level ranking and required fields', () => {
    expect(GATE_PASS_POLICY.schema).toBe(GATE_EVIDENCE_SCHEMA)
    expect(GATE_PASS_POLICY.defaultTtlMinutes).toBe(GATE_EVIDENCE_DEFAULT_TTL_MIN)
    expect(GATE_PASS_POLICY.levelRank).toEqual(GATE_EVIDENCE_LEVEL_RANK)
    expect([...GATE_PASS_POLICY.stringFields]).toEqual([...GATE_EVIDENCE_STRING_FIELDS])
    expect([...GATE_PASS_POLICY.toolchainInputs]).toEqual([...GATE_EVIDENCE_TOOLCHAIN_INPUTS])
    expect(GATE_PASS_POLICY.futureSkewMinutes).toBe(GATE_EVIDENCE_FUTURE_SKEW_MIN)
  })
})
