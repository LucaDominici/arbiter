// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeDryRunPreview,
  guardBrownfieldDirtyTree,
  rollbackGeneration,
} from '../../src/commands/init.js'
import { UserFacingError } from '../../src/utils/errors.js'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {
    notFound = false
  },
}))

import { runCli } from '../../src/utils/run-cli.js'
const mockRunCli = vi.mocked(runCli)

// ── computeDryRunPreview ──────────────────────────────────────────────────────

describe('computeDryRunPreview (#540)', () => {
  function makeConfig(overrides: Record<string, unknown> = {}) {
    return {
      existing: {
        agentsMd: false,
        claudeDir: false,
        agentsDir: false,
        aiRulez: false,
        settingsJson: false,
        checkAllScript: false,
        geminiDir: false,
        windsurfRules: false,
        aiderConf: false,
      },
      tools: ['claude'] as const,
      useGitHub: false,
      ...overrides,
    }
  }

  it('greenfield: all files in created, none in modified or skipped', () => {
    const preview = computeDryRunPreview(makeConfig() as Parameters<typeof computeDryRunPreview>[0])
    expect(preview.created.length).toBeGreaterThan(0)
    expect(preview.modified).toHaveLength(0)
    expect(preview.skipped).toHaveLength(0)
  })

  it('brownfield agentsMd: AGENTS.md appears in modified not created', () => {
    const preview = computeDryRunPreview(
      makeConfig({ existing: { ...makeConfig().existing, agentsMd: true } }) as Parameters<
        typeof computeDryRunPreview
      >[0],
    )
    expect(preview.modified.some((s) => s.includes('AGENTS.md'))).toBe(true)
    expect(preview.created.some((s) => s.includes('AGENTS.md'))).toBe(false)
  })

  it('brownfield claudeDir: hooks entry in skipped', () => {
    const preview = computeDryRunPreview(
      makeConfig({ existing: { ...makeConfig().existing, claudeDir: true } }) as Parameters<
        typeof computeDryRunPreview
      >[0],
    )
    expect(preview.skipped.some((s) => s.includes('hooks'))).toBe(true)
  })

  it('preview object always has all three keys', () => {
    const preview = computeDryRunPreview(makeConfig() as Parameters<typeof computeDryRunPreview>[0])
    expect(Array.isArray(preview.created)).toBe(true)
    expect(Array.isArray(preview.modified)).toBe(true)
    expect(Array.isArray(preview.skipped)).toBe(true)
  })
})

// ── guardBrownfieldDirtyTree ──────────────────────────────────────────────────

describe('guardBrownfieldDirtyTree (#540)', () => {
  afterEach(() => vi.clearAllMocks())

  it('passes when git status --porcelain returns empty output', () => {
    mockRunCli.mockReturnValueOnce({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 })
    expect(() => guardBrownfieldDirtyTree('/tmp/clean', undefined)).not.toThrow()
  })

  it('throws UserFacingError when tree is dirty and no --force', () => {
    mockRunCli.mockReturnValueOnce({
      stdout: ' M src/index.ts\n',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    })
    expect(() => guardBrownfieldDirtyTree('/tmp/dirty', undefined)).toThrow(UserFacingError)
  })

  it('throws UserFacingError when tree is dirty and force=false', () => {
    mockRunCli.mockReturnValueOnce({
      stdout: '?? new-file.txt\n',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    })
    expect(() => guardBrownfieldDirtyTree('/tmp/dirty', false)).toThrow(UserFacingError)
  })

  it('warns but does not throw when tree is dirty and --force active', () => {
    mockRunCli.mockReturnValueOnce({
      stdout: ' M src/index.ts\n',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockReturnValue(undefined)
    expect(() => guardBrownfieldDirtyTree('/tmp/dirty', true)).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not throw when runCli throws (git unavailable)', () => {
    mockRunCli.mockImplementationOnce(() => {
      throw new Error('git not found')
    })
    expect(() => guardBrownfieldDirtyTree('/tmp/x', undefined)).not.toThrow()
  })
})

// ── rollbackGeneration ────────────────────────────────────────────────────────

describe('rollbackGeneration (#540)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-bsafety-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('deletes created files on rollback', () => {
    const filePath = join(dir, 'AGENTS.md')
    writeFileSync(filePath, 'generated')

    rollbackGeneration([{ path: filePath, action: 'created' }])

    expect(existsSync(filePath)).toBe(false)
  })

  it('restores backed-up file and removes backup on rollback', () => {
    const filePath = join(dir, 'AGENTS.md')
    const backupPath = `${filePath}.arbiter-backup`
    writeFileSync(backupPath, 'original content')
    writeFileSync(filePath, 'replaced content')

    rollbackGeneration([{ path: filePath, action: 'backed-up-and-replaced' }])

    expect(readFileSync(filePath, 'utf-8')).toBe('original content')
    expect(existsSync(backupPath)).toBe(false)
  })

  it('handles mixed created + backed-up results', () => {
    const created = join(dir, 'new.md')
    const replaced = join(dir, 'existing.md')
    const backup = `${replaced}.arbiter-backup`
    writeFileSync(created, 'new')
    writeFileSync(backup, 'original')
    writeFileSync(replaced, 'replaced')

    rollbackGeneration([
      { path: created, action: 'created' },
      { path: replaced, action: 'backed-up-and-replaced' },
    ])

    expect(existsSync(created)).toBe(false)
    expect(readFileSync(replaced, 'utf-8')).toBe('original')
    expect(existsSync(backup)).toBe(false)
  })

  it('skips already-absent files without throwing', () => {
    const missing = join(dir, 'does-not-exist.md')
    expect(() => rollbackGeneration([{ path: missing, action: 'created' }])).not.toThrow()
  })

  it('does not touch skipped or replaced-without-backup results', () => {
    const filePath = join(dir, 'kept.md')
    writeFileSync(filePath, 'kept')

    rollbackGeneration([
      { path: filePath, action: 'skipped' },
      { path: filePath, action: 'replaced' },
    ])

    expect(readFileSync(filePath, 'utf-8')).toBe('kept')
  })
})
