// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import os from 'node:os'
import { join } from 'node:path'
import {
  runDoctorRepairState,
  runDoctorHealth,
  runDoctorRecoverLock,
  runDoctorClean,
} from '../../src/commands/doctor.js'
import { saveConfig, saveConfigAndSnapshot } from '../../src/utils/config.js'
import { defaultConfig } from '../helpers/default-config.js'
import type { LockInfo } from '../../src/utils/file-lock.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    notFound = false
  },
}))

import { runCli } from '../../src/utils/run-cli.js'
const mockRunCli = vi.mocked(runCli)

// ── runDoctorHealth (#539) ────────────────────────────────────────────────────

describe('runDoctorHealth (#539)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doctorh-'))
    vi.clearAllMocks()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function mockGitOk(): void {
    mockRunCli.mockReturnValue({
      stdout: 'git version 2.40\n',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    })
  }
  function mockGitFail(): void {
    mockRunCli.mockImplementation(() => {
      throw new Error('git not found')
    })
  }

  it('PASS when node >= 22 and git available (no arbiter.json)', async () => {
    mockGitOk()
    const result = await runDoctorHealth({ dir, json: true })
    const nodeCheck = result.checks.find((c) => c.id === 'node-version')
    const gitCheck = result.checks.find((c) => c.id === 'git-available')
    expect(nodeCheck?.status).toBe('PASS')
    expect(gitCheck?.status).toBe('PASS')
    expect(result.fail).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('FAIL when git not available', async () => {
    mockGitFail()
    const result = await runDoctorHealth({ dir, json: true })
    const gitCheck = result.checks.find((c) => c.id === 'git-available')
    expect(gitCheck?.status).toBe('FAIL')
    expect(result.fail).toBe(1)
    expect(result.exitCode).toBe(1)
  })

  // ADR-051 (#1093): collaborationMode × governanceLevel coherence surfaced by doctor.
  it('collab-coherence PASS for a coherent cell (peer-review @ L2)', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'peer-review', governanceLevel: 'L2' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'collab-coherence')
    expect(c?.status).toBe('PASS')
  })

  it('collab-coherence WARN for an advisory cell (trunk-solo @ L3)', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'collab-coherence')
    expect(c?.status).toBe('WARN')
  })

  // #1254: industryOverlay × governanceLevel coherence surfaced by doctor.
  it('overlay-coherence PASS for a coherent cell (pharma @ L3)', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ industryOverlay: 'pharma', governanceLevel: 'L3' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'overlay-coherence')
    expect(c?.status).toBe('PASS')
  })

  it('overlay-coherence WARN for a heavy overlay under lenient governance (pharma @ L1)', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ industryOverlay: 'pharma', governanceLevel: 'L1' }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'overlay-coherence')
    expect(c?.status).toBe('WARN')
    expect(result.fail).toBe(0)
  })

  it('overlay-coherence PASS (not WARN) when no overlay is configured', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ governanceLevel: 'L1' }))
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'overlay-coherence')
    expect(c?.status).toBe('PASS')
    expect(result.fail).toBe(0)
  })

  // #1292 (ADR-093 §4): automation.autonomy × governanceLevel × CI coherence.
  function writeWorkflow(root: string): void {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
  }

  it('autonomy-coherence FAIL + exit 1 for L3 autonomy without CI, message names the fix', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L2', automation: { autonomy: 'L3' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('FAIL')
    expect(c?.detail).toMatch(/CI/)
    expect(c?.hint).toMatch(/L2|CI/)
    expect(result.exitCode).toBe(1)
  })

  it('autonomy-coherence FAIL + exit 1 for governance L4 + autonomy L3 even with CI', async () => {
    mockGitOk()
    writeWorkflow(dir)
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L4', automation: { autonomy: 'L3' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
  })

  it('autonomy-coherence PASS for governance L4 + autonomy L2 (exactly the ADR boundary)', async () => {
    mockGitOk()
    writeWorkflow(dir)
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L4', automation: { autonomy: 'L2' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('PASS')
  })

  it('autonomy-coherence PASS for L3 with workflow files on disk even when useGitHub is false', async () => {
    mockGitOk()
    writeWorkflow(dir)
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L2', useGitHub: false, automation: { autonomy: 'L3' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('PASS')
  })

  it('autonomy-coherence FAIL for L3 + useGitHub:true + EMPTY workflows dir (flag never rescues)', async () => {
    mockGitOk()
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L2', useGitHub: true, automation: { autonomy: 'L3' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
  })

  it('autonomy-coherence WARN for autonomy <= L2 + useGitHub:true + empty workflows dir (drift)', async () => {
    mockGitOk()
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L2', useGitHub: true, automation: { autonomy: 'L2' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('WARN')
    expect(result.fail).toBe(0)
  })

  it('autonomy-coherence PASS when the automation block is absent (defaults to L0)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ governanceLevel: 'L2' }))
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('PASS')
  })

  it('autonomy-coherence WARN for an unrecognized autonomy literal ("l3")', async () => {
    mockGitOk()
    writeWorkflow(dir)
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({ governanceLevel: 'L2', automation: { autonomy: 'l3' } }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('WARN')
  })

  it('autonomy-coherence WARN (never PASS) when arbiter.json is unreadable', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), '{not json', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'autonomy-coherence')
    expect(c?.status).toBe('WARN')
  })

  // #1306: profile-coherence (maxParallelWorktrees / defaultGateLevel) surfaced by doctor.
  it('profile-coherence FAIL: maxParallelWorktrees > 1 under trunk-solo', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        collaborationMode: 'trunk-solo',
        governanceLevel: 'L2',
        automation: { autonomy: 'L0', maxParallelWorktrees: 3 },
      }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'profile-coherence')
    expect(c?.status).toBe('FAIL')
  })

  it('profile-coherence WARN: defaultGateLevel L1 under L3 governance', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        collaborationMode: 'peer-review',
        governanceLevel: 'L3',
        automation: { autonomy: 'L0', defaultGateLevel: 'L1' },
      }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'profile-coherence')
    expect(c?.status).toBe('WARN')
  })

  it('profile-coherence PASS for a coherent profile', async () => {
    mockGitOk()
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        collaborationMode: 'peer-review',
        governanceLevel: 'L2',
        automation: { autonomy: 'L0', maxParallelWorktrees: 3, defaultGateLevel: 'L1' },
      }),
    )
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'profile-coherence')
    expect(c?.status).toBe('PASS')
  })

  it('profile-coherence WARN when arbiter.json is unreadable (crash-safe, RT-1306-08)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), '{not json', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const c = result.checks.find((x) => x.id === 'profile-coherence')
    expect(c?.status).toBe('WARN')
  })

  it('WARN when arbiter.json exists but AGENTS.md missing', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const agentsCheck = result.checks.find((c) => c.id === 'agents-md')
    expect(agentsCheck?.status).toBe('WARN')
    expect(result.fail).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('PASS when arbiter.json and AGENTS.md both present, hooks configured', async () => {
    mockRunCli
      .mockReturnValueOnce({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })
      .mockReturnValueOnce({ stdout: '.githooks\n', stderr: '', exitCode: 0, durationMs: 0 })
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const hooksCheck = result.checks.find((c) => c.id === 'hooks-path')
    expect(hooksCheck?.status).toBe('PASS')
    expect(hooksCheck?.detail).toContain('.githooks')
  })

  it('result has pass + warn + fail counts', async () => {
    mockGitOk()
    const result = await runDoctorHealth({ dir, json: true })
    expect(typeof result.pass).toBe('number')
    expect(typeof result.warn).toBe('number')
    expect(typeof result.fail).toBe('number')
    expect(result.pass + result.warn + result.fail).toBe(result.checks.length)
  })

  // #618 — doctor health reports stale lockfiles

  function writeLock(dir: string, overrides: Partial<LockInfo> = {}): void {
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
  }

  it('PASS arbiter-lock when no lock file exists (#618)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(lockCheck?.status).toBe('PASS')
    expect(lockCheck?.label).toMatch(/not present/i)
  })

  it('WARN arbiter-lock when lock PID is dead on same host (#618)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    // PID 1 may exist; use a high improbable PID
    writeLock(dir, { pid: 999_999_999 })
    const result = await runDoctorHealth({ dir, json: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(lockCheck?.status).toBe('WARN')
    expect(lockCheck?.hint).toMatch(/recover-lock/)
  })

  it('WARN arbiter-lock when lock age exceeds 6h on same host (#618)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeLock(dir, {
      pid: process.pid,
      startedAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
    })
    const result = await runDoctorHealth({ dir, json: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(lockCheck?.status).toBe('WARN')
  })

  it('PASS arbiter-lock when lock from a different host (#618)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeLock(dir, { hostname: 'some-other-host-not-real' })
    const result = await runDoctorHealth({ dir, json: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    // Different-host locks are reported as active (we can't tell if process is alive remotely).
    expect(lockCheck?.status).toBe('PASS')
    expect(lockCheck?.detail).toMatch(/other host/i)
  })

  it('WARN arbiter-lock when lock file is unreadable / invalid JSON (#618)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    writeFileSync(join(dir, '.arbiter', '.lock'), 'not-valid-json', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(lockCheck?.status).toBe('WARN')
  })

  // #824 — doctor health --repair auto-releases stale locks

  it('--repair releases stale lock and downgrades WARN → PASS (#824)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeLock(dir, { pid: 999_999_999 })
    const result = await runDoctorHealth({ dir, json: true, repair: true })
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(lockCheck?.status).toBe('PASS')
    expect(lockCheck?.label).toMatch(/auto-repaired/i)
    expect(result.repaired?.pid).toBe(999_999_999)
    expect(existsSync(join(dir, '.arbiter', '.lock'))).toBe(false)
  })

  it('--repair is a no-op when no lock exists (#824)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = await runDoctorHealth({ dir, json: true, repair: true })
    expect(result.repaired).toBeUndefined()
    const lockCheck = result.checks.find((c) => c.id === 'arbiter-lock')
    expect(lockCheck?.status).toBe('PASS')
    expect(lockCheck?.label).toMatch(/not present/i)
  })

  it('--repair is a no-op when lock is active (PASS, not WARN) (#824)', async () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeLock(dir, { pid: process.pid })
    const result = await runDoctorHealth({ dir, json: true, repair: true })
    expect(result.repaired).toBeUndefined()
    expect(existsSync(join(dir, '.arbiter', '.lock'))).toBe(true)
  })
})

