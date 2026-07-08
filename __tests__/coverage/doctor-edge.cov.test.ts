// SPDX-License-Identifier: Apache-2.0
/**
 * Edge-branch coverage climb for src/commands/doctor.ts (#1486).
 *
 * Companion to doctor.cov.test.ts — that suite owns the human-readable emit
 * paths, the coherence missing-field branches, gate-pass parse errors, the
 * task-document branches and the doctor-clean fs/dry-run/realpath branches.
 *
 * This file covers the conditionals BOTH the established suite and doctor.cov
 * leave cold:
 *   • checkNodeVersion FAIL branch (node < 22) + the `?? '0'` empty-split guard
 *   • hasWorkflowFiles `.yaml` alternative + non-CI-file false branch
 *   • readLockInfoForHealth wrong-shape → null branch
 *   • probePidAlive EPERM → null branch
 *   • checkGatePassLog non-Error parse-error stringify branch
 *   • checkChannelSetting non-Error stringify branch
 *   • checkTaskDocument non-Error catch stringify branch
 *   • default-dir (`opts.dir ?? '.'`) branches in all four runDoctor* entrypoints
 *   • repairStaleLockInChecks `!info` (WARN but unreadable lock) branch +
 *     non-Error generic-Error hint branch
 *   • runDoctorRepairState loadConfig === null branch (json + human-readable)
 *   • collectBackups EACCES swallow branch + non-ENOENT/EACCES re-throw branch
 *
 * Determinism: git is stubbed via the run-cli mock;
 * forceReleaseLock is wrapped; loadConfig is wrapped so one test can force null;
 * process.exit is never reached (no command path calls it); no real network/git.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import os from 'node:os'
import { join } from 'node:path'
import type { LockInfo } from '../../src/utils/file-lock.js'
import type { HealthCheck } from '../../src/commands/doctor.js'

// ── module mocks ──────────────────────────────────────────────────────────────
// git is stubbed; the default mock reports a healthy `git --version`.
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(() => ({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })),
  CliError: class CliError extends Error {
    notFound = false
  },
}))

// forceReleaseLock is wrapped so one test can force a NON-ArbiterError failure.
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

// loadConfig is wrapped so one repair-state test can force the `config === null`
// branch (which the real loadConfig only takes for an ABSENT file — it throws on
// malformed JSON, so the file-present-but-null state is otherwise unreachable).
const configMock = vi.hoisted(() => ({ forceNull: false }))
vi.mock('../../src/utils/config.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/utils/config.js')>('../../src/utils/config.js')
  return {
    ...actual,
    loadConfig: (dir: string): ReturnType<typeof actual.loadConfig> =>
      configMock.forceNull ? null : actual.loadConfig(dir),
  }
})

// resolveChannel is wrapped so one test can force it to throw a NON-Error,
// driving checkChannelSetting's `err instanceof Error ? ... : String(err)`
// false branch (loadConfig always wraps its failures in a ConfigError, so the
// non-Error arm is otherwise unreachable through the public entrypoint).
const channelMock = vi.hoisted(() => ({ throwNonError: false }))
vi.mock('../../src/utils/channel.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/utils/channel.js')>('../../src/utils/channel.js')
  return {
    ...actual,
    resolveChannel: (
      opts: Parameters<typeof actual.resolveChannel>[0],
    ): ReturnType<typeof actual.resolveChannel> => {
      if (channelMock.throwNonError) throw 'channel-string-error'
      return actual.resolveChannel(opts)
    },
  }
})

// node:fs is wrapped so the doctor-clean readdir error branches can be driven
// deterministically. ESM namespaces are non-configurable, so vi.spyOn cannot
// replace readdirSync — a module mock with a toggle is the portable seam. Every
// other fs export delegates to the genuine implementation.
const fsMock = vi.hoisted(() => ({ readdirError: null as NodeJS.ErrnoException | null }))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: actual,
    readdirSync: ((...args: Parameters<typeof actual.readdirSync>) => {
      if (fsMock.readdirError !== null) throw fsMock.readdirError
      return (actual.readdirSync as (...a: unknown[]) => unknown)(...args)
    }) as typeof actual.readdirSync,
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

/** Capture process.stdout/stderr writes so human-readable branches run silently. */
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
  mockRunCli.mockReturnValue({
    stdout: 'git version 2.40\n',
    stderr: '',
    exitCode: 0,
    durationMs: 0,
  })
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

