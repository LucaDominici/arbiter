// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/sizing/diff-signals.ts (#1486).
//
// The existing __tests__/sizing/diff-signals.test.ts exercises resolveShipTier through the
// INJECTED `gather` seam only. This file targets the branches that the injected seam skips:
//   - the module-private default gatherer `gatherGitDiffStat` (reached by OMITTING `gather`),
//     which shells out via the mocked `runCli` — covering numstat parsing, binary ("-") rows,
//     empty/blank lines, and the `dir`/`base` opt defaults + overrides;
//   - `safeGather`'s spread guards (dir/base present vs absent);
//   - resolveShipTier's invalid-explicitTier fall-through and the lines-only diff branch;
//   - formatSizeLines.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn(),
}))

import {
  resolveShipTier,
  formatSizeLines,
  type ResolvedSize,
  type DiffStatGatherer,
} from '../../src/sizing/diff-signals.js'
import { runCli, type RunCliResult } from '../../src/utils/run-cli.js'

const mockRunCli = vi.mocked(runCli)

/** Build a full RunCliResult so the typed runCli mock is satisfied (no partial literals). */
function cliResult(stdout: string): RunCliResult {
  return { stdout, stderr: '', exitCode: 0, durationMs: 1 }
}

beforeEach(() => {
  mockRunCli.mockReset()
})

describe('resolveShipTier — default git gatherer (gatherGitDiffStat via mocked runCli)', () => {
  it('parses a normal numstat diff (files + added/deleted lines summed)', () => {
    // 8 files >= DIFF_STD_MIN_FILES → Standard. Each row "add\tdel\tpath".
    const rows = Array.from({ length: 8 }, (_v: undefined, i: number) => `10\t2\tsrc/f${i}.ts`)
    mockRunCli.mockReturnValue(cliResult(rows.join('\n')))

    const r = resolveShipTier({})
    expect(r.source).toBe('diff')
    expect(r.tier).toBe('Standard')
    expect(mockRunCli).toHaveBeenCalledTimes(1)
  })

  it('counts a binary row ("-" add/del) as a file but adds zero lines', () => {
    // Two binary rows → 2 files, 0 lines. 2 files <= XS_MAX(2) AND 0 lines <= XS_MAX(40) → XS.
    mockRunCli.mockReturnValue(cliResult('-\t-\tassets/logo.png\n-\t-\tassets/icon.png\n'))

    const r = resolveShipTier({})
    expect(r.source).toBe('diff')
    expect(r.tier).toBe('XS')
  })

  it('skips blank/whitespace lines and trailing newline noise', () => {
    // One real row (1 file, 50 lines) plus blank lines that must be ignored.
    // 1 file but 50 lines > XS_MAX(40) and < STD_MIN(300) → S.
    mockRunCli.mockReturnValue(cliResult('\n   \n40\t10\tsrc/a.ts\n\n'))

    const r = resolveShipTier({})
    expect(r.source).toBe('diff')
    expect(r.tier).toBe('S')
  })

  it('treats a non-numeric numstat field as zero lines (parseNumstatField NaN guard)', () => {
    // "abc" → NaN → 0; "xyz" → NaN → 0. One file, zero counted lines → XS.
    mockRunCli.mockReturnValue(cliResult('abc\txyz\tsrc/weird.ts\n'))

    const r = resolveShipTier({})
    expect(r.source).toBe('diff')
    expect(r.tier).toBe('XS')
  })

  it('treats a missing del field (undefined) as zero (parseNumstatField undefined guard)', () => {
    // Row with only the add field present; del is undefined after split. 5 added lines.
    // 1 file, 5 lines → XS.
    mockRunCli.mockReturnValue(cliResult('5\tsrc/only-add.ts\n'))

    const r = resolveShipTier({})
    expect(r.source).toBe('diff')
    expect(r.tier).toBe('XS')
  })

  it('empty git output → zero stat → falls through to units branch', () => {
    mockRunCli.mockReturnValue(cliResult(''))

    const r = resolveShipTier({ units: 25 })
    expect(r.source).toBe('units')
    expect(r.tier).toBe('Standard')
  })

  it('empty git output and no units → fail-safe default WIDEST tier', () => {
    mockRunCli.mockReturnValue(cliResult('\n  \n'))

    const r = resolveShipTier({})
    expect(r.source).toBe('default')
    expect(r.tier).toBe('Standard')
  })

  it('a thrown runCli (git unavailable) is caught by safeGather → never throws', () => {
    mockRunCli.mockImplementation(() => {
      throw new Error('git not found')
    })

    expect(() => resolveShipTier({})).not.toThrow()
    const r = resolveShipTier({ units: 2 })
    expect(r.source).toBe('units')
    expect(r.tier).toBe('XS')
  })

  it('uses default base origin/main and no cwd when dir/base omitted', () => {
    mockRunCli.mockReturnValue(cliResult('1\t1\tsrc/x.ts\n'))

    resolveShipTier({})
    const call = mockRunCli.mock.calls[0]
    expect(call).toBeDefined()
    const [cmd, args, runOpts] = call as [string, readonly string[], { cwd?: string }]
    expect(cmd).toBe('git')
    expect(args).toContain('origin/main...HEAD')
    // dir omitted → runCli called with an empty options object (no cwd).
    expect(runOpts).toEqual({})
  })

  it('forwards an explicit base into the git ref range', () => {
    mockRunCli.mockReturnValue(cliResult('1\t1\tsrc/x.ts\n'))

    resolveShipTier({ base: 'develop' })
    const call = mockRunCli.mock.calls[0]
    expect(call).toBeDefined()
    const args = (call as [string, readonly string[], unknown])[1]
    expect(args).toContain('develop...HEAD')
  })

  it('forwards an explicit dir into the runCli cwd option', () => {
    mockRunCli.mockReturnValue(cliResult('1\t1\tsrc/x.ts\n'))

    resolveShipTier({ dir: '/tmp/some-repo' })
    const call = mockRunCli.mock.calls[0]
    expect(call).toBeDefined()
    const runOpts = (call as [string, readonly string[], { cwd?: string }])[2]
    expect(runOpts).toEqual({ cwd: '/tmp/some-repo' })
  })

  it('forwards both dir and base together (both spread guards active)', () => {
    mockRunCli.mockReturnValue(cliResult('1\t1\tsrc/x.ts\n'))

    resolveShipTier({ dir: '/tmp/repo2', base: 'main' })
    const call = mockRunCli.mock.calls[0]
    expect(call).toBeDefined()
    const [, args, runOpts] = call as [string, readonly string[], { cwd?: string }]
    expect(args).toContain('main...HEAD')
    expect(runOpts).toEqual({ cwd: '/tmp/repo2' })
  })
})

