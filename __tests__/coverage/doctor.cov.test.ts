// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/commands/doctor.ts (#1486).
 *
 * Targets the conditionals the established doctor.test.ts suite leaves cold:
 * non-JSON (human-readable) output paths, the gate-pass parse-error branch,
 * task-document invalid-phase / corrupt-JSON branches, the hooks-path WARN,
 * overlay/autonomy "governanceLevel missing" branches, collab-coherence
 * CRITICAL→FAIL, the --repair force-release failure branches, and the
 * doctor-clean fs-error / dry-run / realpath-fallback branches.
 *
 * All stdout/stderr is captured (never asserted on Date.now); git is stubbed
 * via the run-cli mock; no real network or git calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import os from 'node:os'
import { join } from 'node:path'
import type { LockInfo } from '../../src/utils/file-lock.js'

// ── module mocks ──────────────────────────────────────────────────────────────
// git is stubbed; the default mock reports a healthy `git --version`.
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(() => ({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })),
  CliError: class CliError extends Error {
    notFound = false
  },
}))

// forceReleaseLock is wrapped so one test can force a NON-ArbiterError failure
// (exercising the generic-Error branch of repairStaleLockInChecks). Every other
// test uses the real implementation, which the spy delegates to by default.
// vi.hoisted keeps the shared spy/holder out of the hoisted-mock TDZ.
type ForceRelease = (p: string, pid: number, root?: string) => Promise<void>
const lockMock = vi.hoisted(() => {
  const real: { fn: ForceRelease } = { fn: () => Promise.resolve() }
  return { spy: vi.fn<ForceRelease>(), real }
})
const forceReleaseSpy = lockMock.spy
vi.mock('../../src/utils/file-lock.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/utils/file-lock.js')>(
      '../../src/utils/file-lock.js',
    )
  lockMock.real.fn = actual.forceReleaseLock
  lockMock.spy.mockImplementation((p, pid, root) => lockMock.real.fn(p, pid, root))
  return {
    ...actual,
    forceReleaseLock: (p: string, pid: number, root?: string): Promise<void> =>
      lockMock.spy(p, pid, root),
  }
})

import { runCli } from '../../src/utils/run-cli.js'
import {
  runDoctorHealth,
  runDoctorRepairState,
  runDoctorRecoverLock,
  runDoctorClean,
} from '../../src/commands/doctor.js'
import { saveConfig } from '../../src/utils/config.js'
import { defaultConfig } from '../helpers/default-config.js'

const mockRunCli = vi.mocked(runCli)

interface Captured {
  out: string
  err: string
  restore: () => void
}

/** Capture process.stdout/stderr writes so human-readable branches run without noise. */
function captureStdio(): Captured {
  const captured: Captured = { out: '', err: '', restore: () => {} }
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      captured.out += typeof chunk === 'string' ? chunk : chunk.toString()
      return true
    })
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      captured.err += typeof chunk === 'string' ? chunk : chunk.toString()
      return true
    })
  captured.restore = (): void => {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
  return captured
}

function mockGitOk(): void {
  mockRunCli.mockReturnValue({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })
}

/** Re-arm the spy to delegate to the genuine forceReleaseLock (clearAllMocks wipes it). */
function useRealForceRelease(): void {
  forceReleaseSpy.mockImplementation((p, pid, root) => lockMock.real.fn(p, pid, root))
}

function writeLockFile(dir: string, overrides: Partial<LockInfo> = {}): LockInfo {
  mkdirSync(join(dir, '.arbiter'), { recursive: true })
  const info: LockInfo = {
    pid: 12345,
    hostname: os.hostname(),
    bootId: 'test-boot-id',
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    cmd: 'arbiter update',
    nonce: 'aabbccdd',
    ...overrides,
  }
  writeFileSync(join(dir, '.arbiter', '.lock'), JSON.stringify(info), 'utf-8')
  return info
}

// ── runDoctorHealth: human-readable (non-JSON) emit path ──────────────────────

