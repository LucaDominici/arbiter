// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mirror the sibling cov test's module mocks. The interactive flow is driven
// entirely through these @clack/prompts stubs — no real TTY, network, git, or
// gh CLI is ever touched, so the run is deterministic and fast.
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

// Stub runConfigure so the cancel/early-return branches can be asserted without
// invoking the real config-migration machinery.
vi.mock('../../src/commands/configure.js', () => ({
  runConfigure: vi.fn().mockResolvedValue(undefined),
}))

import * as clack from '@clack/prompts'
import { saveConfig } from '../../src/utils/config.js'
import { runConfigure } from '../../src/commands/configure.js'
import { runInteractiveConfigure } from '../../src/commands/configure-interactive.js'

// A unique sentinel that the per-test `isCancel` implementation recognises as
// "this prompt was cancelled". Every other resolved prompt value is treated as
// not-cancelled, so exactly one cancel guard fires per scenario.
const CANCEL: unique symbol = Symbol('clack-cancel')

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
  return {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: true,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
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
const mockCancel = vi.mocked(clack.cancel)

// Convenience: a select/confirm/multiselect/text that resolves to the CANCEL
// sentinel. Typed loosely because the production code's prompt return types are
// unions we deliberately violate to model the cancel symbol clack emits.
const cancelValue = CANCEL as unknown as never

/**
 * Queue every prompt of all six groups so each echoes its current default value
 * (zero diffs). Optionally stop early: if `stopAfter` group indices are not all
 * queued, callers append their own cancel sentinel at the desired position.
 */
function queueAxisNoChange(): void {
  mockSelect.mockResolvedValueOnce('backend-web-db') // archetype
  mockSelect.mockResolvedValueOnce('none') // architectureStyle
  mockConfirm.mockResolvedValueOnce(false) // isMultiTenant
  mockConfirm.mockResolvedValueOnce(false) // hasDatabase
  mockConfirm.mockResolvedValueOnce(false) // hasPublicApi
  mockSelect.mockResolvedValueOnce('none') // contractType
  mockSelect.mockResolvedValueOnce('L2') // governanceLevel
}

function queueFeaturesNoChange(): void {
  mockConfirm.mockResolvedValueOnce(false) // contractTesting
  mockConfirm.mockResolvedValueOnce(true) // mutationTesting
  mockConfirm.mockResolvedValueOnce(true) // securityScanning
  mockConfirm.mockResolvedValueOnce(false) // evidenceHarness
  mockConfirm.mockResolvedValueOnce(true) // debtGates
  mockConfirm.mockResolvedValueOnce(true) // suppressions
  mockConfirm.mockResolvedValueOnce(false) // soloDevMode (?? false)
}

function queueThresholdsNoChange(): void {
  mockText.mockResolvedValueOnce(String(TH.lineCoverage))
  mockText.mockResolvedValueOnce(String(TH.branchCoverage))
  mockText.mockResolvedValueOnce(String(TH.mutationScore))
  mockText.mockResolvedValueOnce(String(TH.cyclomaticComplexity))
  mockText.mockResolvedValueOnce(String(TH.methodLength))
  mockText.mockResolvedValueOnce(String(TH.maxParams))
}

function queueCollaborationNoChange(): void {
  mockSelect.mockResolvedValueOnce('peer-review')
  mockSelect.mockResolvedValueOnce('trunk-direct')
  mockSelect.mockResolvedValueOnce('direct')
}

function queueAccessNoChange(): void {
  mockMultiselect.mockResolvedValueOnce(['claude'])
  mockConfirm.mockResolvedValueOnce(false) // permitGitHub
}

/**
 * After a group returns null (a cancelled prompt), the top-level loop calls
 * cancel() and returns without ever invoking runConfigure or saveConfig. This
 * helper asserts that shared post-condition (covers the `result === null`
 * branch at the orchestration loop in addition to the per-prompt guard).
 */
function expectCancelledRun(): void {
  expect(mockCancel).toHaveBeenCalledWith(expect.any(String))
  expect(vi.mocked(runConfigure)).not.toHaveBeenCalled()
  expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
}

describe('runInteractiveConfigure — edge / cancel-guard branch coverage', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-cfgint-edge-'))
    // Default: nothing is a cancel. Each test that needs a cancel overrides this
    // to recognise the CANCEL sentinel only.
    vi.mocked(clack.isCancel).mockImplementation((v: unknown): v is symbol => v === CANCEL)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  // ---- Axis group: each prompt's isCancel early-return (lines 63/75/81/87/93/107/119) ----

  it('axis: cancel at archetype select → null → cancel() (line 63 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce(cancelValue) // archetype cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('axis: cancel at architectureStyle select → null (line 75 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce('backend-web-db') // archetype ok
    mockSelect.mockResolvedValueOnce(cancelValue) // architectureStyle cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('axis: cancel at isMultiTenant confirm → null (line 81 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(cancelValue) // isMultiTenant cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('axis: cancel at hasDatabase confirm → null (line 87 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false) // isMultiTenant ok
    mockConfirm.mockResolvedValueOnce(cancelValue) // hasDatabase cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('axis: cancel at hasPublicApi confirm → null (line 93 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false) // isMultiTenant ok
    mockConfirm.mockResolvedValueOnce(false) // hasDatabase ok
    mockConfirm.mockResolvedValueOnce(cancelValue) // hasPublicApi cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('axis: cancel at contractType select → null (line 107 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockSelect.mockResolvedValueOnce(cancelValue) // contractType cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('axis: cancel at governanceLevel select → null (line 119 guard)', async () => {
    writeConfig(dir)
    mockSelect.mockResolvedValueOnce('backend-web-db')
    mockSelect.mockResolvedValueOnce('none')
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockConfirm.mockResolvedValueOnce(false)
    mockSelect.mockResolvedValueOnce('none') // contractType ok
    mockSelect.mockResolvedValueOnce(cancelValue) // governanceLevel cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  // ---- Features loop: per-iteration isCancel early-return (line 150 guard) ----

  it('features: cancel inside the confirm loop → null (line 150 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    mockConfirm.mockResolvedValueOnce(false) // contractTesting ok
    mockConfirm.mockResolvedValueOnce(cancelValue) // mutationTesting cancelled mid-loop
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  // ---- Thresholds loop: per-iteration isCancel early-return (line 179 guard) ----

  it('thresholds: cancel inside the text loop → null (line 179 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    mockText.mockResolvedValueOnce(String(TH.lineCoverage)) // first threshold ok
    mockText.mockResolvedValueOnce(cancelValue) // branchCoverage cancelled mid-loop
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  // ---- Collaboration group: lines 198/209/219 guards ----

  it('collaboration: cancel at collaborationMode select → null (line 198 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    mockSelect.mockResolvedValueOnce(cancelValue) // collaborationMode cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('collaboration: cancel at branchingStrategy select → null (line 209 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    mockSelect.mockResolvedValueOnce('peer-review') // collaborationMode ok
    mockSelect.mockResolvedValueOnce(cancelValue) // branchingStrategy cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('collaboration: cancel at soloMergeMode select → null (line 219 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    mockSelect.mockResolvedValueOnce('peer-review')
    mockSelect.mockResolvedValueOnce('trunk-direct') // branchingStrategy ok
    mockSelect.mockResolvedValueOnce(cancelValue) // soloMergeMode cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  // ---- Access group: lines 238 (tools) and 244 (permitGitHub) guards ----

  it('access: cancel at tools multiselect → null (line 238 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    queueCollaborationNoChange()
    mockMultiselect.mockResolvedValueOnce(cancelValue) // tools cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  it('access: cancel at permitGitHub confirm → null (line 244 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    queueCollaborationNoChange()
    mockMultiselect.mockResolvedValueOnce(['claude']) // tools ok
    mockConfirm.mockResolvedValueOnce(cancelValue) // permitGitHub cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  // ---- Automation group: line 266 guard ----

  it('automation: cancel at autonomy select → null (line 266 guard)', async () => {
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    queueCollaborationNoChange()
    queueAccessNoChange()
    mockSelect.mockResolvedValueOnce(cancelValue) // autonomy cancelled
    await runInteractiveConfigure(dir)
    expectCancelledRun()
  })

  // ---- Final save confirm: the `!saveit` right operand (line 242 binary-expr) ----

  it('save confirm answered NO (not cancelled) → !saveit branch → cancel(), no save', async () => {
    // Force a real diff so allAssignments is non-empty and execution reaches the
    // final confirm. Then answer NO: isCancel(saveit) is false (left operand),
    // so the `|| !saveit` right operand is evaluated and is true → cancel path.
    writeConfig(dir)
    queueAxisNoChange()
    queueFeaturesNoChange()
    queueThresholdsNoChange()
    queueCollaborationNoChange()
    queueAccessNoChange()
    mockSelect.mockResolvedValueOnce('L1') // automation L0 → L1 (a real diff)
    mockConfirm.mockResolvedValueOnce(false) // final save confirm = NO (not cancelled)

    await runInteractiveConfigure(dir)

    // saveit === false → `!saveit` true → cancel() and early return.
    expect(mockCancel).toHaveBeenCalledWith(expect.any(String))
    expect(vi.mocked(runConfigure)).not.toHaveBeenCalled()
    expect(vi.mocked(saveConfig)).not.toHaveBeenCalled()
  })
})
