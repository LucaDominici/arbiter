import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestProject, cleanupTestProject, DEFAULT_THRESHOLDS } from '../helpers.js'

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  note: vi.fn(),
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
}))

vi.mock('../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/config.js')>()
  return { ...actual, saveConfig: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('../../src/utils/file-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
}))

import * as clack from '@clack/prompts'
import { saveConfig } from '../../src/utils/config.js'
import { runInteractiveConfigure } from '../../src/commands/configure-interactive.js'

const CANCEL_SYMBOL = Symbol('clack-cancel')

function makeBaseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    collaborationMode: 'peer-review',
    branchingStrategy: 'trunk-direct',
    solo: { mergeMode: 'direct' },
    permitGitHub: false,
    archetype: 'library',
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase: false,
    hasPublicApi: false,
    contractType: 'none',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
      soloDevMode: false,
    },
    thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    ...overrides,
  }
}

function writeConfig(dir: string, overrides: Record<string, unknown> = {}): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(makeBaseConfig(overrides), null, 2))
}

/** Fill in all group prompts with values matching the base config (no changes). */
function mockAllGroupsNoChange(th: (typeof DEFAULT_THRESHOLDS)['L2']): void {
  const mockSelect = vi.mocked(clack.select)
  const mockMultiselect = vi.mocked(clack.multiselect)
  const mockConfirm = vi.mocked(clack.confirm)
  const mockText = vi.mocked(clack.text)

  // Group 1: axis (all same)
  mockSelect.mockResolvedValueOnce('library')
  mockSelect.mockResolvedValueOnce('none')
  mockConfirm.mockResolvedValueOnce(false) // isMultiTenant
  mockConfirm.mockResolvedValueOnce(false) // hasDatabase
  mockConfirm.mockResolvedValueOnce(false) // hasPublicApi
  mockSelect.mockResolvedValueOnce('none')
  mockSelect.mockResolvedValueOnce('L2')
  // Group 2: features (all same)
  mockConfirm.mockResolvedValueOnce(false) // contractTesting
  mockConfirm.mockResolvedValueOnce(true) // mutationTesting
  mockConfirm.mockResolvedValueOnce(true) // securityScanning
  mockConfirm.mockResolvedValueOnce(false) // evidenceHarness
  mockConfirm.mockResolvedValueOnce(true) // debtGates
  mockConfirm.mockResolvedValueOnce(true) // suppressions
  mockConfirm.mockResolvedValueOnce(false) // soloDevMode
  // Group 3: thresholds (all same)
  mockText.mockResolvedValueOnce(String(th.lineCoverage))
  mockText.mockResolvedValueOnce(String(th.branchCoverage))
  mockText.mockResolvedValueOnce(String(th.mutationScore))
  mockText.mockResolvedValueOnce(String(th.cyclomaticComplexity))
  mockText.mockResolvedValueOnce(String(th.methodLength))
  mockText.mockResolvedValueOnce(String(th.maxParams))
  // Group 4: collaboration (all same)
  mockSelect.mockResolvedValueOnce('peer-review')
  mockSelect.mockResolvedValueOnce('trunk-direct')
  mockSelect.mockResolvedValueOnce('direct')
  // Group 5: access (all same)
  mockMultiselect.mockResolvedValueOnce(['claude'])
  mockConfirm.mockResolvedValueOnce(false) // permitGitHub
}

