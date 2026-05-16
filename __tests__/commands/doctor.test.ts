// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctorRepairState, runDoctorHealth } from '../../src/commands/doctor.js'
import { defaultConfig, saveConfig, saveConfigAndSnapshot } from '../../src/utils/config.js'

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

  it('PASS when node >= 22 and git available (no arbiter.json)', () => {
    mockGitOk()
    const result = runDoctorHealth({ dir, json: true })
    const nodeCheck = result.checks.find((c) => c.id === 'node-version')
    const gitCheck = result.checks.find((c) => c.id === 'git-available')
    expect(nodeCheck?.status).toBe('PASS')
    expect(gitCheck?.status).toBe('PASS')
    expect(result.fail).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('FAIL when git not available', () => {
    mockGitFail()
    const result = runDoctorHealth({ dir, json: true })
    const gitCheck = result.checks.find((c) => c.id === 'git-available')
    expect(gitCheck?.status).toBe('FAIL')
    expect(result.fail).toBe(1)
    expect(result.exitCode).toBe(1)
  })

  it('WARN when arbiter.json exists but AGENTS.md missing', () => {
    mockGitOk()
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    const result = runDoctorHealth({ dir, json: true })
    const agentsCheck = result.checks.find((c) => c.id === 'agents-md')
    expect(agentsCheck?.status).toBe('WARN')
    expect(result.fail).toBe(0)
    expect(result.exitCode).toBe(0)
  })

  it('PASS when arbiter.json and AGENTS.md both present, hooks configured', () => {
    mockRunCli
      .mockReturnValueOnce({ stdout: 'git version 2.40\n', stderr: '', exitCode: 0, durationMs: 0 })
      .mockReturnValueOnce({ stdout: '.githooks\n', stderr: '', exitCode: 0, durationMs: 0 })
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify({ tools: ['claude'] }), 'utf-8')
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents\n', 'utf-8')
    const result = runDoctorHealth({ dir, json: true })
    const hooksCheck = result.checks.find((c) => c.id === 'hooks-path')
    expect(hooksCheck?.status).toBe('PASS')
    expect(hooksCheck?.detail).toContain('.githooks')
  })

  it('result has pass + warn + fail counts', () => {
    mockGitOk()
    const result = runDoctorHealth({ dir, json: true })
    expect(typeof result.pass).toBe('number')
    expect(typeof result.warn).toBe('number')
    expect(typeof result.fail).toBe('number')
    expect(result.pass + result.warn + result.fail).toBe(result.checks.length)
  })
})

// ── runDoctorRepairState (#619) ───────────────────────────────────────────────

describe('runDoctorRepairState (#619)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-doctor-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('exit 2 + no write when arbiter.json missing', () => {
    const result = runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(2)
    expect(result.repaired).toBe(false)
    expect(existsSync(join(dir, '.arbiter-generated.json'))).toBe(false)
  })

  it('re-derives snapshot from arbiter.json (no prior snapshot)', () => {
    saveConfig(dir, defaultConfig())
    const result = runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(0)
    expect(result.repaired).toBe(true)
    const snap = JSON.parse(readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(snap.$schemaVersion).toBe(1)
    expect(typeof snap['.checksum']).toBe('string')
  })

  it('replaces tampered snapshot with re-derived envelope', () => {
    saveConfigAndSnapshot(dir, defaultConfig())
    writeFileSync(join(dir, '.arbiter-generated.json'), '{"broken":true}', 'utf-8')
    const result = runDoctorRepairState({ dir, json: true })
    expect(result.exitCode).toBe(0)
    const snap = JSON.parse(readFileSync(join(dir, '.arbiter-generated.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(snap.$schemaVersion).toBe(1)
  })

  it('does NOT modify arbiter.json', () => {
    saveConfig(dir, defaultConfig())
    const before = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    runDoctorRepairState({ dir, json: true })
    const after = readFileSync(join(dir, 'arbiter.json'), 'utf-8')
    expect(after).toBe(before)
  })
})
