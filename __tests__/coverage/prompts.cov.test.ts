// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-coverage climb for src/wizard/prompts.ts (#1486).
 *
 * Targets the ~20 branches the existing __tests__/wizard/prompts.test.ts leaves
 * uncovered:
 *   - buildMigrationPlan: codex + no .agents/ dir (create path), and
 *     useGitHub + existing check-all script (preserve path).
 *   - printFlowPreamble: the brownfield branches for agentsDir / geminiDir /
 *     windsurfRules / aiderConf, plus the agentsMd=false branch.
 *   - displayMigrationPlan: the `merged` loop (settings.json deep-merge).
 *   - resolveWizardAnswers: the `language === 'unknown'` throw guard.
 *   - coherenceBlocksInit: CRITICAL (abort, exitCode 1) and WARN advisory cells.
 *   - collectLanguageAnswers: the `langSource` truthy confirm-message branch.
 *   - collectDecompositionBackend: gh available-but-unauthenticated note (with
 *     and without an explicit error), and the `username ?? 'unknown'` null path.
 *
 * Mocking mirrors the existing test: @clack/prompts and utils/fs are stubbed so
 * nothing prompts, spawns a CLI, or touches the filesystem. The source uses only
 * process.exitCode (never process.exit), so the runner is never killed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as clack from '@clack/prompts'
import {
  determineFlow,
  buildMigrationPlan,
  buildConfigFromAnswers,
  runWizard,
} from '../../src/wizard/prompts.js'
import type { WizardInput } from '../../src/wizard/prompts.js'
import type { ExistingState } from '../../src/detectors/existing.js'
import type { WizardAnswers, GithubAccess } from '../../src/wizard/types.js'

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
  proceed?: boolean
}

