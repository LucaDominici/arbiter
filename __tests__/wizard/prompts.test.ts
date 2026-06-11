import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as clack from '@clack/prompts'
import { determineFlow, buildMigrationPlan, runWizard } from '../../src/wizard/prompts.js'
import type { WizardInput } from '../../src/wizard/prompts.js'
import type { ExistingState } from '../../src/detectors/existing.js'
import { presetToTiers } from '../../src/invariants/filter.js'

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
}))

vi.mock('../../src/utils/fs.js', () => ({
  cleanupInFlightTmpFiles: vi.fn(),
}))

/**
 * Wizard prompts are now collected via sequential @clack/prompts calls. Tests
 * drive them with a message-keyed mockImplementation rather than a positional
 * mockResolvedValueOnce chain: each test passes a partial `answers` object, and
 * any key it omits resolves to `undefined` — exactly mirroring inquirer's old
 * "field absent from the batch" behaviour, which `buildConfigFromAnswers`
 * absorbs through its `?? default` fallbacks. This keeps the matrix stable when
 * conditional prompts (language list, contractType, decompositionBackend) skip.
 */
interface ClackAnswers {
  keepDetectedLanguage?: boolean
  language?: string
  description?: string
  tools?: string[]
  governanceLevel?: string
  invariantPreset?: string
  archetype?: string
  architectureStyle?: string
  hasDatabase?: boolean
  hasPublicApi?: boolean
  isMultiTenant?: boolean
  contractType?: string
  decompositionBackend?: string
  collaborationMode?: string
  pipelineStyle?: string
  brownfieldClass?: string
  industryOverlay?: string
  autonomy?: string
  /** Final "Proceed?" confirmation. Defaults to true. */
  proceed?: boolean
}

const CANCEL = Symbol('clack-cancel')

/** Wire the @clack mocks to answer by prompt message. */
function setupClack(answers: ClackAnswers): void {
  vi.mocked(clack.isCancel).mockImplementation((v): v is symbol => typeof v === 'symbol')
  vi.mocked(clack.text).mockResolvedValue(answers.description ?? 'mock project')
  vi.mocked(clack.multiselect).mockResolvedValue(answers.tools ?? [])
  vi.mocked(clack.confirm).mockImplementation(async ({ message }: { message: string }) => {
    if (message.includes('Proceed')) return answers.proceed ?? true
    // language confirmation (Use detected language …?)
    return answers.keepDetectedLanguage ?? true
  })
  vi.mocked(clack.select).mockImplementation(async ({ message }: { message: string }) => {
    if (message.startsWith('Select language')) return answers.language
    if (message.startsWith('Governance level')) return answers.governanceLevel
    if (message.startsWith('Invariant coverage')) return answers.invariantPreset
    if (message.startsWith('Project archetype')) return answers.archetype
    if (message.startsWith('Internal architecture style')) return answers.architectureStyle
    if (message.startsWith('Does the project connect to a database')) return answers.hasDatabase
    if (message.startsWith('Does the project expose a public API')) return answers.hasPublicApi
    if (message.startsWith('Is the project multi-tenant')) return answers.isMultiTenant
    if (message.startsWith('Contract testing style')) return answers.contractType
    if (message.startsWith('Decomposition backend')) return answers.decompositionBackend
    if (message.startsWith('Collaboration mode')) return answers.collaborationMode
    if (message.startsWith('Pipeline style')) return answers.pipelineStyle
    if (message.startsWith('Brownfield class')) return answers.brownfieldClass
    if (message.startsWith('Industry compliance overlay')) return answers.industryOverlay
    if (message.startsWith('Ship autonomy level')) return answers.autonomy
    return undefined
  })
}

