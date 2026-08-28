// Tests for deployTarget derivation in buildConfigFromAnswers (#1005 PR-B).
import { describe, it, expect } from 'vitest'
import { buildConfigFromAnswers } from '../../src/wizard/prompts.js'
import type { WizardInput } from '../../src/wizard/prompts.js'
import type { WizardAnswers } from '../../src/wizard/types.js'
import type { ExistingState } from '../../src/detectors/existing.js'

function makeExisting(): ExistingState {
  return {
    agentsMd: false,
    claudeDir: false,
    agentsDir: false,
    aiRulez: false,
    settingsJson: false,
    checkAllScript: false,
    geminiDir: false,
    windsurfRules: false,
    aiderConf: false,
  }
}

function makeInput(): WizardInput {
  return {
    targetDir: '/tmp/test-project',
    projectName: 'test-project',
    language: 'typescript',
    framework: null,
    buildCmds: {
      buildTool: 'npm',
      buildCommand: 'npm run build',
      testCommand: 'npm test',
      lintCommand: 'npm run lint',
      formatCommand: 'npx prettier --check .',
    },
    gitInfo: {
      isGitRepo: true,
      remoteUrl: null,
      githubOwner: 'acme',
      githubRepo: 'my-service',
      projectName: 'my-service',
    },
    existing: makeExisting(),
    githubAccess: {
      available: false,
      authenticated: false,
      username: null,
      error: null,
    },
  }
}

function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    description: 'Test service',
    tools: ['claude'],
    language: 'typescript',
    governanceLevel: 'L2',
    archetype: 'backend-web-db',
    architectureStyle: 'none',
    hasDatabase: false,
    hasPublicApi: false,
    isMultiTenant: false,
    decompositionBackend: 'markdown',
    ...overrides,
  }
}

describe('buildConfigFromAnswers — deployTarget derivation (#1005)', () => {
  it('backend-web-db without explicit deployTarget answer defaults to ghcr', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'backend-web-db' }))
    expect(config.deployTarget).toBe('ghcr')
  })

  it('cli forces deployTarget to none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'cli' }))
    expect(config.deployTarget).toBe('none')
  })

  it('library forces deployTarget to none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'library' }))
    expect(config.deployTarget).toBe('none')
  })

  it('data-pipeline forces deployTarget to none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'data-pipeline' }))
    expect(config.deployTarget).toBe('none')
  })

  it('frontend-spa forces deployTarget to none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'frontend-spa' }))
    expect(config.deployTarget).toBe('none')
  })

  it('embedded forces deployTarget to none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'embedded' }))
    expect(config.deployTarget).toBe('none')
  })

  // #1145/#1146: enableDeployWorkflows + enableAzureContainerApp removed; deploy
  // emission now keys directly off deployTarget. The explicit azure answer must
  // still flow through to config.deployTarget.
  it('cli archetype yields deployTarget none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'cli' }))
    expect(config.deployTarget).toBe('none')
  })

  it('explicit azure-container-app answer flows through to deployTarget', () => {
    const config = buildConfigFromAnswers(
      makeInput(),
      makeAnswers({ archetype: 'backend-web-db', deployTarget: 'azure-container-app' }),
    )
    expect(config.deployTarget).toBe('azure-container-app')
  })
})

