// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeDryRunPreview,
  guardBrownfieldDirtyTree,
  rollbackGeneration,
} from '../../src/commands/init.js'
import { UserFacingError } from '../../src/utils/errors.js'
import type { ProjectConfig } from '../../src/wizard/types.js'
import { makeConfig } from '../helpers.js'

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
  // #2434: the preview no longer reads `config.existing` alone — it also runs the
  // generator registry in dryRun mode against `config.targetDir`, which is how it
  // learns the ~280 paths a real init writes instead of the 3 the migration plan
  // knew about. So the fixture has to be REAL: a scratch dir that actually holds
  // the files `existing` claims, rather than a partial object cast into shape. A
  // config whose `existing` flags disagree with the disk would make the two halves
  // of the preview contradict each other, which is a fixture defect, not a finding.
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-preview-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function previewWith(
    existing: Partial<ProjectConfig['existing']> = {},
  ): ReturnType<typeof computeDryRunPreview> {
    const base = makeConfig(dir)
    return computeDryRunPreview(makeConfig(dir, { existing: { ...base.existing, ...existing } }))
  }

  it('greenfield: all files in created, none in modified or skipped', () => {
    const preview = previewWith()
    expect(preview.created.length).toBeGreaterThan(0)
    expect(preview.modified).toHaveLength(0)
    expect(preview.skipped).toHaveLength(0)
  })

  it('brownfield agentsMd: AGENTS.md appears in modified not created', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '# pre-existing governance\n')
    const preview = previewWith({ agentsMd: true })
    expect(preview.modified.some((s) => s.includes('AGENTS.md'))).toBe(true)
    expect(preview.created.some((s) => s.includes('AGENTS.md'))).toBe(false)
  })

  it('brownfield claudeDir: hooks entry in skipped', () => {
    mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
    const preview = previewWith({ claudeDir: true })
    expect(preview.skipped.some((s) => s.includes('hooks'))).toBe(true)
  })

  it('preview object always has all three keys', () => {
    const preview = previewWith()
    expect(Array.isArray(preview.created)).toBe(true)
    expect(Array.isArray(preview.modified)).toBe(true)
    expect(Array.isArray(preview.skipped)).toBe(true)
  })

  it('writes nothing to the target dir', () => {
    previewWith()
    expect(readdirSync(dir)).toEqual([])
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

  it('does not throw when runCli throws ENOENT (git binary not found)', () => {
    mockRunCli.mockImplementationOnce(() => {
      const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
      throw err
    })
    expect(() => guardBrownfieldDirtyTree('/tmp/x', undefined)).not.toThrow()
  })

  it('re-throws unexpected non-git errors from runCli', () => {
    mockRunCli.mockImplementationOnce(() => {
      throw new TypeError('unexpected internal error')
    })
    expect(() => guardBrownfieldDirtyTree('/tmp/x', undefined)).toThrow('unexpected internal error')
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
