import { describe, it, expect, vi, beforeEach } from 'vitest'
import inquirer from 'inquirer'
import { determineFlow, buildMigrationPlan, runWizard } from '../../src/wizard/prompts.js'
import type { WizardInput } from '../../src/wizard/prompts.js'
import type { ExistingState } from '../../src/detectors/existing.js'
import { presetToTiers } from '../../src/invariants/filter.js'

vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}))

const mockPrompt = vi.mocked(inquirer.prompt)

function makeExisting(overrides: Partial<ExistingState> = {}): ExistingState {
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
    ...overrides,
  }
}

function makeWizardInput(existing: ExistingState = makeExisting()): WizardInput {
  return {
    targetDir: '/tmp/test',
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
      githubOwner: null,
      githubRepo: null,
      projectName: 'test-project',
    },
    existing,
    githubAccess: {
      available: false,
      authenticated: false,
      username: null,
      error: null,
    },
  }
}

describe('determineFlow', () => {
  it('returns greenfield when no governance files detected', () => {
    expect(determineFlow(makeExisting())).toBe('greenfield')
  })

  it('returns brownfield when AGENTS.md exists', () => {
    expect(determineFlow(makeExisting({ agentsMd: true }))).toBe('brownfield')
  })

  it('returns brownfield when .claude/ dir exists', () => {
    expect(determineFlow(makeExisting({ claudeDir: true }))).toBe('brownfield')
  })

  it('returns brownfield when .agents/ dir exists', () => {
    expect(determineFlow(makeExisting({ agentsDir: true }))).toBe('brownfield')
  })

  it('returns greenfield when only settingsJson or checkAllScript set', () => {
    expect(determineFlow(makeExisting({ settingsJson: true, checkAllScript: true }))).toBe(
      'greenfield',
    )
  })
})

describe('buildMigrationPlan', () => {
  it('puts AGENTS.md in replaced when agentsMd=true', () => {
    const existing = makeExisting({ agentsMd: true })
    const plan = buildMigrationPlan(existing, ['claude'], false)
    expect(plan.replaced.some((s) => s.includes('AGENTS.md'))).toBe(true)
    expect(plan.created.some((s) => s.includes('AGENTS.md'))).toBe(false)
  })

  it('puts AGENTS.md in created when agentsMd=false', () => {
    const existing = makeExisting()
    const plan = buildMigrationPlan(existing, ['claude'], false)
    expect(plan.created.some((s) => s.includes('AGENTS.md'))).toBe(true)
  })

  it('puts settings.json in merged when settingsJson=true and claude selected', () => {
    const existing = makeExisting({ claudeDir: true, settingsJson: true })
    const plan = buildMigrationPlan(existing, ['claude'], false)
    expect(plan.merged.some((s) => s.includes('settings.json'))).toBe(true)
  })

  it('puts existing .claude/ hooks in preserved when claudeDir=true', () => {
    const existing = makeExisting({ claudeDir: true })
    const plan = buildMigrationPlan(existing, ['claude'], false)
    expect(plan.preserved.some((s) => s.includes('hooks'))).toBe(true)
  })

  it('puts .claude/CLAUDE.md in replaced when claudeDir=true', () => {
    const existing = makeExisting({ claudeDir: true })
    const plan = buildMigrationPlan(existing, ['claude'], false)
    expect(plan.replaced.some((s) => s.includes('CLAUDE.md'))).toBe(true)
  })

  it('puts .agents/CODEX.md in replaced when agentsDir=true and codex selected', () => {
    const existing = makeExisting({ agentsDir: true })
    const plan = buildMigrationPlan(existing, ['codex'], false)
    expect(plan.replaced.some((s) => s.includes('CODEX.md'))).toBe(true)
  })

  it('includes github workflows in created when useGitHub=true', () => {
    const plan = buildMigrationPlan(makeExisting(), ['claude'], true)
    expect(plan.created.some((s) => s.toLowerCase().includes('github'))).toBe(true)
  })

  it('puts .gemini/GEMINI.md in created when gemini selected and no existing .gemini dir', () => {
    const plan = buildMigrationPlan(makeExisting(), ['gemini'], false)
    expect(plan.created.some((s) => s.includes('.gemini'))).toBe(true)
  })

  it('puts .gemini/GEMINI.md in replaced when geminiDir=true', () => {
    const existing = makeExisting({ geminiDir: true })
    const plan = buildMigrationPlan(existing, ['gemini'], false)
    expect(plan.replaced.some((s) => s.includes('GEMINI.md'))).toBe(true)
  })

  it('puts windsurf-instructions.md in created when windsurf selected and no existing file', () => {
    const plan = buildMigrationPlan(makeExisting(), ['windsurf'], false)
    expect(plan.created.some((s) => s.includes('windsurf'))).toBe(true)
  })

  it('puts windsurf-instructions.md in replaced when windsurfRules=true', () => {
    const existing = makeExisting({ windsurfRules: true })
    const plan = buildMigrationPlan(existing, ['windsurf'], false)
    expect(plan.replaced.some((s) => s.includes('windsurf'))).toBe(true)
  })

  it('puts .aider.conf.yml in created when aider selected and no existing file', () => {
    const plan = buildMigrationPlan(makeExisting(), ['aider'], false)
    expect(plan.created.some((s) => s.includes('.aider'))).toBe(true)
  })

  it('puts .aider.conf.yml in replaced when aiderConf=true', () => {
    const existing = makeExisting({ aiderConf: true })
    const plan = buildMigrationPlan(existing, ['aider'], false)
    expect(plan.replaced.some((s) => s.includes('.aider'))).toBe(true)
  })
})

