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

  beforeEach(() => {
    dir = createTestProject('typescript')
    initGit(dir)
    writeV2Config(dir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
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

    await runUpdate({ dir, json: true, github: false })

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