function findCheck(checks: HealthCheck[], id: string): HealthCheck | undefined {
  return checks.find((c: HealthCheck) => c.id === id)
}

// ── checkNodeVersion FAIL branch (node < 22) ──────────────────────────────────

describe('runDoctorHealth — checkNodeVersion FAIL / empty-split branches', () => {
  let dir: string
  const realNode = process.versions.node
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-node-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => {
    // Restore the genuine node version so no later test sees the stub.
    Object.defineProperty(process.versions, 'node', { value: realNode, configurable: true })
    rmSync(dir, { recursive: true, force: true })
  })

  it('FAILs with an upgrade hint when the major version is below 22', async () => {
    Object.defineProperty(process.versions, 'node', { value: '18.19.0', configurable: true })
    const result = await runDoctorHealth({ dir, json: true })
    const node = findCheck(result.checks, 'node-version')
    expect(node?.status).toBe('FAIL')
    expect(node?.detail).toMatch(/found 18\.19\.0/)
    expect(node?.hint).toMatch(/Upgrade to Node\.js/)
    expect(result.exitCode).toBe(1)
  })

  it('treats an empty version string as major 0 (?? \'0\' fallback) → FAIL', async () => {
    // An empty string splits to [''] whose [0] is '' — parseInt('',10) is NaN, but
    // the `?? '0'` only fires when the element is undefined. An empty-prefix value
    // like ".5.5" yields a leading-empty segment → parseInt('') → NaN < 22 → FAIL.
    Object.defineProperty(process.versions, 'node', { value: '', configurable: true })
    const result = await runDoctorHealth({ dir, json: true })
    const node = findCheck(result.checks, 'node-version')
    expect(node?.status).toBe('FAIL')
  })
})

// ── hasWorkflowFiles .yaml alternative + non-CI-file false branch ─────────────

describe('checkAutonomyCoherence — workflow-file CI signal branches', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-ci-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('detects a .yaml workflow file (the .yml || .yaml alternative) → coherent with CI', async () => {
    // L4 governance + autonomy L1 is coherent; a .yaml file proves CI presence so
    // the "no CI" CRITICAL never fires and detail reports CI: yes.
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ automation: { autonomy: 'L1' }, governanceLevel: 'L2' }),
    )
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yaml'), 'name: ci\n', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'autonomy-coherence')
    expect(c?.detail).toMatch(/CI: yes/)
  })

  it('useGitHub:true but workflows dir holds only a non-workflow file → CI drift WARN', async () => {
    // A README.md in the workflows dir does not end in .yml/.yaml → hasWorkflowFiles
    // false; useGitHub true → the CI-config-drift WARN branch.
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        automation: { autonomy: 'L1' },
        governanceLevel: 'L2',
        useGitHub: true,
      }),
    )
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(dir, '.github', 'workflows', 'README.md'), '# not a workflow\n', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const c = findCheck(result.checks, 'autonomy-coherence')
    expect(c?.status).toBe('WARN')
    expect(c?.detail).toMatch(/CI config drift/)
    expect(c?.hint).toMatch(/Add a workflow/)
  })
})

// ── readLockInfoForHealth wrong-shape branch + probePidAlive EPERM branch ─────