// ── runDoctorRepairState (#619) ───────────────────────────────────────────────

describe('runDoctorRepairState (#619)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('exit 2 + no write when arbiter.json missing', async () => {
    const result = await runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(2)
    expect(result.repaired).toBe(false)
    expect(existsSync(join(dir, '.arbiter-generated.json'))).toBe(false)
  })

  it('re-derives snapshot from arbiter.json (no prior snapshot)', async () => {
    await saveConfig(dir, defaultConfig())
    const result = await runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(0)
    expect(result.repaired).toBe(true)
    const snap = JSON.parse(readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(snap.$schemaVersion).toBe(1)
    expect(typeof snap['.checksum']).toBe('string')
  })

  it('replaces tampered snapshot with re-derived envelope', async () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    writeFileSync(join(dir, '.arbiter-generated.json'), '{"broken":true}', 'utf-8')
    const result = await runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(0)
    const snap = JSON.parse(readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(snap.$schemaVersion).toBe(1)
  })

  it('does NOT modify arbiter.json', async () => {
    await saveConfig(dir, defaultConfig())
    const before = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    await runDoctorRepairState({ dir, json: true })
    const after = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    expect(after).toBe(before)
  })
})

// ── runDoctorRecoverLock (#618) ───────────────────────────────────────────────

