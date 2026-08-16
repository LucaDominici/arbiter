// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTestProject, createTestProject, initGit } from '../helpers.js'
import { runUpdate } from '../../src/commands/update.js'
import { DEFAULT_THRESHOLDS } from '../../src/config/schema.js'

const CLAUDE_FILE = '.claude/CLAUDE.md'
const SAFETY_HOOK = '.claude/hooks/stop-dangerous.mjs'
const FRONTMATTER = '---\ntitle: custom\nstatus: active\n---\n'

function writeV2Config(dir: string): void {
  const config = {
    version: '0.2',
    tools: ['claude'],
    governanceLevel: 'L2',
    useGitHub: false,
    features: {
      contractTesting: false,
      mutationTesting: false,
      securityScanning: true,
      evidenceHarness: false,
      debtGates: true,
      suppressions: true,
    },
    thresholds: { ...DEFAULT_THRESHOLDS.L2 },
    invariantTiers: ['architectural', 'governance', 'security'],
  }
  writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(config, null, 2) + '\n')
}

function backupFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' }).filter((path) =>
    path.endsWith('.arbiter-backup'),
  )
}

describe('update emission regeneration (#2220)', () => {
  let dir: string
  let logs: string[]

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
    writeV2Config(dir)
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanupTestProject(dir)
  })

  it('preserves hand-customized informative files in a no-manifest tree; safety hooks adopt with a reversible override', async () => {
    await runUpdate({ dir, json: true, github: false })
    rmSync(join(dir, '.arbiter-generated-manifest.json'))

    const claudePath = join(dir, CLAUDE_FILE)
    const hookPath = join(dir, SAFETY_HOOK)
    const patchedHook = '// locally patched safety hook\n' + readFileSync(hookPath, 'utf-8')
    writeFileSync(claudePath, FRONTMATTER + readFileSync(claudePath, 'utf-8'))
    writeFileSync(hookPath, patchedHook)

    const stored = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    stored.permitGitHub = true
    writeFileSync(join(dir, 'arbiter.json'), JSON.stringify(stored, null, 2) + '\n')

    // #2257: flipping permitGitHub newly lands scripts/check-merge-method.mjs
    // (the merge-method-ff-only gate) while THIS fixture's manifest-less
    // check-all.mjs is withheld as user-modified — so `arbiter update` correctly
    // reports the gate as shipped-but-unwired and exits recoverable-non-zero.
    // That report is a feature, not a regression: assert it rather than let
    // process.exit abort the runner mid-test. Before #2257 the second render was
    // byte-identical to the first (the workflow gates keyed off the live-API
    // `useGitHub` flag, false on the update path), so nothing was withheld and
    // the warning never fired — the same drift the RTM cell in
    // greenfield-first-run.test.ts now covers end-to-end.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await runUpdate({ dir, json: true, github: false })
    exitSpy.mockRestore()
    expect(logs.join('\n')).toContain('check-merge-method.mjs added but check-all.mjs is withheld')

    // Informative classes (CLAUDE.md, arbiter.json) are provenance-gated (#2220):
    // preserved, never clobbered, no backup residue.
    expect(readFileSync(claudePath, 'utf-8').startsWith('---\ntitle: custom\n')).toBe(true)
    expect(existsSync(`${claudePath}.arbiter-backup`)).toBe(false)
    const after = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(after.permitGitHub).toBe(true)
    // Safety class is adopt-by-default (contract, update.ts noAdoptSafety): the
    // shipped hook lands so enforcement stays live (Consumer Reliability Bar),
    // and the hand-patched content is preserved REVERSIBLY in local-overrides.
    expect(readFileSync(hookPath, 'utf-8').startsWith('// locally patched safety hook')).toBe(false)
    const overridesDir = join(dir, '.arbiter', 'evidence', 'local-overrides')
    const records = readdirSync(overridesDir).map(
      (file) =>
        JSON.parse(readFileSync(join(overridesDir, file), 'utf-8')) as {
          path: string
          priorContent: string
        },
    )
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: SAFETY_HOOK, priorContent: patchedHook }),
      ]),
    )
  })

  it('leaves no .arbiter-backup residue after a clean update', async () => {
    await runUpdate({ dir, json: true, github: false })

    expect(backupFiles(dir)).toEqual([])
  })

  it('withholds a customized CLAUDE.md by default and force-adopts it explicitly', async () => {
    await runUpdate({ dir, json: true, github: false })

    const claudePath = join(dir, CLAUDE_FILE)
    const customized = FRONTMATTER + readFileSync(claudePath, 'utf-8')
    writeFileSync(claudePath, customized)

    await runUpdate({ dir, json: true, github: false })
    expect(readFileSync(claudePath, 'utf-8')).toBe(customized)

    await runUpdate({ dir, json: true, github: false, adopt: true })
    expect(readFileSync(claudePath, 'utf-8').startsWith(FRONTMATTER)).toBe(false)

    const overridesDir = join(dir, '.arbiter', 'evidence', 'local-overrides')
    const records = readdirSync(overridesDir).map(
      (file) =>
        JSON.parse(readFileSync(join(overridesDir, file), 'utf-8')) as {
          path: string
          priorContent: string
        },
    )
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: CLAUDE_FILE, priorContent: customized }),
      ]),
    )
  })
})