describe('checkLockfile — malformed-shape + EPERM pid-probe branches', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-lock-'))
    vi.clearAllMocks()
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('WARNs when the lock file is valid JSON but the wrong shape (pid not a number)', async () => {
    // Valid JSON, parses fine, but `pid` is a string → readLockInfoForHealth's
    // shape check fails → returns null → the "unreadable" WARN branch.
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', '.lock'),
      JSON.stringify({
        pid: 'not-a-number',
        hostname: os.hostname(),
        bootId: 'b',
        startedAt: new Date().toISOString(),
        cmd: 'x',
        nonce: 'n',
      }),
      'utf-8',
    )
    const result = await runDoctorHealth({ dir, json: true })
    const lock = findCheck(result.checks, 'arbiter-lock')
    expect(lock?.status).toBe('WARN')
    expect(lock?.detail).toMatch(/not valid JSON/)
    expect(lock?.hint).toMatch(/recover-lock/)
  })

  it('treats an EPERM pid-probe as alive-unknown (null) → an active same-host lock is PASS', async () => {
    // Stub process.kill so the same-host pid probe throws EPERM → probePidAlive
    // returns null → pidAlive===null, fresh startedAt → not stale → active PASS.
    const realKill = process.kill.bind(process)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?) => {
      if (signal === 0) {
        const e = new Error('operation not permitted') as NodeJS.ErrnoException
        e.code = 'EPERM'
        throw e
      }
      return realKill(pid, signal)
    })
    try {
      writeLockFile(dir, { pid: 4242, startedAt: new Date(Date.now() - 1000).toISOString() })
      const result = await runDoctorHealth({ dir, json: true })
      const lock = findCheck(result.checks, 'arbiter-lock')
      expect(lock?.status).toBe('PASS')
      expect(lock?.label).toMatch(/active/)
    } finally {
      killSpy.mockRestore()
    }
  })
})

// ── checkGatePassLog non-Error stringify branch ───────────────────────────────

describe('checkGatePassLog — non-Error parse failure stringify branch', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-gp-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
  })

  it('stringifies a non-Error thrown by JSON.parse (the `: String(err)` branch)', async () => {
    // Stub JSON.parse so the gate-pass line parse throws a NON-Error (a string).
    // arbiter.json is read via JSON.parse too, so the stub must let valid config
    // through and only blow up on the sentinel gate-pass payload.
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    const sentinel = 'THROW_STRING_SENTINEL'
    writeFileSync(join(dir, '.arbiter', 'gate-pass.jsonl'), sentinel + '\n', 'utf-8')
    const realParse = JSON.parse.bind(JSON)
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?) => {
      if (text === sentinel) throw 'string-not-error-object'
      return realParse(text, reviver)
    })
    try {
      const result = await runDoctorHealth({ dir, json: true })
      const gp = findCheck(result.checks, 'gate-pass-log')
      expect(gp?.status).toBe('WARN')
      expect(gp?.detail).toMatch(/unparseable/)
      expect(gp?.detail).toMatch(/string-not-error-object/)
    } finally {
      parseSpy.mockRestore()
    }
  })
})

// ── checkChannelSetting non-Error stringify branch ────────────────────────────

describe('checkChannelSetting — non-Error throw stringify branch', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-ch-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => {
    channelMock.throwNonError = false
    rmSync(dir, { recursive: true, force: true })
  })

  it('FAILs with String(err) when resolveChannel throws a non-Error', async () => {
    // Valid arbiter.json so loadConfig succeeds; the wrapped resolveChannel then
    // throws a STRING (not an Error), so checkChannelSetting takes the `: String(err)`
    // arm and reports the raw value as the detail.
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    channelMock.throwNonError = true
    const result = await runDoctorHealth({ dir, json: true })
    const ch = findCheck(result.checks, 'release-channel')
    expect(ch?.status).toBe('FAIL')
    expect(ch?.detail).toBe('channel-string-error')
    expect(ch?.hint).toMatch(/arbiter init/i)
    expect(result.exitCode).toBe(1)
  })
})

// ── checkTaskDocument non-Error catch stringify branch ────────────────────────

describe('checkTaskDocument — non-Error catch stringify branch', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-task-'))
    vi.clearAllMocks()
    mockGitOk()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('WARNs with String(err) when status.json parsing throws a non-Error', async () => {
    mkdirSync(join(dir, '.claude', '.task'), { recursive: true })
    const sentinel = 'TASK_THROW_STRING'
    writeFileSync(join(dir, '.claude', '.task', 'status.json'), sentinel, 'utf-8')
    const realParse = JSON.parse.bind(JSON)
    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?) => {
      if (text === sentinel) throw 'task-string-error'
      return realParse(text, reviver)
    })
    try {
      const result = await runDoctorHealth({ dir, json: true })
      const t = findCheck(result.checks, 'task-document')
      expect(t?.status).toBe('WARN')
      expect(t?.detail).toMatch(/not valid JSON/)
      expect(t?.detail).toMatch(/task-string-error/)
    } finally {
      parseSpy.mockRestore()
    }
  })
})