describe('runInteractiveConfigure', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject('typescript')
    vi.mocked(clack.isCancel).mockImplementation(() => false)
  })

  afterEach(() => {
    vi.clearAllMocks()
    cleanupTestProject(dir)
  })

  it('happy path: archetype changed + save confirmed → saveConfig called with updated config', async () => {
    writeConfig(dir)
    const th = DEFAULT_THRESHOLDS.L2

    // Group 1: archetype changed to 'cli', rest same
    vi.mocked(clack.select).mockResolvedValueOnce('cli') // archetype ← changed
    vi.mocked(clack.select).mockResolvedValueOnce('none')
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.select).mockResolvedValueOnce('none')
    vi.mocked(clack.select).mockResolvedValueOnce('L2')
    // Group 2: all same
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    // Group 3: all same
    vi.mocked(clack.text).mockResolvedValueOnce(String(th.lineCoverage))
    vi.mocked(clack.text).mockResolvedValueOnce(String(th.branchCoverage))
    vi.mocked(clack.text).mockResolvedValueOnce(String(th.mutationScore))
    vi.mocked(clack.text).mockResolvedValueOnce(String(th.cyclomaticComplexity))
    vi.mocked(clack.text).mockResolvedValueOnce(String(th.methodLength))
    vi.mocked(clack.text).mockResolvedValueOnce(String(th.maxParams))
    // Group 4: all same
    vi.mocked(clack.select).mockResolvedValueOnce('peer-review')
    vi.mocked(clack.select).mockResolvedValueOnce('trunk-direct')
    vi.mocked(clack.select).mockResolvedValueOnce('direct')
    // Group 5: all same
    vi.mocked(clack.multiselect).mockResolvedValueOnce(['claude'])
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    // Final save confirm
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    expect(vi.mocked(saveConfig)).toHaveBeenCalledOnce()
    const saved = vi.mocked(saveConfig).mock.calls[0][1] as Record<string, unknown>
    expect(saved['archetype']).toBe('cli')
    expect(vi.mocked(clack.cancel)).not.toHaveBeenCalled()
  })

  it('cancel at first prompt → cancel() called, saveConfig not called', async () => {
    writeConfig(dir)
    vi.mocked(clack.isCancel).mockImplementation((v) => v === CANCEL_SYMBOL)
    vi.mocked(clack.select).mockResolvedValueOnce(CANCEL_SYMBOL) // archetype cancelled

    await runInteractiveConfigure(dir)

    expect(vi.mocked(clack.cancel)).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
  })

  it('cancel mid-flow (first threshold prompt) → cancel() called, saveConfig not called', async () => {
    writeConfig(dir)
    vi.mocked(clack.isCancel).mockImplementation((v) => v === CANCEL_SYMBOL)

    // Group 1: complete normally
    vi.mocked(clack.select).mockResolvedValueOnce('library')
    vi.mocked(clack.select).mockResolvedValueOnce('none')
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.select).mockResolvedValueOnce('none')
    vi.mocked(clack.select).mockResolvedValueOnce('L2')
    // Group 2: complete normally
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false)
    // Group 3: first text prompt cancelled
    vi.mocked(clack.text).mockResolvedValueOnce(CANCEL_SYMBOL)

    await runInteractiveConfigure(dir)

    expect(vi.mocked(clack.cancel)).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
  })

  it('save declined (final confirm=false) → cancel() called, saveConfig not called', async () => {
    writeConfig(dir)
    mockAllGroupsNoChange(DEFAULT_THRESHOLDS.L2)
    vi.mocked(clack.confirm).mockResolvedValueOnce(false) // final save confirm = NO

    await runInteractiveConfigure(dir)

    expect(vi.mocked(clack.cancel)).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
  })

  // #1261: the automation group edits the Project Profile autonomy axis.
  it('automation group: changed autonomy → saveConfig called with automation.autonomy=L1 (#1261)', async () => {
    writeConfig(dir, { automation: { autonomy: 'L0' } })
    mockAllGroupsNoChange(DEFAULT_THRESHOLDS.L2)
    // Group 6: automation — changed L0 → L1
    vi.mocked(clack.select).mockResolvedValueOnce('L1')
    // Final save confirm
    vi.mocked(clack.confirm).mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    expect(vi.mocked(saveConfig)).toHaveBeenCalledOnce()
    const saved = vi.mocked(saveConfig).mock.calls[0][1] as Record<string, unknown>
    expect(saved['automation']).toEqual({ autonomy: 'L1' })
  })

  it('automation group: unchanged autonomy → no diff emitted, saveConfig not called (#1261)', async () => {
    writeConfig(dir, { automation: { autonomy: 'L1' } })
    mockAllGroupsNoChange(DEFAULT_THRESHOLDS.L2)
    // Group 6: automation — same value
    vi.mocked(clack.select).mockResolvedValueOnce('L1')
    vi.mocked(clack.confirm).mockResolvedValueOnce(true) // final save confirm

    await runInteractiveConfigure(dir)

    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
    expect(vi.mocked(clack.outro)).toHaveBeenCalledWith(expect.any(String))
  })

  it('no-op (all prompts return same values) → outro(no_changes), saveConfig not called', async () => {
    writeConfig(dir)
    mockAllGroupsNoChange(DEFAULT_THRESHOLDS.L2)
    vi.mocked(clack.confirm).mockResolvedValueOnce(true) // final save confirm = YES, but nothing changed

    await runInteractiveConfigure(dir)

    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
    expect(vi.mocked(clack.outro)).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(clack.cancel)).not.toHaveBeenCalled()
  })
})