/** Make the prompt whose message matches `predicate` return a cancel symbol. */
function cancelSelectWhen(predicate: (message: string) => boolean): void {
  vi.mocked(clack.select).mockImplementation(async ({ message }: { message: string }) =>
    predicate(message) ? CANCEL : undefined,
  )
}

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
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
  })

  it('returns config when user confirms', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result).not.toBeNull()
    expect(result!.tools).toEqual(['claude'])
    expect(result!.governanceLevel).toBe('L2')
  })

  // #1254: overlay axis surfaced as a wizard prompt + resulting-cell advisory.
  it('threads the selected industryOverlay into the resulting config', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L3',
      industryOverlay: 'iso27001',
      proceed: true,
    })
    const result = await runWizard(makeWizardInput())
    expect(result!.industryOverlay).toBe('iso27001')
  })

  it('prints the resulting (team × compliance) cell summary after the overlay choice', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L3',
      collaborationMode: 'gated-review',
      industryOverlay: 'pharma',
      proceed: true,
    })
    await runWizard(makeWizardInput())
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('')
    writeSpy.mockRestore()
    // the advisory must name the chosen cell and what it produces
    expect(out).toMatch(/pharma/)
    expect(out).toMatch(/gated-review|branching|gates|overlay/i)
  })

  it('warns when a heavy overlay is chosen under lenient governance (pharma @ L1)', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      industryOverlay: 'pharma',
      proceed: true,
    })
    await runWizard(makeWizardInput())
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('')
    writeSpy.mockRestore()
    expect(out).toMatch(/pharma/)
    // the L1+heavy advisory should surface (WARN copy mentions governanceLevel)
    expect(out).toMatch(/governanceLevel|heavy|coherent|⚠/i)
  })

  it('returns null when user cancels at confirmation', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: false,
    })

    const result = await runWizard(makeWizardInput())
    expect(result).toBeNull()
    // An explicit decline is NOT an abort: exitCode stays 0.
    expect(process.exitCode).toBe(0)
  })

  it('defaults to claude+codex when no tools selected', async () => {
    setupClack({ description: 'my project', tools: [], governanceLevel: 'L1', proceed: true })

    const result = await runWizard(makeWizardInput())
    expect(result!.tools).toEqual(['claude', 'codex'])
  })

  it('returns null, prints abort message, and sets exitCode 130 on Ctrl+C at main prompt (#621)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setupClack({ description: 'my project', tools: ['claude'], governanceLevel: 'L2' })
    // Cancel the first select prompt (governance level).
    cancelSelectWhen((m) => m.startsWith('Governance level'))

    const result = await runWizard(makeWizardInput())
    expect(result).toBeNull()
    expect(process.exitCode).toBe(130)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Aborted — no changes made'))
    consoleSpy.mockRestore()
  })

  it('returns null, prints abort message, and sets exitCode 130 on Ctrl+C at confirm prompt (#621)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setupClack({ description: 'my project', tools: ['claude'], governanceLevel: 'L2' })
    // The final confirm returns a cancel symbol.
    vi.mocked(clack.confirm).mockImplementation(async ({ message }: { message: string }) =>
      message.includes('Proceed') ? CANCEL : true,
    )

    const result = await runWizard(makeWizardInput())
    expect(result).toBeNull()
    expect(process.exitCode).toBe(130)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Aborted — no changes made'))
    consoleSpy.mockRestore()
  })

  it('re-throws unexpected (non-cancel) errors from a prompt (#318)', async () => {
    setupClack({ description: 'my project', tools: ['claude'], governanceLevel: 'L2' })
    vi.mocked(clack.select).mockImplementation(async ({ message }: { message: string }) => {
      if (message.startsWith('Governance level')) throw new Error('unexpected failure')
      return undefined
    })

    await expect(runWizard(makeWizardInput())).rejects.toThrow('unexpected failure')
  })
})

// #1261: ship-autonomy prompt — the wizard writes the Project Profile autonomy axis.
describe('runWizard autonomy prompt (#1261)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
  })

  it('asks the autonomy select with safe default L0 (initialValue)', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    await runWizard(makeWizardInput())
    const autonomyCall = vi
      .mocked(clack.select)
      .mock.calls.find((c) =>
        (c[0] as { message: string }).message.startsWith('Ship autonomy level'),
      )
    expect(autonomyCall).toBeDefined()
    expect((autonomyCall![0] as { initialValue?: string }).initialValue).toBe('L0')
  })

  it('threads the selected autonomy into config.automation', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      autonomy: 'L2',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.automation).toEqual({ autonomy: 'L2' })
  })

  it('defaults config.automation to L0 when the prompt is left at its default', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.automation).toEqual({ autonomy: 'L0' })
  })

  it('cancel at the autonomy prompt aborts the wizard with exitCode 130', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
    })
    cancelSelectWhen((m) => m.startsWith('Ship autonomy level'))

    const result = await runWizard(makeWizardInput())
    expect(result).toBeNull()
    expect(process.exitCode).toBe(130)
  })

  it('echoes the chosen autonomy in the resulting-cell summary', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      autonomy: 'L1',
      proceed: true,
    })
    await runWizard(makeWizardInput())
    const out = writeSpy.mock.calls.map((c) => String(c[0])).join('')
    writeSpy.mockRestore()
    expect(out).toMatch(/autonomy: L1/)
  })
})

describe('runWizard brownfield flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns config when user confirms migration', async () => {
    const existing = makeExisting({ agentsMd: true, claudeDir: true })
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput(existing))
    expect(result).not.toBeNull()
    expect(result!.tools).toEqual(['claude'])
  })

  it('returns null when user cancels migration', async () => {
    const existing = makeExisting({ agentsMd: true })
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: false,
    })

    const result = await runWizard(makeWizardInput(existing))
    expect(result).toBeNull()
  })
})