describe('runDoctorRecoverLock (#618)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-recover-'))
    mkdirSync(join(dir, '.arbiter'), { recursive: true })
    vi.clearAllMocks()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function writeLock(overrides: Partial<LockInfo> = {}): LockInfo {
    const info: LockInfo = {
      pid: 12345,
      hostname: os.hostname(),
      bootId: 'test-boot-id',
      startedAt: new Date(Date.now() - 10000).toISOString(),
      cmd: 'arbiter update',
      nonce: 'aabbccdd',
      ...overrides,
    }
    writeFileSync(join(dir, '.arbiter', '.lock'), JSON.stringify(info), 'utf-8')
    return info
  }

  it('returns found:false when no lock file exists', async () => {
    const result = await runDoctorRecoverLock({ dir, json: true })
    expect(result.found).toBe(false)
    expect(result.released).toBe(false)
  })

  it('releases existing lock → found:true, released:true, lock file gone', async () => {
    writeLock()
    const result = await runDoctorRecoverLock({ dir, json: true })
    expect(result.found).toBe(true)
    expect(result.released).toBe(true)
    expect(existsSync(join(dir, '.arbiter', '.lock'))).toBe(false)
  })

  it('result.info contains hostname, pid, cmd from the lock', async () => {
    writeLock({ pid: 9876, cmd: 'arbiter init', hostname: os.hostname() })
    const result = await runDoctorRecoverLock({ dir, json: true })
    expect(result.info?.pid).toBe(9876)
    expect(result.info?.cmd).toBe('arbiter init')
    expect(result.info?.hostname).toBe(os.hostname())
  })

  it('rejects symlink at lock path (SEC-5)', async () => {
    const { symlinkSync } = await import('node:fs')
    const lockDir = join(dir, '.arbiter')
    const realFile = join(lockDir, 'real-lock')
    const lockInfo: LockInfo = {
      pid: 12345,
      hostname: os.hostname(),
      bootId: 'x',
      startedAt: new Date().toISOString(),
      cmd: 'x',
      nonce: 'x',
    }
    writeFileSync(realFile, JSON.stringify(lockInfo), 'utf-8')
    symlinkSync(realFile, join(lockDir, '.lock'))
    await expect(runDoctorRecoverLock({ dir, json: false })).rejects.toThrow(/symlink/i)
  })
})

