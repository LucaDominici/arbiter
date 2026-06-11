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

describe('buildConfigFromAnswers — automation.autonomy (#1261)', () => {
  it('threads the chosen autonomy answer into ProjectConfig.automation', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ autonomy: 'L2' }))
    expect(config.automation).toEqual({ autonomy: 'L2' })
  })

  it('defaults automation.autonomy to L0 when the answer is absent', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers())
    expect(config.automation).toEqual({ autonomy: 'L0' })
  })

  it('persists automation into arbiter.json (buildArbiterConfig passthrough)', async () => {
    const { buildArbiterConfig } = await import('../../src/commands/init.js')
    const arbiterJson = buildArbiterConfig(
      buildConfigFromAnswers(makeInput(), makeAnswers({ autonomy: 'L3' })),
    )
    expect(arbiterJson.automation).toEqual({ autonomy: 'L3' })
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