// ── default-dir (`opts.dir ?? '.'`) branches across entrypoints ───────────────

describe('default-dir branches — opts.dir omitted resolves to cwd', () => {
  let prevCwd: string
  let scratch: string
  let cap: Captured
  beforeEach(() => {
    vi.clearAllMocks()
    mockGitOk()
    useRealForceRelease()
    // chdir into an empty scratch dir so the default-`.` runs touch nothing real.
    scratch = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-cwd-'))
    prevCwd = process.cwd()
    process.chdir(scratch)
    cap = captureStdio()
  })
  afterEach(() => {
    cap.restore()
    process.chdir(prevCwd)
    rmSync(scratch, { recursive: true, force: true })
  })

  it('runDoctorHealth() with no dir resolves to cwd and returns a result', async () => {
    const result = await runDoctorHealth({ json: true })
    expect(result.checks.length).toBeGreaterThan(0)
    // No arbiter.json in the scratch dir → no project checks, exit 0.
    expect(result.exitCode).toBe(0)
  })

  it('runDoctorRepairState() with no dir resolves to cwd (arbiter.json absent → exit 2)', async () => {
    const result = await runDoctorRepairState({ json: true })
    expect(result.exitCode).toBe(2)
    expect(result.repaired).toBe(false)
  })

  it('runDoctorRecoverLock() with no dir resolves to cwd (no lock → found:false)', async () => {
    const result = await runDoctorRecoverLock({ json: true })
    expect(result.found).toBe(false)
    expect(result.released).toBe(false)
  })

  it('runDoctorClean() with no dir resolves to cwd (no backups found)', () => {
    const result = runDoctorClean({ json: true })
    expect(result.found).toEqual([])
    expect(result.deleted).toEqual([])
  })
})

// ── repairStaleLockInChecks — !info (WARN but unreadable) + generic-Error hint ─

describe('repairStaleLockInChecks — unreadable-lock + non-Error hint branches', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-rep-'))
    vi.clearAllMocks()
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('skips repair (returns undefined) when the lock WARNs but is unreadable on re-read', async () => {
    // A wrong-shape lock yields the "unreadable" WARN. --repair then re-reads it via
    // readLockInfoForHealth → null → the `if (!info) return undefined` branch fires;
    // no forceReleaseLock call, no `repaired` record.
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(
      join(dir, '.arbiter', '.lock'),
      JSON.stringify({ pid: 'nope', hostname: os.hostname() }),
      'utf-8',
    )
    const result = await runDoctorHealth({ dir, json: true, repair: true })
    expect(result.repaired).toBeUndefined()
    expect(forceReleaseSpy).not.toHaveBeenCalled()
    const lock = findCheck(result.checks, 'arbiter-lock')
    expect(lock?.status).toBe('WARN')
  })

  it('non-Error rejection from forceReleaseLock → generic String(err) hint branch', async () => {
    // A NON-Error rejection (a string) makes both `instanceof ArbiterError` and
    // `instanceof Error` false → the final `String(err)` arm of the hint.
    forceReleaseSpy.mockRejectedValue('string-rejection-not-error')
    writeLockFile(dir, { pid: 999_999_999 })
    const result = await runDoctorHealth({ dir, json: true, repair: true })
    expect(result.repaired).toBeUndefined()
    const lock = findCheck(result.checks, 'arbiter-lock')
    expect(lock?.status).toBe('WARN')
    expect(lock?.hint).toMatch(/auto-repair failed: string-rejection-not-error/)
  })
})

// ── runDoctorRepairState loadConfig === null branch ───────────────────────────