describe('runDoctorHealth — human-readable emit branches', () => {
  let dir: string
  let cap: Captured
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-h-'))
    vi.clearAllMocks()
    mockGitOk()
    cap = captureStdio()
  })
  afterEach(() => {
    cap.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits the [PASS]/[WARN] table and hint lines when json is falsy', async () => {
    // arbiter.json missing AGENTS.md → a WARN with a hint exercises the hint branch.
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = await runDoctorHealth({ dir })
    expect(result.exitCode).toBe(0)
    expect(cap.out).toMatch(/\[PASS]/)
    expect(cap.out).toMatch(/\[WARN]/)
    expect(cap.out).toMatch(/hint:/)
    expect(cap.out).toMatch(/passed,.*warnings,.*failed/)
  })

  it('prints the repaired banner on the human-readable path after a stale-lock --repair', async () => {
    useRealForceRelease()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeLockFile(dir, { pid: 999_999_999 })
    const result = await runDoctorHealth({ dir, repair: true })
    expect(result.repaired?.pid).toBe(999_999_999)
    expect(cap.out).toMatch(/repaired: released stale lock pid 999999999/)
    expect(existsSync(join(dir, '.arbiter', '.lock'))).toBe(false)
  })
})

// ── hooks-path WARN branch (core.hooksPath unset) ─────────────────────────────

describe('runDoctorHealth — hooks-path WARN branch', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-hooks-'))
    vi.clearAllMocks()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('WARNs when git is available but core.hooksPath is empty', async () => {
    // 1st call: git --version OK. 2nd call: git config core.hooksPath → empty stdout.
    mockRunCli
      .mockReturnValueOnce({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })
      .mockReturnValueOnce({ stdout: '\n', stderr: '', exitCode: 1, durationMs: 0 })
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const hooks = result.checks.find((c) => c.id === 'hooks-path')
    expect(hooks?.status).toBe('WARN')
    expect(hooks?.detail).toMatch(/not set/)
    expect(hooks?.hint).toMatch(/core\.hooksPath/)
  })

  it('WARNs when `git config core.hooksPath` itself throws (catch branch)', async () => {
    mockRunCli
      .mockReturnValueOnce({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })
      .mockImplementationOnce(() => {
        throw new Error('git config exploded')
      })
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const hooks = result.checks.find((c) => c.id === 'hooks-path')
    expect(hooks?.status).toBe('WARN')
  })
})

// ── coherence "governanceLevel missing" + CRITICAL branches ───────────────────

describe('runDoctorHealth — coherence missing-field / CRITICAL branches', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-coh-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('collab-coherence FAIL (+remediation hint) for a CRITICAL cell (trunk-solo @ L4)', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', governanceLevel: 'L4' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'collab-coherence')
    expect(c?.status).toBe('FAIL')
    expect(c?.hint).toBeTruthy()
    expect(result.exitCode).toBe(1)
  })

  it('overlay-coherence WARN when an overlay is set but governanceLevel is missing', async () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ industryOverlay: 'pharma' }))
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'overlay-coherence')
    expect(c?.status).toBe('WARN')
    expect(c?.detail).toMatch(/governanceLevel missing/)
    expect(c?.hint).toMatch(/arbiter update/)
  })

  it('autonomy-coherence WARN when autonomy is set but governanceLevel is missing', async () => {
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ automation: { autonomy: 'L1' } }))
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('WARN')
    expect(c?.detail).toMatch(/governanceLevel missing/)
    expect(c?.hint).toMatch(/arbiter update/)
  })

  it('profile-coherence WARN when governanceLevel is missing', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'peer-review', automation: { maxParallelWorktrees: 2 } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'profile-coherence')
    expect(c?.status).toBe('WARN')
    expect(c?.detail).toMatch(/governanceLevel missing/)
  })
})

// ── gate-pass log: parse-error branch ─────────────────────────────────────────