describe('buildConfigFromAnswers — industryOverlay axis (#1254)', () => {
  it('threads the chosen industryOverlay answer into the ProjectConfig', () => {
    const config = buildConfigFromAnswers(
      makeInput(),
      makeAnswers({ industryOverlay: 'iso27001', governanceLevel: 'L3' }),
    )
    expect(config.industryOverlay).toBe('iso27001')
  })

  it('omits industryOverlay when the answer is absent (treated as none downstream)', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    expect(config.industryOverlay === undefined || config.industryOverlay === 'none').toBe(true)
  })

  it('end-to-end: a chosen overlay cell enables the matching registry spec', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const config = buildConfigFromAnswers(
      makeInput(),
      makeAnswers({ industryOverlay: 'iso9001', governanceLevel: 'L2' }),
    )
    const spec = buildRegistry(config).find((s) => s.key === 'iso9001')
    expect(spec?.enabled).toBe(true)
  })

  it('persists industryOverlay into arbiter.json (buildArbiterConfig passthrough)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const projectConfig = buildConfigFromAnswers(
      makeInput(),
      makeAnswers({ industryOverlay: 'pharma', governanceLevel: 'L3' }),
    )
    const arbiterJson = buildArbiterConfig(projectConfig)
    expect((arbiterJson as { industryOverlay?: string }).industryOverlay).toBe('pharma')
  })

  it('omits industryOverlay from arbiter.json when none/absent', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(buildConfigFromAnswers(makeInput(), makeAnswers()))
    expect('industryOverlay' in arbiterJson).toBe(false)
  })

  it('round-trips: persisted overlay is read back into ProjectConfig + validates', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const { validateConfig } = await import('../../src/config/schema.js')
    const { resolveProjectConfig } = await import('../../src/config/resolve-project-config.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(
        makeInput(),
        makeAnswers({ industryOverlay: 'iso27001', governanceLevel: 'L4' }),
      ),
    )
    // round-trips through serialize → validate (bake asserts this) → resolve
    const validated = validateConfig(JSON.parse(JSON.stringify(arbiterJson)))
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const { config } = resolveProjectConfig('/tmp/test-project', 'test-project', validated.config)
    expect(config.industryOverlay).toBe('iso27001')
  })
})

describe('buildConfigFromAnswers — cross-model review (#2356)', () => {
  const crossModelReview = {
    enabled: true,
    diffEgressConsent: true,
    providers: ['codex'] as ['codex'],
    slots: { codeReview: 1, redTeamReview: 0 },
    timeoutMs: 300000,
    onUnavailable: 'degrade' as const,
  }

  it('threads an affirmative answer into ProjectConfig', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ crossModelReview }))
    expect(config.crossModelReview).toEqual(crossModelReview)
  })

  it('omits the block when the conditional question is skipped or declined', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    expect(config.crossModelReview).toBeUndefined()
  })

  it('persists the affirmative block into arbiter.json', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const config = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ crossModelReview })),
    )
    expect(config.crossModelReview).toEqual(crossModelReview)
  })
})

describe('buildConfigFromAnswers — runnerProfile axis (#1693, ADR-101)', () => {
  it('threads the chosen runnerProfile answer into the ProjectConfig', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ runnerProfile: 'solo' }))
    expect(config.runnerProfile).toBe('solo')
  })

  it('defaults runnerProfile to fleet when the answer is absent', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    expect(config.runnerProfile).toBe('fleet')
  })

  it('persists runnerProfile=solo into arbiter.json (buildArbiterConfig passthrough)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ runnerProfile: 'solo' })),
    )
    expect((arbiterJson as { runnerProfile?: string }).runnerProfile).toBe('solo')
  })

  it('omits runnerProfile from arbiter.json when fleet (default collapses to absence)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(buildConfigFromAnswers(makeInput(), makeAnswers()))
    expect('runnerProfile' in arbiterJson).toBe(false)
  })

  it('round-trips: persisted solo profile is read back into ProjectConfig + validates', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const { validateConfig } = await import('../../src/config/schema.js')
    const { resolveProjectConfig } = await import('../../src/config/resolve-project-config.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ runnerProfile: 'solo' })),
    )
    const validated = validateConfig(JSON.parse(JSON.stringify(arbiterJson)))
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const { config } = resolveProjectConfig('/tmp/test-project', 'test-project', validated.config)
    expect(config.runnerProfile).toBe('solo')
  })
})