describe('resolveShipTier — explicit tier branch', () => {
  it('valid explicit tier short-circuits and never calls the gatherer', () => {
    const spyGather: DiffStatGatherer = vi.fn(() => ({ filesChanged: 99, linesChanged: 9999 }))

    const r = resolveShipTier({ explicitTier: 'S', gather: spyGather })
    expect(r.source).toBe('explicit')
    expect(r.tier).toBe('S')
    expect(spyGather).not.toHaveBeenCalled()
    expect(mockRunCli).not.toHaveBeenCalled()
  })

  it('an INVALID explicit tier falls through to the diff/units chain', () => {
    const noDiff: DiffStatGatherer = () => ({ filesChanged: 0, linesChanged: 0 })

    const r = resolveShipTier({ explicitTier: 'XXL', gather: noDiff, units: 2 })
    expect(r.source).toBe('units')
    expect(r.tier).toBe('XS')
  })

  it('every valid tier literal is accepted (XS/S/Standard branches of isValidTier)', () => {
    const tiers: ReadonlyArray<'XS' | 'S' | 'Standard'> = ['XS', 'S', 'Standard']
    for (const t of tiers) {
      const r = resolveShipTier({ explicitTier: t })
      expect(r.source).toBe('explicit')
      expect(r.tier).toBe(t)
    }
  })
})

describe('resolveShipTier — diff signal sub-branches via injected gather', () => {
  it('lines-only diff (filesChanged 0 but linesChanged > 0) still counts as a diff', () => {
    const linesOnly: DiffStatGatherer = () => ({ filesChanged: 0, linesChanged: 5 })

    const r = resolveShipTier({ gather: linesOnly })
    expect(r.source).toBe('diff')
    expect(r.tier).toBe('XS')
  })

  it('units present but zero → not used, falls to default', () => {
    const noDiff: DiffStatGatherer = () => ({ filesChanged: 0, linesChanged: 0 })

    const r = resolveShipTier({ gather: noDiff, units: 0 })
    expect(r.source).toBe('default')
    expect(r.tier).toBe('Standard')
  })
})

describe('formatSizeLines', () => {
  it('renders the size, source and verticals into a single step-output line', () => {
    const size: ResolvedSize = {
      tier: 'XS',
      verticals: ['bugs', 'type-safety', 'domain'],
      source: 'diff',
    }
    const lines = formatSizeLines(size)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('Size: XS (source: diff) · verticals: bugs, type-safety, domain')
  })

  it('renders a Standard tier with the full vertical floor', () => {
    const size: ResolvedSize = {
      tier: 'Standard',
      verticals: ['bugs', 'type-safety', 'domain', 'test-quality', 'security'],
      source: 'default',
    }
    const lines = formatSizeLines(size)
    expect(lines[0]).toContain('Size: Standard (source: default)')
    expect(lines[0]).toContain('security')
  })
})