// ── runDoctorHealth — channel check (#662) ────────────────────────────────────

describe('runDoctorHealth — channel check (#662)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-ch-'))
    vi.clearAllMocks()
    mockRunCli.mockReturnValue({
      stdout: 'git version 2.40\n',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('shows "latest (default)" when no config and no flag', async () => {
    const result = await runDoctorHealth({ dir, json: true })
    const ch = result.checks.find((c) => c.id === 'release-channel')
    expect(ch?.status).toBe('PASS')
    expect(ch?.detail).toBe('latest (default)')
  })

  it('shows "beta (config)" when arbiter.json has channel:beta and no flag', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        $schemaVersion: 2,
        channel: 'beta',
        tools: [],
        governanceLevel: 'L1',
        useGitHub: false,
      }),
      'utf-8',
    )
    const result = await runDoctorHealth({ dir, json: true })
    const ch = result.checks.find((c) => c.id === 'release-channel')
    expect(ch?.detail).toBe('beta (config)')
  })

  it('shows "canary (flag)" when flag overrides config', async () => {
    writeFileSync(
      join(dir, 'arbiter.json'),
      JSON.stringify({
        $schemaVersion: 2,
        channel: 'beta',
        tools: [],
        governanceLevel: 'L1',
        useGitHub: false,
      }),
      'utf-8',
    )
    const result = await runDoctorHealth({ dir, json: true, channelFlag: 'canary' })
    const ch = result.checks.find((c) => c.id === 'release-channel')
    expect(ch?.detail).toBe('canary (flag)')
  })

  it('shows "latest (flag)" when flag is latest and no config channel', async () => {
    const result = await runDoctorHealth({ dir, json: true, channelFlag: 'latest' })
    const ch = result.checks.find((c) => c.id === 'release-channel')
    expect(ch?.detail).toBe('latest (flag)')
  })

  it('returns FAIL (not crash) when arbiter.json has invalid JSON', async () => {
    writeFileSync(join(dir, 'arbiter.json'), '{ invalid json }', 'utf-8')
    const result = await runDoctorHealth({ dir, json: true })
    const ch = result.checks.find((c) => c.id === 'release-channel')
    expect(ch?.status).toBe('FAIL')
    expect(ch?.hint).toMatch(/arbiter init/i)
    // Other checks should still run (not crash)
    expect(result.checks.find((c) => c.id === 'node-version')?.status).toBe('PASS')
  })
})

describe('runDoctorClean (#1217)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-clean-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('deletes *.arbiter-backup and .arbiter-generated.json.bak.* files', () => {
    const backupFile = join(dir, 'settings.json.arbiter-backup')
    const bakFile = join(dir, '.arbiter-generated.json.bak.2024-01-01T00-00-00-000Z')
    writeFileSync(backupFile, 'backup content', 'utf-8')
    writeFileSync(bakFile, 'bak content', 'utf-8')

    const result = runDoctorClean({ dir, dryRun: false })

    expect(result.deleted).toHaveLength(2)
    expect(result.found).toHaveLength(2)
    expect(existsSync(backupFile)).toBe(false)
    expect(existsSync(bakFile)).toBe(false)
  })

  it('dry-run lists files without deleting them', () => {
    const backupFile = join(dir, 'settings.json.arbiter-backup')
    const bakFile = join(dir, '.arbiter-generated.json.bak.2024-01-01T00-00-00-000Z')
    writeFileSync(backupFile, 'backup content', 'utf-8')
    writeFileSync(bakFile, 'bak content', 'utf-8')

    const result = runDoctorClean({ dir, dryRun: true })

    expect(result.found).toHaveLength(2)
    expect(result.deleted).toHaveLength(0)
    expect(existsSync(backupFile)).toBe(true)
    expect(existsSync(bakFile)).toBe(true)
  })
})