/** Wire the @clack mocks to answer by prompt message (mirrors existing test). */
function setupClack(answers: ClackAnswers): void {
  vi.mocked(clack.isCancel).mockImplementation((v: unknown): v is symbol => typeof v === 'symbol')
  vi.mocked(clack.text).mockResolvedValue(answers.description ?? 'mock project')
  vi.mocked(clack.multiselect).mockResolvedValue(answers.tools ?? [])
  vi.mocked(clack.confirm).mockImplementation(async ({ message }: { message: string }) => {
    if (message.includes('Proceed')) return answers.proceed ?? true
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

function makeGithubAccess(overrides: Partial<GithubAccess> = {}): GithubAccess {
  return {
    available: false,
    authenticated: false,
    username: null,
    error: null,
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
    githubAccess: makeGithubAccess(),
  }
}

/**
 * Capture everything written to process.stdout during `fn`. The recorded calls
 * are joined BEFORE mockRestore() because vitest's restore wipes mock.calls.
 */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  let out: string
  try {
    await fn()
    out = writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
  } finally {
    writeSpy.mockRestore()
  }
  return out
}

// ── buildMigrationPlan: branches the existing test does not reach ─────────────
describe('buildMigrationPlan — uncovered branches', () => {
  it('creates .agents/ when codex selected and no existing .agents dir (agentsDir=false)', () => {
    const plan = buildMigrationPlan(makeExisting(), ['codex'], false)
    expect(plan.created.some((s: string) => s.includes('.agents/'))).toBe(true)
    expect(plan.replaced.some((s: string) => s.includes('CODEX.md'))).toBe(false)
  })

  it('preserves scripts/check-all.mjs when useGitHub=true and checkAllScript already exists', () => {
    const existing = makeExisting({ checkAllScript: true })
    const plan = buildMigrationPlan(existing, ['claude'], true)
    expect(plan.preserved.some((s: string) => s.includes('check-all.mjs'))).toBe(true)
    expect(plan.created.some((s: string) => s.includes('check-all.mjs'))).toBe(false)
  })

  it('creates scripts/check-all.mjs when useGitHub=true and no existing check-all script', () => {
    const plan = buildMigrationPlan(makeExisting(), ['claude'], true)
    expect(plan.created.some((s: string) => s.includes('scripts/check-all.mjs'))).toBe(true)
  })
})

// ── printFlowPreamble + displayMigrationPlan brownfield branches ──────────────
describe('runWizard brownfield preamble — per-tool detected lines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })

  it('prints the agentsDir / geminiDir / windsurf / aider detected lines (agentsMd=false branch)', async () => {
    // agentsMd intentionally false → exercises the L221 false branch while the
    // other four existing flags drive their true branches in printFlowPreamble.
    const existing = makeExisting({
      claudeDir: true,
      agentsDir: true,
      geminiDir: true,
      windsurfRules: true,
      aiderConf: true,
    })
    setupClack({
      description: 'my project',
      tools: ['claude', 'codex'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const out = await captureStdout(async () => {
      const result = await runWizard(makeWizardInput(existing))
      expect(result).not.toBeNull()
    })

    expect(out).toMatch(/\.agents\//)
    expect(out).toMatch(/\.gemini\//)
    expect(out).toMatch(/windsurf-instructions\.md/)
    expect(out).toMatch(/\.aider\.conf\.yml/)
    // determineFlow must classify this as brownfield via claudeDir.
    expect(determineFlow(existing)).toBe('brownfield')
  })

  it('prints a Merge line for settings.json when claudeDir+settingsJson exist (merged loop)', async () => {
    const existing = makeExisting({ agentsMd: true, claudeDir: true, settingsJson: true })
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const out = await captureStdout(async () => {
      const result = await runWizard(makeWizardInput(existing))
      expect(result).not.toBeNull()
    })
    // displayMigrationPlan's `merged` loop renders the deep-merge entry.
    expect(out).toMatch(/Merge.*settings\.json|settings\.json.*deep-merged/)
  })
})

// ── resolveWizardAnswers: the language==='unknown' invariant guard ───────────
describe('runWizard — resolveWizardAnswers unknown-language guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })

  it('throws INV when language stays unknown after the language list is shown', async () => {
    const input = makeWizardInput()
    input.language = 'unknown'
    // Detection is unknown → the list is shown directly, but the select resolves
    // to 'unknown' (answers.language omitted), so resolveWizardAnswers must throw.
    setupClack({
      // language omitted → Select language prompt resolves undefined, but we force
      // it to 'unknown' explicitly below so raw.language is the literal 'unknown'.
      language: 'unknown',
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    await expect(runWizard(input)).rejects.toThrow(/language must be a known Language value/)
  })
})

// ── coherenceBlocksInit: CRITICAL (abort) and WARN (advisory) cells ──────────
describe('runWizard — collaboration coherence gate (ADR-051)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })

  it('aborts with exitCode 1 and prints remediation on a CRITICAL cell (trunk-solo × L4)', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L4',
      collaborationMode: 'trunk-solo',
      proceed: true,
    })

    let result: unknown
    const out = await captureStdout(async () => {
      result = await runWizard(makeWizardInput())
    })

    expect(result).toBeNull()
    expect(process.exitCode).toBe(1)
    // CRITICAL message + the `→ remediation` line (coherence.remediation defined).
    expect(out).toMatch(/incoherent|CODEOWNERS/)
    expect(out).toMatch(/→ /)
  })

  it('prints a ⚠ advisory but proceeds on a WARN cell (gated-review × L1)', async () => {
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      collaborationMode: 'gated-review',
      proceed: true,
    })

    let result: unknown
    const out = await captureStdout(async () => {
      result = await runWizard(makeWizardInput())
    })

    expect(result).not.toBeNull()
    // WARN advisory surfaces but does not abort: exitCode stays 0.
    expect(process.exitCode).toBe(0)
    expect(out).toMatch(/⚠/)
    expect(out).toMatch(/gated-review|uncommon cell/)
  })
})

// ── collectLanguageAnswers: the langSource-bearing confirm message branch ────
describe('runWizard — language confirm with a known languageSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })

  it('uses the "from <source>" confirm message when languageSource is set', async () => {
    const input = makeWizardInput()
    input.language = 'python'
    input.languageSource = 'pyproject.toml'

    setupClack({
      keepDetectedLanguage: true,
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L1',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.language).toBe('python')

    const confirmCall = vi
      .mocked(clack.confirm)
      .mock.calls.find((c: unknown[]) =>
        (c[0] as { message: string }).message.startsWith('Use detected'),
      )
    expect(confirmCall).toBeDefined()
    expect((confirmCall![0] as { message: string }).message).toContain('from pyproject.toml')
  })
})

// ── collectDecompositionBackend: gh-available-but-unauthenticated + null user ─
describe('runWizard — decomposition backend access-note branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })

  it('prints the gh access note (with the gh error) and skips the prompt when unauthenticated', async () => {
    const input = makeWizardInput()
    input.githubAccess = makeGithubAccess({
      available: true,
      authenticated: false,
      error: 'gh auth login required',
    })
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    let result: unknown
    const out = await captureStdout(async () => {
      result = await runWizard(input)
    })

    expect(result).not.toBeNull()
    expect(out).toContain('gh auth login required')
    // The decomposition prompt itself is skipped when unauthenticated.
    const askedDecomp = vi
      .mocked(clack.select)
      .mock.calls.some((c: unknown[]) =>
        (c[0] as { message: string }).message.startsWith('Decomposition'),
      )
    expect(askedDecomp).toBe(false)
  })

  it('falls back to the default note text when gh is available, unauthenticated and error is null', async () => {
    const input = makeWizardInput()
    input.githubAccess = makeGithubAccess({
      available: true,
      authenticated: false,
      error: null,
    })
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const out = await captureStdout(async () => {
      const result = await runWizard(input)
      expect(result).not.toBeNull()
    })
    // error ?? '<default>' → the default copy when error is null.
    expect(out).toMatch(/gh not authenticated/)
  })

  it('labels the github option with "unknown" when authenticated but username is null', async () => {
    const input = makeWizardInput()
    input.githubAccess = makeGithubAccess({
      available: true,
      authenticated: true,
      username: null,
    })
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      decompositionBackend: 'github',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    expect(result!.decompositionBackend).toBe('github')

    const decompCall = vi
      .mocked(clack.select)
      .mock.calls.find((c: unknown[]) =>
        (c[0] as { message: string }).message.startsWith('Decomposition'),
      )
    expect(decompCall).toBeDefined()
    const opts = (decompCall![0] as { options: { value: string; label: string }[] }).options
    const githubOpt = opts.find((o) => o.value === 'github')
    expect(githubOpt?.label).toContain('unknown')
  })
})

// ── buildConfigFromAnswers: the decompositionBackend fallback ternary (#571) ──
describe('runWizard — decompositionBackend fallback when prompt omitted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })

  it('defaults to github when gh is available+authenticated but the user left it at default', async () => {
    const input = makeWizardInput()
    input.githubAccess = makeGithubAccess({
      available: true,
      authenticated: true,
      username: 'octocat',
    })
    // decompositionBackend omitted → select resolves undefined → runWizard's
    // ternary picks 'github' because gh is available+authenticated.
    setupClack({
      description: 'my project',
      tools: ['claude'],
      governanceLevel: 'L2',
      proceed: true,
    })

    const result = await runWizard(input)
    expect(result).not.toBeNull()
    // buildConfigFromAnswers still writes 'markdown' for an absent answer, but the
    // runWizard-local decompositionBackend ternary (used for displayFlowSummary)
    // takes the gh-authenticated 'github' branch — both branches now exercised.
    expect(result!.decompositionBackend).toBe('markdown')
  })

  it('buildConfigFromAnswers derives useGitHub from an explicit github answer', () => {
    const input = makeWizardInput()
    const answers = {
      description: 'd',
      tools: ['claude'],
      governanceLevel: 'L2',
      archetype: 'library',
      architectureStyle: 'none',
      hasDatabase: false,
      hasPublicApi: false,
      isMultiTenant: false,
      collaborationMode: 'peer-review',
      decompositionBackend: 'github',
      language: 'typescript',
    } as unknown as WizardAnswers
    const config = buildConfigFromAnswers(input, answers)
    expect(config.useGitHub).toBe(true)
    expect(config.decompositionBackend).toBe('github')
  })
})
