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

  it('enableDeployWorkflows derives true when deployTarget is ghcr', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'backend-web-db' }))
    expect(config.deployTarget).toBe('ghcr')
    expect(config.enableDeployWorkflows).toBe(true)
  })

  it('enableDeployWorkflows derives false when deployTarget is none', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'cli' }))
    expect(config.deployTarget).toBe('none')
    expect(config.enableDeployWorkflows).toBe(false)
  })

  it('enableAzureContainerApp derives true when deployTarget is azure-container-app', () => {
    const config = buildConfigFromAnswers(
      makeInput(),
      makeAnswers({ archetype: 'backend-web-db', deployTarget: 'azure-container-app' }),
    )
    expect(config.enableAzureContainerApp).toBe(true)
  })

  it('enableAzureContainerApp derives false when deployTarget is ghcr', () => {
    const config = buildConfigFromAnswers(makeInput(), makeAnswers({ archetype: 'backend-web-db' }))
    expect(config.enableAzureContainerApp).toBe(false)
  })
})