describe('runWizard invariant preset selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses essential preset tiers when user selects essential', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      invariantPreset: 'essential',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('essential'))
    expect(result!.invariantTiers).toContain('architectural')
    expect(result!.invariantTiers).toContain('governance')
    expect(result!.invariantTiers).not.toContain('security')
  })

  it('uses full preset tiers when user selects full', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L3',
      invariantPreset: 'full',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('full'))
    expect(result!.invariantTiers).toContain('security')
    expect(result!.invariantTiers).toContain('operational')
  })

  it('uses essential preset even when governance level is L2', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      invariantPreset: 'essential',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('essential'))
    expect(result!.invariantTiers).not.toContain('data')
    expect(result!.invariantTiers).not.toContain('operational')
  })

  it('falls back to governance-level default when preset omitted', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      // invariantPreset omitted → select resolves undefined → buildConfig uses L2 default
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('standard'))
  })

  it('L1 default preset is essential', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('essential'))
  })

  it('L3 default preset is full', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L3',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.invariantTiers).toEqual(presetToTiers('full'))
  })
})

describe('runWizard ML — contractType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hasPublicApi=false → contractType defaults to none (prompt skipped)', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      archetype: 'library',
      architectureStyle: 'none',
      hasDatabase: false,
      hasPublicApi: false,
      isMultiTenant: false,
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.contractType).toBe('none')
  })

  it('does NOT show the contractType prompt when hasPublicApi=false (when→imperative)', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      archetype: 'library',
      architectureStyle: 'none',
      hasDatabase: false,
      hasPublicApi: false,
      isMultiTenant: false,
      proceed: true,
    })

    await runWizard(makeWizardInput())
    const askedContract = vi
      .mocked(clack.select)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Contract testing'))
    expect(askedContract).toBe(false)
  })

  it('shows the contractType prompt and propagates the value when hasPublicApi=true', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      archetype: 'backend-web-db',
      architectureStyle: 'none',
      hasDatabase: true,
      hasPublicApi: true,
      isMultiTenant: false,
      contractType: 'graphql',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    const askedContract = vi
      .mocked(clack.select)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Contract testing'))
    expect(askedContract).toBe(true)
    expect(result!.contractType).toBe('graphql')
  })
})

describe('decompositionBackend selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to markdown when gh not available', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const result = await runWizard(makeWizardInput())
    expect(result!.decompositionBackend).toBe('markdown')
    expect(result!.useGitHub).toBe(false)
  })

  it('does NOT show decomposition prompt when gh unavailable', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    await runWizard(makeWizardInput())
    const asked = vi
      .mocked(clack.select)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Decomposition'))
    expect(asked).toBe(false)
  })

  it('uses github when user selects github from prompt', async () => {
    const input = makeWizardInput()
    input.githubAccess = { available: true, authenticated: true, username: 'testuser', error: null }
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      decompositionBackend: 'github',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result!.decompositionBackend).toBe('github')
    expect(result!.useGitHub).toBe(true)
  })

  it('uses markdown when user selects markdown even with gh available', async () => {
    const input = makeWizardInput()
    input.githubAccess = { available: true, authenticated: true, username: 'testuser', error: null }
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      decompositionBackend: 'markdown',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result!.decompositionBackend).toBe('markdown')
    expect(result!.useGitHub).toBe(false)
  })
})

describe('runWizard language confirmation (#1036)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })

  afterEach(() => {
    process.exitCode = 0
  })

  it('skips language prompt and uses wizardInput.language when languageLocked=true', async () => {
    const input = makeWizardInput()
    input.languageLocked = true
    input.language = 'rust'

    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.language).toBe('rust')
    // Neither the language confirm nor the language list should have been shown.
    const askedLangList = vi
      .mocked(clack.select)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Select language'))
    expect(askedLangList).toBe(false)
  })

  it('uses detected language when user confirms (keepDetectedLanguage=true)', async () => {
    const input = makeWizardInput()
    input.language = 'go'

    setupClack({
      keepDetectedLanguage: true,
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.language).toBe('go')
    // List skipped because the user kept the detected language.
    const askedLangList = vi
      .mocked(clack.select)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Select language'))
    expect(askedLangList).toBe(false)
  })

  it('shows list and uses selection when user declines detected (keepDetectedLanguage=false)', async () => {
    const input = makeWizardInput()
    input.language = 'typescript'

    setupClack({
      keepDetectedLanguage: false,
      language: 'java',
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.language).toBe('java')
    const askedLangList = vi
      .mocked(clack.select)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Select language'))
    expect(askedLangList).toBe(true)
  })

  it('shows list directly (no confirm) and uses selection when language is unknown', async () => {
    const input = makeWizardInput()
    input.language = 'unknown'

    setupClack({
      language: 'python',
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.language).toBe('python')
    // The "Use detected language" confirm must NOT be shown for unknown.
    const askedKeep = vi
      .mocked(clack.confirm)
      .mock.calls.some((c) => (c[0] as { message: string }).message.startsWith('Use detected'))
    expect(askedKeep).toBe(false)
  })

  it('existing tests: detected language injected when list selection is skipped', async () => {
    const input = makeWizardInput()
    input.language = 'typescript'

    setupClack({
      keepDetectedLanguage: true,
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.language).toBe('typescript')
  })
})