describe('runDoctorRepairState — loadConfig null branch (json + human-readable)', () => {
  let dir: string
  let cap: Captured
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-rs-'))
    vi.clearAllMocks()
    cap = captureStdio()
  })
  afterEach(() => {
    configMock.forceNull = false
    cap.restore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exits 2 with a JSON error when loadConfig returns null despite arbiter.json present', async () => {
    await saveConfig(dir, defaultConfig())
    expect(existsSync(join(dir, 'arbiter.json'))).toBe(true)
    configMock.forceNull = true
    const result = await runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(2)
    expect(result.repaired).toBe(false)
    expect(cap.out).toMatch(/"status":\s*"error"/)
    expect(cap.out).toMatch(/failed to load/)
  })

  it('writes a stderr error (exit 2) when loadConfig returns null and json is falsy', async () => {
    await saveConfig(dir, defaultConfig())
    configMock.forceNull = true
    const result = await runDoctorRepairState({ dir })
    expect(result.exitCode).toBe(2)
    expect(cap.err).toMatch(/Error: failed to load/)
  })
})

// ── collectBackups EACCES swallow + non-ENOENT/EACCES re-throw branches ───────

describe('runDoctorClean — readdir EACCES swallow + re-throw branches', () => {
  let dir: string
  afterEach(() => {
    fsMock.readdirError = null
    rmSync(dir, { recursive: true, force: true })
  })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-clean-'))
    vi.clearAllMocks()
  })

  it('swallows an EACCES readdir error and returns empty results', () => {
    // The wrapped readdirSync throws EACCES → collectBackups returns early
    // (the EACCES arm of `code === ENOENT || code === EACCES`).
    const eacces = new Error('permission denied') as NodeJS.ErrnoException
    eacces.code = 'EACCES'
    fsMock.readdirError = eacces
    const result = runDoctorClean({ dir })
    expect(result.found).toEqual([])
    expect(result.deleted).toEqual([])
  })

  it('re-throws a readdir error whose code is neither ENOENT nor EACCES', () => {
    const eloop = new Error('too many symbolic links') as NodeJS.ErrnoException
    eloop.code = 'ELOOP'
    fsMock.readdirError = eloop
    expect(() => runDoctorClean({ dir })).toThrow(/too many symbolic links/)
  })

  it('matches the timestamped .arbiter-generated.json.bak. backup pattern', () => {
    // Exercises the regex arm of isBackupFile (the `.endsWith('.arbiter-backup')`
    // OR the bak-regex) so the second predicate is evaluated true.
    const f = join(dir, '.arbiter-generated.json.bak.2026-01-02T03-04-05-000Z')
    writeFileSync(f, 'x', 'utf-8')
    const result = runDoctorClean({ dir, dryRun: true })
    expect(result.found).toHaveLength(1)
    expect(result.found[0]).toMatch(/\.arbiter-generated\.json\.bak\./)
  })

  it('skips a regular file that is not a backup (the isFile-but-not-backup else)', () => {
    // A plain .txt is a file but not a backup → collectBackups walks past it
    // without pushing (the false side of `entry.isFile() && isBackupFile(...)`).
    writeFileSync(join(dir, 'notes.txt'), 'x', 'utf-8')
    const result = runDoctorClean({ dir, dryRun: true })
    expect(result.found).toEqual([])
  })
})

// ── checkArbiterProject — git-unavailable-but-project-present branch ───────────

describe('checkArbiterProject — git unavailable while arbiter.json present', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doc-edge-nogit-'))
    vi.clearAllMocks()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('skips the hooks-path check (the `if (gitOk)` else) when git is not in PATH', async () => {
    // git --version throws → gitOk false → the hooks-path check is never pushed,
    // but the rest of the project checks (agents-md, lock, coherence) still run.
    mockRunCli.mockImplementation(() => {
      throw new Error('git not found')
    })
    const result = await runDoctorHealth({ dir, json: true })
    const git = findCheck(result.checks, 'git-available')
    expect(git?.status).toBe('FAIL')
    expect(findCheck(result.checks, 'hooks-path')).toBeUndefined()
    // The project block still produced its other checks.
    expect(findCheck(result.checks, 'agents-md')).toBeDefined()
    expect(findCheck(result.checks, 'arbiter-lock')).toBeDefined()
  })
})