describe('buildConfigFromAnswers — automation.autonomy (#1261)', () => {
  it('threads the chosen autonomy answer into ProjectConfig.automation', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ autonomy: 'L2' }))
    expect(config.automation?.autonomy).toBe('L2')
  })

  it('defaults automation.autonomy to L0 when the answer is absent', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    expect(config.automation?.autonomy).toBe('L0')
  })

  it('persists automation into arbiter.json (buildArbiterConfig passthrough)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ autonomy: 'L3' })),
    )
    expect(arbiterJson.automation?.autonomy).toBe('L3')
  })
})

// #1306 (ADR-094 §Decision.4 + §Decision.6): the orchestration prefs are
// DERIVED by the wizard (not asked) and INHERIT into the generated arbiter.json.
describe('buildConfigFromAnswers — automation prefs derivation + inheritance (#1306)', () => {
  it('derives the prefs for peer-review @ L2 (default answers)', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    // peer-review → 3 worktrees; L2 governance → L1 gate.
    expect(config.automation).toEqual({
      autonomy: 'L0',
      maxParallelWorktrees: 3,
      defaultGateLevel: 'L1',
    })
  })

  it('derives trunk-solo prefs (1 worktree) and L2 gate at L3', () => {
    const config = buildConfigFromAnswers(
      makeInput(),
      makeAnswers({ collaborationMode: 'trunk-solo', governanceLevel: 'L3' }),
    )
    expect(config.automation).toEqual({
      autonomy: 'L0',
      maxParallelWorktrees: 1,
      defaultGateLevel: 'L2',
    })
  })

  it('inherits the derived prefs into the generated arbiter.json (dual-sided, ADR-093 §5)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ collaborationMode: 'peer-review' })),
    )
    expect(arbiterJson.automation).toEqual({
      autonomy: 'L0',
      maxParallelWorktrees: 3,
      defaultGateLevel: 'L1',
    })
  })

  it('round-trips: generated prefs read back validate ok', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const { validateConfig } = await import('../../src/config/schema.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ governanceLevel: 'L4' })),
    )
    const validated = validateConfig(JSON.parse(JSON.stringify(arbiterJson)))
    expect(validated.ok).toBe(true)
  })
})

describe('buildConfigFromAnswers — language override (#1036)', () => {
  it('uses answers.language, not input.language', () => {
    const input = { ...makeInput(), language: 'typescript' as const }
    const answers = makeAnswers({ language: 'java' })
    const config = buildConfigFromAnswers(input, answers)
    expect(config.language).toBe('java')
  })

  it('preserves detected language when not overridden', () => {
    const input = { ...makeInput(), language: 'rust' as const }
    const answers = makeAnswers({ language: 'rust' })
    const config = buildConfigFromAnswers(input, answers)
    expect(config.language).toBe('rust')
  })
})

// #1835 (Task B, #1825): enableFiveLaneCi previously had NO public activation
// path — the ci-five-lane generator existed but was unreachable from the wizard,
// any CLI flag, recipes, or presets. These pin the wizard-answer mapping and the
// arbiter.json persistence round-trip (features.fiveLaneCi) so `arbiter update`
// cannot silently drop the axis.
describe('buildConfigFromAnswers — enableFiveLaneCi activation (#1835)', () => {
  it('threads enableFiveLaneCi: true into the ProjectConfig', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ enableFiveLaneCi: true }))
    expect(config.enableFiveLaneCi).toBe(true)
  })

  it('defaults enableFiveLaneCi to false when the answer is absent', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    expect(config.enableFiveLaneCi).toBe(false)
  })

  it('persists features.fiveLaneCi into arbiter.json (buildArbiterConfig passthrough)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const on = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ enableFiveLaneCi: true })),
    )
    const off = buildArbiterConfig(buildConfigFromAnswers(makeInput(), makeAnswers()))
    expect(on.features.fiveLaneCi).toBe(true)
    expect(off.features.fiveLaneCi).toBe(false)
  })

  it('round-trips: persisted fiveLaneCi validates ok', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const { validateConfig } = await import('../../src/config/schema.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ enableFiveLaneCi: true })),
    )
    const validated = validateConfig(JSON.parse(JSON.stringify(arbiterJson)))
    expect(validated.ok).toBe(true)
  })
})
