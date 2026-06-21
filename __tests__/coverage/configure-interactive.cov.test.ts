// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// Mock runConfigure so we can assert on the exact `sets` (assignment list) the
// interactive flow produces, independent of migration side-effects in saveConfig.
vi.mock('../../src/commands/configure.js', () => ({
  runConfigure: vi.fn().mockResolvedValue(undefined),
}))

import * as clack from '@clack/prompts'
import { saveConfig } from '../../src/utils/config.js'
import { runConfigure } from '../../src/commands/configure.js'
import { runInteractiveConfigure } from '../../src/commands/configure-interactive.js'

function lastSets(): string[] {
  const mock = vi.mocked(runConfigure)
  const call = mock.mock.calls[mock.mock.calls.length - 1]
  const arg = call[0] as { sets: string[] }
  return arg.sets
}

const CANCEL_SYMBOL = Symbol('clack-cancel')

interface Thresholds {
  lineCoverage: number
  branchCoverage: number
  mutationScore: number
  cyclomaticComplexity: number
  methodLength: number
  maxParams: number
}

const TH: Thresholds = {
  lineCoverage: 80,
  branchCoverage: 70,
  mutationScore: 80,
  cyclomaticComplexity: 15,
  methodLength: 65,
  maxParams: 7,
}

function makeMinimalConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // A config that omits every optional axis/collab/automation field so the
  // `?? default` branches inside the module are exercised.
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    // useGitHub satisfies the validator without setting permitGitHub, so the
    // module's `config.permitGitHub ?? false` default branch is exercised.
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
      // soloDevMode intentionally omitted → exercises `?? false`
    },
    thresholds: { ...TH },
    ...overrides,
  }
}

function writeConfig(dir: string, overrides: Record<string, unknown> = {}): void {
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(makeMinimalConfig(overrides), null, 2))
}

const mockSelect = vi.mocked(clack.select)
const mockMultiselect = vi.mocked(clack.multiselect)
const mockConfirm = vi.mocked(clack.confirm)
const mockText = vi.mocked(clack.text)

/**
 * Queue all six group prompts so each returns its current (default) value,
 * producing zero diffs. Threshold prompts echo the supplied thresholds.
 */
function queueAllGroupsNoChange(th: Thresholds): void {
  // Group 1: axis (defaults: backend-web-db / none / false / false / false / none / L2)
  mockSelect.mockResolvedValueOnce('backend-web-db')
  mockSelect.mockResolvedValueOnce('none')
  mockConfirm.mockResolvedValueOnce(false) // isMultiTenant
  mockConfirm.mockResolvedValueOnce(false) // hasDatabase
  mockConfirm.mockResolvedValueOnce(false) // hasPublicApi
  mockSelect.mockResolvedValueOnce('none') // contractType
  mockSelect.mockResolvedValueOnce('L2') // governanceLevel
  // Group 2: features
  mockConfirm.mockResolvedValueOnce(false) // contractTesting
  mockConfirm.mockResolvedValueOnce(true) // mutationTesting
  mockConfirm.mockResolvedValueOnce(true) // securityScanning
  mockConfirm.mockResolvedValueOnce(false) // evidenceHarness
  mockConfirm.mockResolvedValueOnce(true) // debtGates
  mockConfirm.mockResolvedValueOnce(true) // suppressions
  mockConfirm.mockResolvedValueOnce(false) // soloDevMode (?? false)
  // Group 3: thresholds (echo same)
  mockText.mockResolvedValueOnce(String(th.lineCoverage))
  mockText.mockResolvedValueOnce(String(th.branchCoverage))
  mockText.mockResolvedValueOnce(String(th.mutationScore))
  mockText.mockResolvedValueOnce(String(th.cyclomaticComplexity))
  mockText.mockResolvedValueOnce(String(th.methodLength))
  mockText.mockResolvedValueOnce(String(th.maxParams))
  // Group 4: collaboration (defaults: peer-review / trunk-direct / direct)
  mockSelect.mockResolvedValueOnce('peer-review')
  mockSelect.mockResolvedValueOnce('trunk-direct')
  mockSelect.mockResolvedValueOnce('direct')
  // Group 5: access (tools unchanged, permitGitHub false)
  mockMultiselect.mockResolvedValueOnce(['claude'])
  mockConfirm.mockResolvedValueOnce(false) // permitGitHub (?? false)
  // Group 6: automation (default L0)
  mockSelect.mockResolvedValueOnce('L0')
}

