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
import { makeConfig } from '../helpers.js'
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
//
// #540 guards the brownfield promise: an existing file is never silently clobbered by
// the preview's account of the run. #2452 rewired the preview onto the real generator
// plan, so these now assert against actual emitted paths instead of the old
// hand-maintained stub's directory blobs. The preview-equals-plan RELATIONSHIP itself
// is pinned in __tests__/commands/init-dryrun-plan-parity.test.ts.

describe('computeDryRunPreview (#540)', () => {
  let previewDir: string

  beforeEach(() => {
    previewDir = mkdtempSync(join(tmpdir(), 'arbiter-dryrun-preview-'))
  })

  afterEach(() => {
    rmSync(previewDir, { recursive: true, force: true })
  })

  it('greenfield: real emitted files land in created, nothing is claimed as modified', async () => {
    const preview = await computeDryRunPreview(makeConfig(previewDir))
    expect(preview.created).toContain('AGENTS.md')
    expect(preview.created.length).toBeGreaterThan(1)
    expect(preview.modified).toHaveLength(0)
  }, 120_000)

  it('brownfield agentsMd: an existing AGENTS.md is previewed as modified, not created', async () => {
    writeFileSync(join(previewDir, 'AGENTS.md'), '# hand-written governance\n')
    const preview = await computeDryRunPreview(makeConfig(previewDir))
    expect(preview.modified).toContain('AGENTS.md')
    expect(preview.created).not.toContain('AGENTS.md')
  }, 120_000)

  it('brownfield: an existing skip-if-exists file is previewed as skipped, by name', async () => {
    writeFileSync(join(previewDir, '.gitignore'), 'vendor/\n')
    const preview = await computeDryRunPreview(makeConfig(previewDir))
    expect(preview.skipped).toContain('.gitignore')
    expect(preview.created).not.toContain('.gitignore')
  }, 120_000)

  it('preview object always has all three keys', async () => {
    const preview = await computeDryRunPreview(makeConfig(previewDir))
    expect(Array.isArray(preview.created)).toBe(true)
    expect(Array.isArray(preview.modified)).toBe(true)
    expect(Array.isArray(preview.skipped)).toBe(true)
  }, 120_000)
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
