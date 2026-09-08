import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runConfigure } from '../../src/commands/configure.js'
import { cleanupTestProject, createTestProject } from '../helpers.js'

vi.mock('../../src/utils/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}))

vi.mock('../../src/config/schema.js', () => ({
  validateConfig: vi.fn(),
}))

import { loadConfig } from '../../src/utils/config.js'
import { validateConfig } from '../../src/config/schema.js'

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>
const mockValidateConfig = validateConfig as ReturnType<typeof vi.fn>

const BASE_CONFIG = {
  governanceLevel: 'L1',
  collaborationMode: 'trunk-solo',
  tools: ['claude'],
  permitGitHub: false,
  features: {
    debtGates: false,
    suppressions: false,
    securityScanning: false,
    mutationTesting: false,
    contractTesting: false,
    evidenceHarness: false,
  },
  thresholds: {
    lineCoverage: 80,
    branchCoverage: 75,
    mutationScore: 60,
    cyclomaticComplexity: 10,
    methodLength: 30,
    maxParams: 4,
  },
  version: 2 as const,
}

describe('configure --json', () => {
  let written: string
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    written = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('emits JSON envelope on success', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    await runConfigure({ dir, sets: ['permitGitHub=true'], json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('configure')
    expect(parsed.version).toBe('1')
    expect(parsed.status).toBe('ok')
    expect(parsed.data).toMatchObject({ updated: ['permitGitHub=true'] })
  })

  it('emits JSON error when no config found', async () => {
    mockLoadConfig.mockReturnValue(null)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runConfigure({ dir, sets: ['permitGitHub=true'], json: true })).rejects.toThrow(
      'process.exit',
    )

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('error')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('does not emit JSON in human mode', async () => {
    mockLoadConfig.mockReturnValue({ ...BASE_CONFIG })
    mockValidateConfig.mockReturnValue({ ok: true, config: BASE_CONFIG })

    await runConfigure({ dir, sets: ['permitGitHub=false'], json: false })

    // Human mode emits text to stdout via process.stdout.write (#820), but
    // must NOT emit a JSON envelope. Assert the captured text is not JSON.
    expect(written.trim().startsWith('{')).toBe(false)
  })

  // #2546 AC-4: a withheld drain.md sync must surface as a `warnings` field on
  // the still-`ok` payload — never as an `error` status — and the process
  // must still exit 0 (no process.exit call at all in this branch).
  it('reports a withheld /drain sync as a warning on the ok payload, not an error (#2546)', async () => {
    const drainPath = join(dir, '.claude', 'commands', 'drain.md')
    mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
    writeFileSync(
      drainPath,
      '<!-- arbiter:preserve -->\n' +
        'before\n| `--max-parallel N` | 6       | Max worktree agents; keep this text |\nafter\n',
    )
    const config = {
      ...BASE_CONFIG,
      automation: { autonomy: 'L0', maxParallelWorktrees: 9 },
    }
    mockLoadConfig.mockReturnValue({ ...config })
    mockValidateConfig.mockReturnValue({ ok: true, config })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await runConfigure({ dir, sets: ['permitGitHub=true'], json: true })

    expect(exitSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('ok')
    expect(parsed.data).toMatchObject({ updated: ['permitGitHub=true'] })
    const warnings = parsed.warnings as string[]
    expect(warnings).toBeDefined()
    expect(warnings.join(' ')).toContain('drain.md')
    expect(warnings.join(' ')).toContain('arbiter:preserve')
    expect(warnings.join(' ')).toContain('9')
    expect(warnings.join(' ').toLowerCase()).not.toContain('delete')
  })

  // #2546 — silent-happy-path half of the JSON surface: an ordinary sync must
  // not add a `warnings` field at all (status stays a bare `ok`).
  it('does not add a warnings field when the /drain sync lands normally (#2546)', async () => {
    const drainPath = join(dir, '.claude', 'commands', 'drain.md')
    mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
    writeFileSync(
      drainPath,
      'before\n| `--max-parallel N` | 6       | Max worktree agents; keep this text |\nafter\n',
    )
    const config = {
      ...BASE_CONFIG,
      automation: { autonomy: 'L0', maxParallelWorktrees: 9 },
    }
    mockLoadConfig.mockReturnValue({ ...config })
    mockValidateConfig.mockReturnValue({ ok: true, config })

    await runConfigure({ dir, sets: ['permitGitHub=true'], json: true })

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.status).toBe('ok')
    expect(parsed.warnings).toBeUndefined()
  })

  it('emits JSON error envelope on empty --set with --json (BLOCKER-9)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    await expect(runConfigure({ dir, sets: [], json: true })).rejects.toThrow('process.exit')

    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(parsed.command).toBe('configure')
    expect(parsed.status).toBe('error')
    expect(parsed.errors).toEqual(['--set is required (non-interactive usage)'])
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