describe('runWizard greenfield flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns config when user confirms', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result).not.toBeNull()
    expect(result!.tools).toEqual(['claude'])
    expect(result!.governanceLevel).toBe('L2')
  })

  it('returns null when user cancels at confirmation', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
      })

      .mockResolvedValueOnce({ confirm: false })

    const result = await runWizard(makeWizardInput())
    expect(result).toBeNull()
  })

  it('defaults to claude+codex when no tools selected', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: [],
        governanceLevel: 'L1',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.tools).toEqual(['claude', 'codex'])
  })
})

describe('runWizard brownfield flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns config when user confirms migration', async () => {
    const existing = makeExisting({ agentsMd: true, claudeDir: true })

    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput(existing))
    expect(result).not.toBeNull()
    expect(result!.tools).toEqual(['claude'])
  })

  it('returns null when user cancels migration', async () => {
    const existing = makeExisting({ agentsMd: true })

    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
      })

      .mockResolvedValueOnce({ confirm: false })

    const result = await runWizard(makeWizardInput(existing))
    expect(result).toBeNull()
  })
})

describe('runWizard invariant preset selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses essential preset tiers when user selects essential', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L1',
        invariantPreset: 'essential',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('essential'))
    expect(result!.invariantTiers).toContain('architectural')
    expect(result!.invariantTiers).toContain('governance')
    expect(result!.invariantTiers).not.toContain('security')
  })

  it('uses full preset tiers when user selects full', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L3',
        invariantPreset: 'full',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('full'))
    expect(result!.invariantTiers).toContain('security')
    expect(result!.invariantTiers).toContain('operational')
  })

  it('uses essential preset even when governance level is L2', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
        invariantPreset: 'essential',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    // essential has no data/operational tiers even though L2 default would be standard
    expect(result!.invariantTiers).toEqual(presetToTiers('essential'))
    expect(result!.invariantTiers).not.toContain('data')
    expect(result!.invariantTiers).not.toContain('operational')
  })

  it('falls back to governance-level default when preset omitted', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
        // no invariantPreset
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    // L2 default is "standard"
    expect(result!.invariantTiers).toEqual(presetToTiers('standard'))
  })

  it('L1 default preset is essential', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L1',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('essential'))
  })

  it('L3 default preset is full', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L3',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('full'))
  })
})

describe('runWizard ML — contractType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hasPublicApi=false → contractType defaults to none (when: skipped)', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
        archetype: 'library',
        architectureStyle: 'none',
        hasDatabase: false,
        hasPublicApi: false,
        isMultiTenant: false,
        // contractType absent: when: returned false, no answer provided
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.contractType).toBe('none')
  })

  it('hasPublicApi=true + contractType=graphql → contractType propagates', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
        archetype: 'backend-web-db',
        architectureStyle: 'none',
        hasDatabase: true,
        hasPublicApi: true,
        isMultiTenant: false,
        contractType: 'graphql',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.contractType).toBe('graphql')
  })
})

describe('decompositionBackend selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to markdown when gh not available', async () => {
    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.decompositionBackend).toBe('markdown')
    expect(result!.useGitHub).toBe(false)
  })

  it('uses github when user selects github from prompt', async () => {
    const input = makeWizardInput()
    input.githubAccess = {
      available: true,
      authenticated: true,
      username: 'testuser',
      error: null,
    }

    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
        decompositionBackend: 'github',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(input)
    expect(result!.decompositionBackend).toBe('github')
    expect(result!.useGitHub).toBe(true)
  })

  it('uses markdown when user selects markdown even with gh available', async () => {
    const input = makeWizardInput()
    input.githubAccess = {
      available: true,
      authenticated: true,
      username: 'testuser',
      error: null,
    }

    mockPrompt
      .mockResolvedValueOnce({
        description: 'my project',
        tools: ['claude'],
        governanceLevel: 'L2',
        decompositionBackend: 'markdown',
      })

      .mockResolvedValueOnce({ confirm: true })

    const result = await runWizard(input)
    expect(result!.decompositionBackend).toBe('markdown')
    expect(result!.useGitHub).toBe(false)
  })
})