describe('runDoctorHealth — gate-pass parse-error branch', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-gp-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('WARNs and reports unparseable lines when gate-pass.jsonl has corrupt entries', async () => {
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    const lines = [
      JSON.stringify({ sha: 'abcdef0', signedAt: '2026-01-01T00:00:00Z', level: 'L2' }),
      '{ not valid json',
      'also-broken',
    ].join('\n')
    writeFileSync(join(dir, '.arbiter', 'gate-pass.jsonl'), lines + '\n', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const gp = result.checks.find((c) => c.id === 'gate-pass-log')
    expect(gp?.status).toBe('WARN')
    expect(gp?.detail).toMatch(/unparseable/)
    expect(gp?.hint).toMatch(/corrupt lines/)
  })

  it('PASS detail lists recent entries, defaulting missing sha/signedAt/level fields', async () => {
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    // An entry with NO fields exercises the (?? 'unknown' / '?') cond-exprs.
    writeFileSync(join(dir, '.arbiter', 'gate-pass.jsonl'), JSON.stringify({}) + '\n', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const gp = result.checks.find((c) => c.id === 'gate-pass-log')
    expect(gp?.status).toBe('PASS')
    expect(gp?.detail).toMatch(/unknown/)
  })
})

// ── task-document branches (#1206) ────────────────────────────────────────────

describe('runDoctorHealth — task-document branches', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-task-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function writeTaskStatus(content: string): void {
    mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
    writeFileSync(join(dir, '.claude', '.task', 'status.json'), content, 'utf-8')
  }

  it('WARNs on an invalid phase value', async () => {
    writeTaskStatus(JSON.stringify({ phase: 'not-a-real-phase', taskId: '#123' }))
    const result = await runDoctorHealth({ dir, json: true })
    const t = result.checks.find((c) => c.id === 'task-document')
    expect(t?.status).toBe('WARN')
    expect(t?.detail).toMatch(/invalid phase/)
    expect(t?.hint).toMatch(/arbiter task/)
  })

  it('PASS for a valid phase with a taskId', async () => {
    writeTaskStatus(JSON.stringify({ phase: 'red', taskId: '#777' }))
    const result = await runDoctorHealth({ dir, json: true })
    const t = result.checks.find((c) => c.id === 'task-document')
    expect(t?.status).toBe('PASS')
    expect(t?.detail).toMatch(/#777/)
  })

  it('PASS detail falls back to "(unset)" when taskId is absent', async () => {
    writeTaskStatus(JSON.stringify({ phase: 'red' }))
    const result = await runDoctorHealth({ dir, json: true })
    const t = result.checks.find((c) => c.id === 'task-document')
    expect(t?.status).toBe('PASS')
    expect(t?.detail).toMatch(/\(unset\)/)
  })

  it('WARNs when status.json is not valid JSON (catch branch)', async () => {
    writeTaskStatus('{ broken json')
    const result = await runDoctorHealth({ dir, json: true })
    const t = result.checks.find((c) => c.id === 'task-document')
    expect(t?.status).toBe('WARN')
    expect(t?.detail).toMatch(/not valid JSON/)
    expect(t?.hint).toMatch(/Delete .claude/)
  })
})

// ── channel check FAIL branch (#662) ──────────────────────────────────────────

describe('runDoctorHealth — channel FAIL branch', () => {
  let dir: string
  let cap: Captured
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-ch-'))
    vi.clearAllMocks()
    mockGitOk()
    cap = captureStdio()
  })
  afterEach(() => {
    cap.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('release-channel FAIL (with hint) on invalid arbiter.json, emitted human-readable', async () => {
    writeFileSync(join(dir, 'arbiter.json'), '{ invalid json }', 'utf-8')
    const result = await runDoctorHealth({ dir })
    const ch = result.checks.find((c) => c.id === 'release-channel')
    expect(ch?.status).toBe('FAIL')
    expect(ch?.hint).toMatch(/arbiter init/i)
    expect(result.exitCode).toBe(1)
    // human-readable FAIL row + hint line printed
    expect(cap.out).toMatch(/\[FAIL]/)
  })
})

// ── --repair force-release FAILURE branches ───────────────────────────────────

describe('runDoctorHealth --repair — force-release failure branches', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-rep-'))
    vi.clearAllMocks()
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('ArbiterError from forceReleaseLock leaves the WARN and sets an auto-repair-failed hint', async () => {
    // Real impl: a symlink at the lock path makes forceReleaseLock reject with an ArbiterError.
    useRealForceRelease()
    const lockDir = join(dir, '.arbiter')
    mkdirSync(lockDir, { recursive: true })
    const realLock = join(lockDir, 'real-lock')
    const info: LockInfo = {
      pid: 999_999_999, // dead pid → stale → WARN → repair attempted
      hostname: os.hostname(),
      bootId: 'b',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      cmd: 'arbiter update',
      nonce: 'aabbccdd',
    }
    writeFileSync(realLock, JSON.stringify(info), 'utf-8')
    symlinkSync(realLock, join(lockDir, '.lock'))

    const result = await runDoctorHealth({ dir, json: true, repair: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(result.repaired).toBeUndefined()
    expect(lockCheck?.status).toBe('WARN')
    expect(lockCheck?.hint).toMatch(/auto-repair failed/)
  })

  it('non-ArbiterError from forceReleaseLock falls into the generic-Error hint branch', async () => {
    forceReleaseSpy.mockRejectedValue(new Error('disk on fire'))
    writeLockFile(dir, { pid: 999_999_999 })
    const result = await runDoctorHealth({ dir, json: true, repair: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(result.repaired).toBeUndefined()
    expect(lockCheck?.status).toBe('WARN')
    expect(lockCheck?.hint).toMatch(/auto-repair failed: disk on fire/)
  })
})

// ── runDoctorRepairState: human-readable output branches ───────────────────────

describe('runDoctorRepairState — human-readable output branches', () => {
  let dir: string
  let cap: Captured
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-rs-'))
    vi.clearAllMocks()
    cap = captureStdio()
  })
  afterEach(() => {
    cap.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a stderr error (exit 2) when arbiter.json is missing and json is falsy', async () => {
    const result = await runDoctorRepairState({ dir })
    expect(result.exitCode).toBe(2)
    expect(result.repaired).toBe(false)
    expect(cap.err).toMatch(/Error: arbiter\.json not found/)
  })

  it('writes the snapshot banner + manifest warning to stdout/stderr on success (non-JSON)', async () => {
    await saveConfig(dir, defaultConfig())
    const result = await runDoctorRepairState({ dir })
    expect(result.exitCode).toBe(0)
    expect(result.repaired).toBe(true)
    expect(cap.out).toMatch(/snapshot re-derived from arbiter\.json/)
    expect(cap.err).toMatch(/generated-manifest/)
  })
})

// ── runDoctorRecoverLock: human-readable + different-host branches ─────────────

describe('runDoctorRecoverLock — human-readable + host branches', () => {
  let dir: string
  let cap: Captured
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-rl-'))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    vi.clearAllMocks()
    useRealForceRelease()
    cap = captureStdio()
  })
  afterEach(() => {
    cap.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('prints "No lock file found" when none exists (non-JSON)', async () => {
    const result = await runDoctorRecoverLock({ dir })
    expect(result.found).toBe(false)
    expect(cap.out).toMatch(/No lock file found/)
  })

  it('prints the lock detail table and "Lock released." for a same-host lock (non-JSON)', async () => {
    writeLockFile(dir, { pid: process.pid, hostname: os.hostname(), cmd: 'arbiter ship' })
    const result = await runDoctorRecoverLock({ dir })
    expect(result.found).toBe(true)
    expect(result.released).toBe(true)
    expect(cap.out).toMatch(/this host: yes/)
    expect(cap.out).toMatch(/Lock released\./)
  })

  it('reports "this host: no" for a different-host lock (non-JSON)', async () => {
    writeLockFile(dir, { pid: process.pid, hostname: 'some-other-host-not-real', cmd: 'x' })
    const result = await runDoctorRecoverLock({ dir })
    expect(result.found).toBe(true)
    expect(cap.out).toMatch(/this host: no/)
  })
})

// ── runDoctorClean: fs-error / dry-run / realpath / json branches ──────────────

describe('runDoctorClean — fs-error / dry-run / realpath / json branches', () => {
  let dir: string
  let cap: Captured
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-cov-clean-'))
    vi.clearAllMocks()
    cap = captureStdio()
  })
  afterEach(() => {
    cap.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns empty results for a non-existent directory (ENOENT swallowed)', () => {
    const missing = join(dir, 'does-not-exist')
    const result = runDoctorClean({ dir: missing })
    expect(result.found).toEqual([])
    expect(result.deleted).toEqual([])
  })

  it('recurses into nested dirs but skips node_modules / .git / dist', () => {
    // backup inside a normal subdir → found; backup inside node_modules → skipped.
    mkdirSync(join(dir, 'sub'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'settings.json.arbiter-backup'), 'x', 'utf-8')
    writeFileSync(join(dir, 'node_modules', 'pkg', 'a.arbiter-backup'), 'x', 'utf-8')
    const result = runDoctorClean({ dir, dryRun: false })
    expect(result.found).toHaveLength(1)
    expect(result.found[0]).toMatch(/sub/)
    expect(result.deleted).toHaveLength(1)
  })

  it('dry-run finds without deleting and emits JSON when json:true', () => {
    const f = join(dir, '.arbiter-generated.json.bak.2024-01-01T00-00-00-000Z')
    writeFileSync(f, 'x', 'utf-8')
    const result = runDoctorClean({ dir, dryRun: true, json: true })
    expect(result.found).toHaveLength(1)
    expect(result.deleted).toHaveLength(0)
    expect(existsSync(f)).toBe(true)
    expect(cap.out).toMatch(/"command":\s*"doctor clean"/)
  })

  it('falls back to the raw dir when realpathSync throws (broken symlink target)', () => {
    // A symlink whose target does not exist makes realpathSync throw → catch → rawDir.
    const broken = join(dir, 'broken-link')
    symlinkSync(join(dir, 'no-such-target'), broken)
    const result = runDoctorClean({ dir: broken })
    // rawDir is used; the broken path yields nothing to collect, no throw.
    expect(result.found).toEqual([])
    expect(result.deleted).toEqual([])
  })
})
