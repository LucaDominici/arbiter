// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../../src/wizard/index.js', () => ({ runWizard: vi.fn() }))
vi.mock('../../src/generators/registry.js', () => ({
  buildRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsFromRegistry: vi.fn().mockReturnValue([]),
  runGeneratorsSelective: vi.fn().mockReturnValue([]),
}))
vi.mock('../../src/compatibility/probe.js', () => ({
  runProbes: vi.fn().mockReturnValue({
    dir: '/tmp',
    stack: 'typescript',
    probes: [],
    hasFailures: false,
    hasWarnings: false,
  }),
}))
vi.mock('../../src/wizard/github.js', () => ({
  runGithubSetup: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/plugins/loader.js', () => ({
  runPlugins: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/decomposition/backend.js', () => ({
  runBackendSetup: vi.fn().mockReturnValue({ warnings: [] }),
}))
vi.mock('../../src/utils/run-cli.js', () => ({
  runCli: vi.fn().mockReturnValue({ exitCode: 0, stdout: '', stderr: '' }),
}))

const FIXTURE_PATH = new URL('../fixtures/recipes/library-typescript.json', import.meta.url)
  .pathname

describe('runInit with --recipe (#546)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-init-recipe-'))
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockReturnValue(undefined)
    vi.spyOn(console, 'error').mockReturnValue(undefined)
    vi.spyOn(console, 'warn').mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('completes without error when a valid local recipe is provided', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        tools: undefined,
        level: undefined,
        dir,
        dryRun: false,
        noVerify: true,
        recipe: FIXTURE_PATH,
      }),
    ).resolves.toBeUndefined()
  })

  it('respects governance level from recipe (L2)', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const mockBuild = vi.mocked(buildRegistry)

    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: false,
      noVerify: true,
      recipe: FIXTURE_PATH,
    })

    expect(mockBuild).toHaveBeenCalled()
    const config = mockBuild.mock.calls[0]?.[0]
    expect(config?.governanceLevel).toBe('L2')
  })

  it('respects tools from recipe', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const mockBuild = vi.mocked(buildRegistry)

    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      tools: undefined,
      level: undefined,
      dir,
      dryRun: false,
      noVerify: true,
      recipe: FIXTURE_PATH,
    })

    const config = mockBuild.mock.calls[0]?.[0]
    expect(config?.tools).toContain('claude')
    expect(config?.tools).toContain('codex')
  })

  it('rejects http:// recipe URL before running generators', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const mockBuild = vi.mocked(buildRegistry)

    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        dir,
        dryRun: false,
        noVerify: true,
        recipe: 'http://evil.example.com/recipe.json',
      }),
    ).rejects.toThrow(/https/i)

    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('malformed recipe file rejects before running generators', async () => {
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not valid json }')
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const mockBuild = vi.mocked(buildRegistry)

    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        dir,
        dryRun: false,
        noVerify: true,
        recipe: bad,
      }),
    ).rejects.toThrow()

    expect(mockBuild).not.toHaveBeenCalled()
  })

  // #1261: recipes are the supported non-interactive knob for autonomy — a
  // CI-provisioned repo must be able to land at L1+ without a manual post-step.
  it('recipe automation.autonomy=L3 lands in the generated arbiter.json (#1261)', async () => {
    const recipePath = join(dir, 'autonomy-recipe.json')
    writeFileSync(
      recipePath,
      JSON.stringify({
        tools: ['claude'],
        governanceLevel: 'L2',
        language: 'typescript',
        archetype: 'library',
        useGitHub: false,
        automation: { autonomy: 'L3' },
      }),
    )

    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      dir,
      dryRun: false,
      noVerify: true,
      recipe: recipePath,
    })

    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as {
      automation?: unknown
    }
    expect(raw.automation).toEqual({ autonomy: 'L3' })
  })

  it('recipe without automation defaults arbiter.json to autonomy L0 (#1261)', async () => {
    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      dir,
      dryRun: false,
      noVerify: true,
      recipe: FIXTURE_PATH,
    })

    const raw = JSON.parse(readFileSync(join(dir, 'arbiter.json'), 'utf-8')) as {
      automation?: unknown
    }
    expect(raw.automation).toEqual({ autonomy: 'L0' })
  })

  it('rejects a recipe with an invalid autonomy level before running generators (#1261)', async () => {
    const recipePath = join(dir, 'bad-autonomy-recipe.json')
    writeFileSync(recipePath, JSON.stringify({ tools: ['claude'], automation: { autonomy: 'L9' } }))
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const mockBuild = vi.mocked(buildRegistry)

    const { runInit } = await import('../../src/commands/init.js')
    await expect(
      runInit({
        yes: true,
        dir,
        dryRun: false,
        noVerify: true,
        recipe: recipePath,
      }),
    ).rejects.toThrow()

    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('--recipe + --level CLI flag: CLI level overrides recipe level', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const mockBuild = vi.mocked(buildRegistry)

    const { runInit } = await import('../../src/commands/init.js')
    await runInit({
      yes: true,
      level: 'L3',
      dir,
      dryRun: false,
      noVerify: true,
      recipe: FIXTURE_PATH,
    })

    const config = mockBuild.mock.calls[0]?.[0]
    expect(config?.governanceLevel).toBe('L3')
  })
})
