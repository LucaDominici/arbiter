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
