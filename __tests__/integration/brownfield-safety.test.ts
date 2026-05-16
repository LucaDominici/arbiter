// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { runInit } from '../../src/commands/init.js'
import { UserFacingError } from '../../src/utils/errors.js'

vi.mock('../../src/compatibility/probe.js', () => ({
  runProbes: vi.fn().mockReturnValue({
    dir: '/tmp',
    stack: 'typescript',
    probes: [],
    hasFailures: false,
    hasWarnings: false,
  }),
}))

const FIXTURE_DIR = new URL('../fixtures/brownfield-real', import.meta.url).pathname

function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const dstPath = join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath)
    } else {
      copyFileSync(srcPath, dstPath)
    }
  }
}

function initCommittedGit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@arbiter.dev'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Arbiter Test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' })
}

describe('brownfield safety integration (#540)', () => {
  let dir: string
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-bfint-'))
    copyDir(FIXTURE_DIR, dir)
    initCommittedGit(dir)
    logSpy = vi.spyOn(console, 'log').mockReturnValue(undefined)
    warnSpy = vi.spyOn(console, 'warn').mockReturnValue(undefined)
    vi.spyOn(console, 'error').mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  // ── dry-run: no files written, shows create/modify/skip preview ──────────────

  it('dry-run exits without writing AGENTS.md', async () => {
    const originalContent = 'original'
    writeFileSync(join(dir, 'AGENTS.md'), originalContent)
    initCommittedGit(dir)

    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: true,
      noVerify: true,
    })

    // No files generated — the backup should not exist
    expect(existsSync(join(dir, 'AGENTS.md.arbiter-backup'))).toBe(false)
  })

  it('dry-run prints "Dry run" banner', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: true,
      noVerify: true,
    })

    const allOutput = logSpy.mock.calls.flat().join('\n')
    expect(allOutput).toContain('Dry run')
  })

  it('dry-run lists files with action labels (create / modify / skip)', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: true,
      brownfield: true,
      noVerify: true,
    })

    const allOutput = logSpy.mock.calls.flat().join('\n')
    // AGENTS.md exists in fixture → must appear in modify or skip column
    const hasActionLabel =
      allOutput.includes('[create]') ||
      allOutput.includes('[modify]') ||
      allOutput.includes('[skip]')
    expect(hasActionLabel).toBe(true)
  })

  // ── dirty-tree guard ─────────────────────────────────────────────────────────

  it('throws UserFacingError on dirty tree without --force', async () => {
    // Add an untracked file to make the tree dirty
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')

    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L2',
        dir,
        dryRun: false,
        brownfield: true,
        noVerify: true,
      }),
    ).rejects.toThrow(UserFacingError)
  })

  it('error message mentions --force', async () => {
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')

    await expect(
      runInit({
        yes: true,
        tools: 'claude',
        level: 'L2',
        dir,
        dryRun: false,
        brownfield: true,
        noVerify: true,
      }),
    ).rejects.toThrow('--force')
  })

  it('continues with warning when tree is dirty and --force supplied', async () => {
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')

    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      force: true,
      noVerify: true,
    })

    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('uncommitted'))
  })

  // ── actual brownfield init: backup + generation ───────────────────────────────

  it('backs up existing AGENTS.md and generates a new one', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      noVerify: true,
    })

    expect(existsSync(join(dir, 'AGENTS.md.arbiter-backup'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
  })

  it('generates .claude/ directory in brownfield project', async () => {
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      noVerify: true,
    })

    expect(existsSync(join(dir, '.claude', 'CLAUDE.md'))).toBe(true)
  })

  it('brownfield round-trip: backup content matches original AGENTS.md', async () => {
    const { readFileSync } = await import('node:fs')
    const originalContent = readFileSync(join(dir, 'AGENTS.md'), 'utf-8')

    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: true,
      noVerify: true,
    })

    const backupContent = readFileSync(join(dir, 'AGENTS.md.arbiter-backup'), 'utf-8')
    expect(backupContent).toBe(originalContent)
  })
})