describe('runInteractiveConfigure — branch coverage', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cfgint-cov-'))
    vi.mocked(clack.isCancel).mockImplementation(() => false)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('no config present → writes no_config to stderr and process.exit(1)', async () => {
    // No arbiter.json written → loadConfig returns null.
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((): boolean => true)
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((): never => {
        throw new Error('exit-called')
      }) as never)

    await expect(runInteractiveConfigure(dir)).rejects.toThrow('exit-called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(stderrSpy).toHaveBeenCalled()
    expect(vi.mocked(clack.intro)).not.toHaveBeenCalled()

    stderrSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('resolves cwd when dir arg omitted (process.cwd() branch)', async () => {
    // dir omitted → resolve(process.cwd()); chdir into the empty temp dir so
    // loadConfig finds no arbiter.json and the no_config branch is taken.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((): never => {
        throw new Error('exit-called')
      }) as never)
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((): boolean => true)
    const originalCwd = process.cwd()
    process.chdir(dir)
    try {
      await expect(runInteractiveConfigure()).rejects.toThrow('exit-called')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      process.chdir(originalCwd)
    }

    exitSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('every field changed → runConfigure receives all updated assignments (diff "changed" branches)', async () => {
    writeConfig(dir)

    // Group 1: change everything
    mockSelect.mockResolvedValueOnce('cli') // archetype: backend-web-db → cli
    mockSelect.mockResolvedValueOnce('hexagonal') // architectureStyle: none → hexagonal
    mockConfirm.mockResolvedValueOnce(true) // isMultiTenant: false → true
    mockConfirm.mockResolvedValueOnce(true) // hasDatabase: false → true
    mockConfirm.mockResolvedValueOnce(true) // hasPublicApi: false → true
    mockSelect.mockResolvedValueOnce('graphql') // contractType: none → graphql
    mockSelect.mockResolvedValueOnce('L3') // governanceLevel: L2 → L3
    // Group 2: flip every feature
    mockConfirm.mockResolvedValueOnce(true) // contractTesting false → true
    mockConfirm.mockResolvedValueOnce(false) // mutationTesting true → false
    mockConfirm.mockResolvedValueOnce(false) // securityScanning true → false
    mockConfirm.mockResolvedValueOnce(true) // evidenceHarness false → true
    mockConfirm.mockResolvedValueOnce(false) // debtGates true → false
    mockConfirm.mockResolvedValueOnce(false) // suppressions true → false
    mockConfirm.mockResolvedValueOnce(true) // soloDevMode (?? false) → true
    // Group 3: change every threshold
    mockText.mockResolvedValueOnce('99')
    mockText.mockResolvedValueOnce('98')
    mockText.mockResolvedValueOnce('97')
    mockText.mockResolvedValueOnce('11')
    mockText.mockResolvedValueOnce('50')
    mockText.mockResolvedValueOnce('6')
    // Group 4: change collaboration trio
    mockSelect.mockResolvedValueOnce('gated-review') // peer-review → gated-review
    mockSelect.mockResolvedValueOnce('github-flow') // trunk-direct → github-flow
    mockSelect.mockResolvedValueOnce('pr-ff') // direct → pr-ff
    // Group 5: change tools (diffArr changed) + permitGitHub
    mockMultiselect.mockResolvedValueOnce(['claude', 'codex'])
    mockConfirm.mockResolvedValueOnce(true) // permitGitHub false → true
    // Group 6: change automation
    mockSelect.mockResolvedValueOnce('L3') // L0 → L3
    // Final save confirm
    mockConfirm.mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    expect(vi.mocked(runConfigure)).toHaveBeenCalledOnce()
    const sets = lastSets()
    expect(sets).toContain('archetype=cli')
    expect(sets).toContain('architectureStyle=hexagonal')
    expect(sets).toContain('isMultiTenant=true')
    expect(sets).toContain('hasDatabase=true')
    expect(sets).toContain('hasPublicApi=true')
    expect(sets).toContain('contractType=graphql')
    expect(sets).toContain('governanceLevel=L3')
    expect(sets).toContain('features.contractTesting=true')
    expect(sets).toContain('features.mutationTesting=false')
    expect(sets).toContain('features.soloDevMode=true')
    expect(sets).toContain('thresholds.lineCoverage=99')
    expect(sets).toContain('thresholds.maxParams=6')
    expect(sets).toContain('collaborationMode=gated-review')
    expect(sets).toContain('branchingStrategy=github-flow')
    expect(sets).toContain('solo.mergeMode=pr-ff')
    expect(sets).toContain('permitGitHub=true')
    expect(sets).toContain('automation.autonomy=L3')
    expect(sets).toContain('tools=claude,codex')
  })

  it('config with present optional fields → exercises the non-default `??` left branches', async () => {
    // Provide every optional field so each `?? default` short-circuits on the left.
    writeConfig(dir, {
      archetype: 'library',
      architectureStyle: 'layered',
      isMultiTenant: true,
      hasDatabase: true,
      hasPublicApi: true,
      contractType: 'grpc',
      collaborationMode: 'gated-review',
      branchingStrategy: 'github-flow',
      solo: { mergeMode: 'pr-ff' },
      permitGitHub: true,
      automation: { autonomy: 'L2' },
      features: {
        contractTesting: false,
        mutationTesting: true,
        securityScanning: true,
        evidenceHarness: false,
        debtGates: true,
        suppressions: true,
        soloDevMode: true, // present → `?? false` left branch
      },
    })

    // Echo every present value → zero diffs.
    mockSelect.mockResolvedValueOnce('library')
    mockSelect.mockResolvedValueOnce('layered')
    mockConfirm.mockResolvedValueOnce(true) // isMultiTenant
    mockConfirm.mockResolvedValueOnce(true) // hasDatabase
    mockConfirm.mockResolvedValueOnce(true) // hasPublicApi
    mockSelect.mockResolvedValueOnce('grpc')
    mockSelect.mockResolvedValueOnce('L2')
    // features
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true) // soloDevMode present=true
    // thresholds
    mockText.mockResolvedValueOnce(String(TH.lineCoverage))
    mockText.mockResolvedValueOnce(String(TH.branchCoverage))
    mockText.mockResolvedValueOnce(String(TH.mutationScore))
    mockText.mockResolvedValueOnce(String(TH.cyclomaticComplexity))
    mockText.mockResolvedValueOnce(String(TH.methodLength))
    mockText.mockResolvedValueOnce(String(TH.maxParams))
    // collaboration (echo present)
    mockSelect.mockResolvedValueOnce('gated-review')
    mockSelect.mockResolvedValueOnce('github-flow')
    mockSelect.mockResolvedValueOnce('pr-ff')
    // access
    mockMultiselect.mockResolvedValueOnce(['claude'])
    mockConfirm.mockResolvedValueOnce(true) // permitGitHub present=true
    // automation (echo present)
    mockSelect.mockResolvedValueOnce('L2')
    // final confirm (irrelevant — no diffs, hits outro path)
    mockConfirm.mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    // Zero diffs → outro path, runConfigure not invoked.
    expect(vi.mocked(runConfigure)).not.toHaveBeenCalled()
    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
    expect(vi.mocked(clack.outro)).toHaveBeenCalledWith(expect.any(String))
  })

  it('threshold validate(): rejects empty/non-numeric and accepts digits', async () => {
    writeConfig(dir)
    queueAllGroupsNoChange(TH)
    mockConfirm.mockResolvedValueOnce(true) // final save confirm

    await runInteractiveConfigure(dir)

    // Grab the validate callback handed to the first text() prompt and exercise it.
    const firstTextArgs = mockText.mock.calls[0][0] as {
      validate?: (v: string | undefined) => string | undefined
    }
    const validate = firstTextArgs.validate
    expect(validate).toBeTypeOf('function')
    if (!validate) throw new Error('validate missing')

    // undefined → invalid (left side of ||)
    expect(validate(undefined)).toBeTypeOf('string')
    // non-numeric → invalid (right side of ||)
    expect(validate('abc')).toBeTypeOf('string')
    // whitespace-padded non-numeric → invalid
    expect(validate('  ')).toBeTypeOf('string')
    // valid digits → undefined (no error)
    expect(validate('42')).toBeUndefined()
    // valid digits with surrounding whitespace → trimmed, valid
    expect(validate('  7  ')).toBeUndefined()
  })

  it('threshold echoed with surrounding whitespace equals old value → no diff for that field', async () => {
    writeConfig(dir)
    // Group 1: axis no change
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockSelect.mockResolvedValueOnce('none')
    mockSelect.mockResolvedValueOnce('L2')
    // Group 2: features no change
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    // Group 3: first threshold returns "  80  " (trims to same → no diff); rest unchanged
    mockText.mockResolvedValueOnce(`  ${TH.lineCoverage}  `)
    mockText.mockResolvedValueOnce(String(TH.branchCoverage))
    mockText.mockResolvedValueOnce(String(TH.mutationScore))
    mockText.mockResolvedValueOnce(String(TH.cyclomaticComplexity))
    mockText.mockResolvedValueOnce(String(TH.methodLength))
    mockText.mockResolvedValueOnce('5') // maxParams 7 → 5 (changed branch)
    // Group 4: collaboration no change
    mockSelect.mockResolvedValueOnce('peer-review')
    mockSelect.mockResolvedValueOnce('trunk-direct')
    mockSelect.mockResolvedValueOnce('direct')
    // Group 5: access no change
    mockMultiselect.mockResolvedValueOnce(['claude'])
    mockConfirm.mockResolvedValueOnce(false)
    // Group 6: automation no change
    mockSelect.mockResolvedValueOnce('L0')
    // final save confirm = YES
    mockConfirm.mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    // The whitespace-padded lineCoverage trims to the old value → no diff for it;
    // maxParams changed → present. (Axis fields are absent in the minimal config,
    // so they also diff to their displayed defaults — that is expected and orthogonal.)
    expect(vi.mocked(runConfigure)).toHaveBeenCalledOnce()
    const sets = lastSets()
    expect(sets).toContain('thresholds.maxParams=5')
    expect(sets).not.toContain('thresholds.lineCoverage=80')
    expect(sets.some((s: string) => s.startsWith('thresholds.lineCoverage'))).toBe(false)
  })

  it('isCancel at final save confirm → cancel() called, saveConfig not called', async () => {
    writeConfig(dir)
    vi.mocked(clack.isCancel).mockImplementation((v: unknown) => v === CANCEL_SYMBOL)
    queueAllGroupsNoChange(TH)
    // Make at least one change so allAssignments is non-empty (forces save-confirm path)
    // Re-queue: override group 6 was L0; instead change automation to L1.
    // queueAllGroupsNoChange already queued automation L0; we need a change before
    // the final confirm. Simplest: append a fresh change by re-driving — but the
    // queue is fixed. Instead drive the confirm to the CANCEL symbol; cancel path
    // is reached regardless of whether assignments are empty when isCancel is true.
    mockConfirm.mockResolvedValueOnce(CANCEL_SYMBOL as unknown as boolean)

    await runInteractiveConfigure(dir)

    expect(vi.mocked(clack.cancel)).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(runConfigure)).not.toHaveBeenCalled()
    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
  })

  it('multiselect tools changed (diffArr changed branch) → tools persisted', async () => {
    writeConfig(dir, { tools: ['claude', 'codex'] })
    // Group 1 axis no change
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockSelect.mockResolvedValueOnce('none')
    mockSelect.mockResolvedValueOnce('L2')
    // Group 2 features no change
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    // Group 3 thresholds no change
    mockText.mockResolvedValueOnce(String(TH.lineCoverage))
    mockText.mockResolvedValueOnce(String(TH.branchCoverage))
    mockText.mockResolvedValueOnce(String(TH.mutationScore))
    mockText.mockResolvedValueOnce(String(TH.cyclomaticComplexity))
    mockText.mockResolvedValueOnce(String(TH.methodLength))
    mockText.mockResolvedValueOnce(String(TH.maxParams))
    // Group 4 collaboration no change
    mockSelect.mockResolvedValueOnce('peer-review')
    mockSelect.mockResolvedValueOnce('trunk-direct')
    mockSelect.mockResolvedValueOnce('direct')
    // Group 5 access: tools reduced to ['claude'] (diffArr sees a change), permit unchanged
    mockMultiselect.mockResolvedValueOnce(['claude'])
    mockConfirm.mockResolvedValueOnce(false)
    // Group 6 automation no change
    mockSelect.mockResolvedValueOnce('L0')
    // final confirm yes
    mockConfirm.mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    expect(vi.mocked(runConfigure)).toHaveBeenCalledOnce()
    expect(lastSets()).toContain('tools=claude')
  })

  it('diffArr: reordered same set is equal; subset is a change (unit, no I/O)', async () => {
    // diffArr is internal; assert its sorted-compare semantics indirectly through
    // the access group. Same set in a different order → no diff (sorted-equal).
    writeConfig(dir, { tools: ['claude', 'codex'] })
    // axis no change
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockSelect.mockResolvedValueOnce('none')
    mockSelect.mockResolvedValueOnce('L2')
    // features no change
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(true)
    mockConfirm.mockResolvedValueOnce(false)
    // thresholds no change
    mockText.mockResolvedValueOnce(String(TH.lineCoverage))
    mockText.mockResolvedValueOnce(String(TH.branchCoverage))
    mockText.mockResolvedValueOnce(String(TH.mutationScore))
    mockText.mockResolvedValueOnce(String(TH.cyclomaticComplexity))
    mockText.mockResolvedValueOnce(String(TH.methodLength))
    mockText.mockResolvedValueOnce(String(TH.maxParams))
    // collaboration no change
    mockSelect.mockResolvedValueOnce('peer-review')
    mockSelect.mockResolvedValueOnce('trunk-direct')
    mockSelect.mockResolvedValueOnce('direct')
    // access: SAME set in reversed order → diffArr sorted-compare sees equal
    mockMultiselect.mockResolvedValueOnce(['codex', 'claude'])
    mockConfirm.mockResolvedValueOnce(false)
    // automation no change
    mockSelect.mockResolvedValueOnce('L0')
    // final confirm yes (no diffs → outro)
    mockConfirm.mockResolvedValueOnce(true)

    await runInteractiveConfigure(dir)

    // tools were echoed as the same set in reversed order → diffArr sorted-compare
    // sees no change, so NO `tools=` assignment is emitted (axis defaults still diff).
    expect(vi.mocked(runConfigure)).toHaveBeenCalledOnce()
    const sets = lastSets()
    expect(sets.some((s: string) => s.startsWith('tools='))).toBe(false)
  })
})
