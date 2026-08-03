// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit as runInitCommand } from '../../src/commands/init.js'
import { runUpdate, type UpdateOptions } from '../../src/commands/update.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../../src/state/generated-manifest.js'

const AGENTS = 'AGENTS.md'

/** #2141 red phase: the pending CLI option, declared only in this test. */
interface UpdateWithAdoptGovernance extends UpdateOptions {
  adoptGovernance: true
}

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

function runInit(options: Parameters<typeof runInitCommand>[0]) {
  return runInitCommand({ ...options, language: 'typescript' })
}

function captureOutput(): { text: () => string; stderr: () => string; restore: () => void } {
  let stdout = ''
  let stderr = ''
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
      return true
    })
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
      return true
    })
  return {
    text: (): string => stdout,
    stderr: (): string => stderr,
    restore: (): void => {
      stdoutSpy.mockRestore()
      stderrSpy.mockRestore()
    },
  }
}

describe('#2141: a diverged governance file is withheld unless explicitly adopted', () => {
  let seedDir: string
  let workDir: string
  let dir: string

  beforeAll(async () => {
    seedDir = mkdtempSync(join(tmpdir(), 'arb-2141-governance-seed-'))
    initGit(seedDir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir: seedDir, noVerify: true })
  }, 180000)

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'arb-2141-governance-case-'))
    dir = join(workDir, 'target')
    cpSync(seedDir, dir, { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(workDir, { recursive: true, force: true })
  })

  afterAll(() => {
    rmSync(seedDir, { recursive: true, force: true })
  }, 180000)

  function divergeAgents(): string {
    const localContent =
      readFileSync(join(dir, AGENTS), 'utf-8') +
      '\n## Authority and Project SSOTs\n\nLocal governance extension: do not erase.\n'
    writeFileSync(join(dir, AGENTS), localContent)
    return localContent
  }

  it('a nude update leaves a diverged AGENTS.md byte-identical', async () => {
    const localContent = divergeAgents()

    await runUpdate({ dir, github: false })

    expect(readFileSync(join(dir, AGENTS), 'utf-8')).toBe(localContent)
  })

  it('--adopt-governance overwrites AGENTS.md and records the prior bytes verbatim', async () => {
    const localContent = divergeAgents()
    const options: UpdateWithAdoptGovernance = { dir, github: false, adoptGovernance: true }

    await runUpdate(options)

    const onDisk = readFileSync(join(dir, AGENTS), 'utf-8')
    expect(onDisk).not.toBe(localContent)
    const overridesDir = join(dir, '.arbiter/evidence/local-overrides')
    expect(existsSync(overridesDir)).toBe(true)
    const recordName = readdirSync(overridesDir).find((file) => file === 'AGENTS.md.json')
    expect(recordName).toBeDefined()
    const record = JSON.parse(readFileSync(join(overridesDir, recordName as string), 'utf-8')) as {
      path: string
      priorContent: string
      newContent: string
    }
    expect(record.path).toBe(AGENTS)
    expect(record.priorContent).toBe(localContent)
    expect(record.newContent).toBe(onDisk)
  })

  it('a pristine-stale AGENTS.md is still re-rendered by a nude update', async () => {
    const pristineStale = '# Pristine stale AGENTS.md\n'
    writeFileSync(join(dir, AGENTS), pristineStale)
    const manifest = loadGeneratedManifest(dir)
    manifest[AGENTS] = createHash('sha256').update(pristineStale).digest('hex')
    saveGeneratedManifest(dir, manifest)

    const output = captureOutput()
    try {
      await runUpdate({ dir, github: false })
    } finally {
      output.restore()
    }

    expect(readFileSync(join(dir, AGENTS), 'utf-8')).not.toBe(pristineStale)
    expect(output.stderr()).not.toContain(AGENTS)
  })

  it('names a withheld AGENTS.md and --adopt-governance in run output', async () => {
    divergeAgents()
    const output = captureOutput()
    try {
      await runUpdate({ dir, github: false })
    } finally {
      output.restore()
    }

    const combined = output.text() + output.stderr()
    expect(combined).toContain(AGENTS)
    expect(combined).toContain('--adopt-governance')
  })
})
