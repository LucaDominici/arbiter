// SPDX-License-Identifier: Apache-2.0
import inquirer from 'inquirer'
import { t } from '../i18n/index.js'
import type {
  ProjectConfig,
  AiTool,
  Archetype,
  DeployTarget,
  WizardFlow,
  MigrationPlan,
  WizardAnswers,
  Language,
  Lane,
} from './types.js'
import type { BuildCommands } from '../detectors/build.js'
import type { GitInfo } from '../detectors/git.js'
import type { ExistingState } from '../detectors/existing.js'
import type { GithubAccess } from '../detectors/github.js'
import { cleanupInFlightTmpFiles } from '../utils/fs.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import { detectArchetypeHint } from '../detectors/framework.js'
import { ARCHETYPE_DB_SET } from '../detectors/axis.js'
import { defaultContractType, shouldAskContractType } from './archetype-defaults.js'
import { DEFAULT_THRESHOLDS } from '../config/schema.js'
import { detectBrownfieldClass } from '../kit/brownfield-detect.js'
import { collaborationModeFromAnswers } from '../config/collaboration-mode-defaults.js'
import { validateCollaborationCoherence } from '../commands/wizard/coherence.js'

export interface WizardInput {
  targetDir: string
  projectName: string
  language: Language
  framework: string | null
  buildCmds: BuildCommands
  gitInfo: GitInfo
  existing: ExistingState
  githubAccess: GithubAccess
  detectedLanes?: Lane[]
  /** When true, --language was passed on CLI; skip all language prompts and use wizardInput.language. */
  languageLocked?: boolean
  /** Marker file that triggered detection (e.g. 'package.json'). Null means no markers found. */
  languageSource?: string | null
}

export function determineFlow(existing: ExistingState): WizardFlow {
  if (
    existing.agentsMd ||
    existing.claudeDir ||
    existing.agentsDir ||
    existing.geminiDir ||
    existing.windsurfRules ||
    existing.aiderConf
  ) {
    return 'brownfield'
  }
  return 'greenfield'
}

interface SimpleToolEntry {
  tool: AiTool
  filePath: string
  existsAlready: boolean
}

function addSimpleToolFiles(
  tools: AiTool[],
  aiRulez: boolean,
  entries: SimpleToolEntry[],
  replaced: string[],
  created: string[],
): void {
  for (const { tool, filePath, existsAlready } of entries) {
    if (!tools.includes(tool) || aiRulez) continue
    if (existsAlready) {
      replaced.push(filePath)
    } else {
      created.push(filePath)
    }
  }
}

export function buildMigrationPlan(
  existing: ExistingState,
  tools: AiTool[],
  useGitHub: boolean,
): MigrationPlan {
  const replaced: string[] = []
  const preserved: string[] = []
  const merged: string[] = []
  const created: string[] = []

  if (existing.agentsMd) {
    replaced.push('AGENTS.md')
  } else {
    created.push('AGENTS.md')
  }

  if (tools.includes('claude') && !existing.aiRulez) {
    if (existing.claudeDir) {
      replaced.push('.claude/CLAUDE.md')
      if (existing.settingsJson) {
        merged.push('.claude/settings.json (deep-merged)')
      } else {
        created.push('.claude/settings.json')
      }
      preserved.push('.claude/hooks/ (existing hooks preserved)')
      preserved.push('.claude/rules/ (existing rules preserved)')
      preserved.push('.claude/commands/ (existing commands preserved)')
    } else {
      created.push('.claude/ (CLAUDE.md, settings.json, hooks, rules, commands)')
    }
  }

  if (tools.includes('codex') && !existing.aiRulez) {
    if (existing.agentsDir) {
      replaced.push('.agents/CODEX.md')
      preserved.push('.agents/rules/ (existing rules preserved)')
    } else {
      created.push('.agents/ (CODEX.md, rules, plan)')
    }
  }

  addSimpleToolFiles(
    tools,
    existing.aiRulez,
    [
      { tool: 'cursor', filePath: '.cursorrules', existsAlready: false },
      {
        tool: 'copilot',
        filePath: '.github/copilot-instructions.md',
        existsAlready: false,
      },
      {
        tool: 'gemini',
        filePath: '.gemini/GEMINI.md',
        existsAlready: existing.geminiDir,
      },
      {
        tool: 'windsurf',
        filePath: 'windsurf-instructions.md',
        existsAlready: existing.windsurfRules,
      },
      {
        tool: 'aider',
        filePath: '.aider.conf.yml',
        existsAlready: existing.aiderConf,
      },
    ],
    replaced,
    created,
  )

  if (useGitHub) {
    created.push('GitHub workflows + templates (01-pr-fast.yml, PR template, issue templates)')
    if (!existing.checkAllScript) {
      created.push('scripts/check-all.mjs')
    } else {
      preserved.push('scripts/check-all.mjs (preserved)')
    }
  }

  return { replaced, preserved, merged, created }
}

function displayMigrationPlan(plan: MigrationPlan): void {
  process.stdout.write(`${t('cli.wizard.migration_plan')}\n`)
  for (const entry of plan.replaced) {
    process.stdout.write(`${t('cli.wizard.replace_entry', { entry })}\n`)
  }
  for (const entry of plan.merged) {
    process.stdout.write(`${t('cli.wizard.merge_entry', { entry })}\n`)
  }
  for (const entry of plan.preserved) {
    process.stdout.write(`${t('cli.wizard.preserve_entry', { entry })}\n`)
  }
  for (const entry of plan.created) {
    process.stdout.write(`${t('cli.wizard.create_entry', { entry })}\n`)
  }
}

function isUserCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'ExitPromptError' ||
      err.message.includes('User force closed') ||
      err.message === 'Prompt was cancelled')
  )
}

async function promptConfirm(message: string): Promise<boolean> {
  const { confirm } = (await inquirer.prompt([
    { type: 'confirm', name: 'confirm', message, default: true },
  ] as Parameters<typeof inquirer.prompt>[0])) as { confirm: boolean }
  return confirm
}

function printFlowPreamble(wizardInput: WizardInput, flow: WizardFlow): void {
  if (flow !== 'brownfield') return
  process.stdout.write(`${t('cli.wizard.existing_governance')}\n`)
  if (wizardInput.existing.agentsMd) {
    process.stdout.write(`${t('cli.wizard.existing_agents_md')}\n`)
  }
  if (wizardInput.existing.claudeDir) {
    process.stdout.write(`${t('cli.wizard.existing_claude_dir')}\n`)
  }
  if (wizardInput.existing.agentsDir) {
    process.stdout.write(`${t('cli.wizard.existing_agents_dir')}\n`)
  }
  if (wizardInput.existing.geminiDir) {
    process.stdout.write(`${t('cli.wizard.existing_gemini_dir')}\n`)
  }
  if (wizardInput.existing.windsurfRules) {
    process.stdout.write(`${t('cli.wizard.existing_windsurf')}\n`)
  }
  if (wizardInput.existing.aiderConf) {
    process.stdout.write(`${t('cli.wizard.existing_aider')}\n`)
  }
  process.stdout.write('\n')
}

function resolveWizardAnswers(
  rawAnswers: Omit<WizardAnswers, 'language'> & {
    language?: Language
    keepDetectedLanguage?: boolean
  },
  wizardInput: WizardInput,
): WizardAnswers {
  const language = rawAnswers.language ?? wizardInput.language
  if (language === 'unknown') {
    throw new Error('INV: language must be a known Language value before buildConfigFromAnswers')
  }
  return { ...rawAnswers, language }
}

/**
 * ADR-051 (#1093): apply the (collaborationMode × governanceLevel) coherence gate.
 * Prints a remediation message and returns true when the cell is CRITICAL (init
 * must abort); prints an advisory for WARN; returns false to proceed.
 */
function coherenceBlocksInit(answers: WizardAnswers): boolean {
  const coherence = validateCollaborationCoherence(
    collaborationModeFromAnswers(answers),
    answers.governanceLevel,
  )
  if (coherence.severity === 'CRITICAL') {
    process.stdout.write(`\n${coherence.message}\n`)
    if (coherence.remediation !== undefined) process.stdout.write(`→ ${coherence.remediation}\n`)
    return true
  }
  if (coherence.severity === 'WARN') {
    process.stdout.write(`\n⚠ ${coherence.message}\n`)
  }
  return false
}

/** Print the brownfield migration plan, or the greenfield tools header. */
function displayFlowSummary(
  flow: WizardFlow,
  wizardInput: WizardInput,
  tools: AiTool[],
  useGitHub: boolean,
): void {
  if (flow === 'brownfield') {
    displayMigrationPlan(buildMigrationPlan(wizardInput.existing, tools, useGitHub))
  } else {
    process.stdout.write(`${t('cli.wizard.tools_header', { tools: tools.join(', ') })}\n`)
  }
}

export async function runWizard(wizardInput: WizardInput): Promise<ProjectConfig | null> {
  process.stdout.write('\n')

  const flow = determineFlow(wizardInput.existing)
  printFlowPreamble(wizardInput, flow)

  try {
    const rawAnswers = (await inquirer.prompt(
      buildMainQuestions(wizardInput) as Parameters<typeof inquirer.prompt>[0],
    )) as Omit<WizardAnswers, 'language'> & { language?: Language; keepDetectedLanguage?: boolean }

    const answers: WizardAnswers = resolveWizardAnswers(rawAnswers, wizardInput)

    const tools = answers.tools.length > 0 ? answers.tools : (['claude', 'codex'] as AiTool[])
    const decompositionBackend: 'github' | 'markdown' =
      answers.decompositionBackend ??
      (wizardInput.githubAccess.available && wizardInput.githubAccess.authenticated
        ? 'github'
        : 'markdown')

    const config = buildConfigFromAnswers(wizardInput, answers)

    // ADR-051 (#1093): reject CRITICAL (collaborationMode × governanceLevel) cells
    // before writing the project; WARN cells print an advisory and proceed.
    if (coherenceBlocksInit(answers)) {
      process.exitCode = 1
      return null
    }

    displayFlowSummary(flow, wizardInput, tools, decompositionBackend === 'github')

    const confirmMsg = flow === 'brownfield' ? 'Proceed with migration?' : 'Proceed?'
    if (!(await promptConfirm(confirmMsg))) {
      process.stdout.write(`${t('cli.wizard.cancelled')}\n`)
      return null
    }

    return config
  } catch (err) {
    if (isUserCancellation(err)) {
      cleanupInFlightTmpFiles()
      // TODO(#614): release L4 file lock here once lock infra lands
      process.stdout.write(`${t('cli.wizard.aborted')}\n`)
      process.exitCode = 130
      return null
    }
    throw err
  }
}

const DEPLOY_ARCHETYPES: Archetype[] = ['backend-web-db']

function deriveDeployTarget(answers: WizardAnswers): DeployTarget {
  if (!DEPLOY_ARCHETYPES.includes(answers.archetype)) return 'none'
  return answers.deployTarget ?? 'ghcr'
}

export function buildConfigFromAnswers(input: WizardInput, answers: WizardAnswers): ProjectConfig {
  const tools = answers.tools.length > 0 ? answers.tools : (['claude', 'codex'] as AiTool[])
  const deployTarget = deriveDeployTarget(answers)
  return {
    targetDir: input.targetDir,
    projectName: input.projectName,
    description: answers.description,
    language: answers.language,
    framework: input.framework,
    archetype: answers.archetype,
    architectureStyle: answers.architectureStyle,
    isMultiTenant: answers.isMultiTenant,
    hasDatabase: answers.hasDatabase,
    hasPublicApi: answers.hasPublicApi,
    buildTool: input.buildCmds.buildTool,
    buildCommand: input.buildCmds.buildCommand,
    testCommand: input.buildCmds.testCommand,
    lintCommand: input.buildCmds.lintCommand,
    formatCommand: input.buildCmds.formatCommand,
    tools,
    governanceLevel: answers.governanceLevel,
    decompositionBackend: answers.decompositionBackend ?? 'markdown',
    useGitHub: answers.decompositionBackend === 'github',
    githubOwner: input.gitInfo.githubOwner,
    githubRepo: input.gitInfo.githubRepo,
    existing: input.existing,
    languageHooks: getLanguageHooks(answers.language),
    enableDebtGates: answers.governanceLevel !== 'L1',
    enableSuppressions: true,
    enableSecurityScanning: answers.governanceLevel !== 'L1',
    enableMutationTesting: answers.governanceLevel === 'L3' || answers.governanceLevel === 'L4',
    enableContractTesting:
      (answers.contractType ?? defaultContractType(answers.archetype, answers.hasPublicApi)) !==
      'none',
    enableEvidenceHarness: answers.governanceLevel === 'L4',
    enableSelfValidationHarness: true,
    // ADR-051 (#1119): collaborationMode is now the primary axis from the wizard.
    // Keep writing enableSoloDevMode as a back-compat alias for legacy readers.
    collaborationMode: answers.collaborationMode ?? 'peer-review',
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    enableSoloDevMode: answers.collaborationMode === 'trunk-solo' || (answers.soloDevMode ?? false),
    thresholds: DEFAULT_THRESHOLDS[answers.governanceLevel],
    invariantTiers: presetToTiers(
      answers.invariantPreset ?? defaultPresetForLevel(answers.governanceLevel),
    ),
    contractType:
      answers.contractType ?? defaultContractType(answers.archetype, answers.hasPublicApi),
    lanes: input.detectedLanes ?? [],
    deployTarget,
    enableDeployWorkflows: deployTarget !== 'none',
    enableAzureContainerApp: deployTarget === 'azure-container-app',
    pipelineStyle: answers.pipelineStyle ?? 'standard',
    brownfieldClass: answers.brownfieldClass ?? 'gold',
    kitEnabled: true,
  }
}

function buildGovernanceQuestions(): object[] {
  return [
    {
      type: 'list',
      name: 'governanceLevel',
      message: [
        'Governance level:',
        '',
        '  Level  | Activates',
        '  -------|----------------------------------------------------------',
        '  L1     | lint + format + unit tests',
        '  L2     | + coverage + integration + debt gates + security scan',
        '  L3     | + E2E + mutation testing',
        '  L4     | + evidence harness + STRIDE risk + TRACK_ROUTER + SLSA',
        '',
      ].join('\n'),
      choices: [
        {
          name: 'L1 — Lightweight (lint + format + unit tests)',
          value: 'L1',
        },
        {
          name: 'L2 — Standard (+ coverage + integration + debt + security)  [recommended]',
          value: 'L2',
        },
        {
          name: 'L3 — Strict (+ E2E + mutation testing)',
          value: 'L3',
        },
        {
          name: 'L4 — Audit/Compliance (+ evidence harness + STRIDE risk + SLSA)',
          value: 'L4',
        },
      ],
      default: 'L2',
    },
    {
      type: 'list',
      name: 'invariantPreset',
      message: [
        'Invariant coverage — which categories of rules to enforce:',
        '',
        '  Essential  — arch (no circular deps, hexagonal boundaries) + governance (no any, no orphan TODOs)',
        '  Standard   — + data integrity (input validation, null guards) + operational (logging, error handling)',
        '  Full       — + security tier (secrets, auth, injection guards)',
        '',
      ].join('\n'),
      choices: [
        {
          name: 'Essential — architectural + governance rules only (~14 rules)',
          value: 'essential',
        },
        {
          name: 'Standard  — + data integrity + operational rules (~23 rules)  [recommended]',
          value: 'standard',
        },
        {
          name: 'Full      — all 28 rules including security tier',
          value: 'full',
        },
      ],
      default: (answers: { governanceLevel: string }): string =>
        defaultPresetForLevel(answers.governanceLevel as import('./types.js').GovernanceLevel),
    },
  ]
}

function buildArchitectureStyleQuestion(): object {
  return {
    type: 'list',
    name: 'architectureStyle',
    message: [
      'Internal architecture style — generates package-level enforcement rules (ArchUnit / import checks):',
      '',
      '  none            — no architecture rules, use when starting or unsure',
      '  hexagonal       — ports & adapters: domain/ has no deps on infra/; strict layer separation',
      '  layered         — web → service → repository: unidirectional package dependencies enforced',
      '  modular-monolith — bounded-context isolation: modules cannot directly import each other',
      '',
    ].join('\n'),
    choices: [
      {
        name: 'none            — No architecture rules generated  [default]',
        value: 'none',
      },
      {
        name: 'hexagonal       — Ports & adapters (Clean Architecture)',
        value: 'hexagonal',
      },
      {
        name: 'layered         — Package-direction layers',
        value: 'layered',
      },
      {
        name: 'modular-monolith — Bounded-context module isolation',
        value: 'modular-monolith',
      },
    ],
    default: 'none',
  }
}

function buildArchetypeQuestions(archetypeDefault: Archetype): object[] {
  return [
    {
      type: 'list',
      name: 'archetype',
      message: [
        'Project archetype — determines scaffold templates and enforcement gates:',
        '',
        '  backend-web-db  — generates REST middleware, DB migrations, Pact/OpenAPI contract tests',
        '  cli             — generates arg parsing, exit-code enforcement, no HTTP scaffolding',
        '  library         — generates public-API surface tracking, no runtime scaffolding',
        '  data-pipeline   — generates data quality checks, idempotency guards',
        '  frontend-spa    — generates bundle-size tracking, a11y stubs',
        '  embedded        — minimal scaffold, no network/DB',
        '',
      ].join('\n'),
      choices: [
        {
          name: 'backend-web-db  — HTTP service with database',
          value: 'backend-web-db',
        },
        { name: 'cli             — Command-line tool', value: 'cli' },
        {
          name: 'library         — Reusable library / package',
          value: 'library',
        },
        {
          name: 'data-pipeline   — ETL / batch processing',
          value: 'data-pipeline',
        },
        {
          name: 'frontend-spa    — Browser / desktop UI',
          value: 'frontend-spa',
        },
        {
          name: 'embedded        — Firmware / bare-metal',
          value: 'embedded',
        },
      ],
      default: archetypeDefault,
    },
    buildArchitectureStyleQuestion(),
    {
      type: 'list',
      name: 'hasDatabase',
      message: 'Does the project connect to a database?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
      default: (answers: { archetype: Archetype }): boolean =>
        ARCHETYPE_DB_SET.has(answers.archetype),
    },
    {
      type: 'list',
      name: 'hasPublicApi',
      message: 'Does the project expose a public API?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
      default: (answers: { archetype: Archetype }): boolean =>
        DEPLOY_ARCHETYPES.includes(answers.archetype),
    },
    {
      type: 'list',
      name: 'isMultiTenant',
      message: 'Is the project multi-tenant?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No', value: false },
      ],
      default: false,
    },
    buildContractTypeQuestion(),
  ]
}

function buildContractTypeQuestion(): object {
  return {
    type: 'list',
    name: 'contractType',
    message: 'Contract testing style:',
    // shouldAskContractType is a named export so it can be unit-tested directly.
    // The inquirer `when` function is NOT exercised by the mocked runWizard tests.
    when: (answers: { hasPublicApi?: boolean }) => shouldAskContractType(answers),
    choices: [
      {
        name: 'rest-owned     — Pact (consumer + provider you own)',
        value: 'rest-owned',
      },
      {
        name: 'rest-public    — OpenAPI diff (breaking-change detector)',
        value: 'rest-public',
      },
      {
        name: 'graphql        — Schema diff (graphql-inspector)',
        value: 'graphql',
      },
      { name: 'grpc           — buf breaking', value: 'grpc' },
      {
        name: 'message-queue  — Schema registry (Avro/Protobuf)',
        value: 'message-queue',
      },
      { name: 'none           — No contract testing', value: 'none' },
    ],
    default: (answers: { archetype?: Archetype; hasPublicApi?: boolean }) =>
      defaultContractType(answers.archetype, answers.hasPublicApi ?? false),
  }
}

function buildPipelineStyleQuestion(): object {
  return {
    type: 'list',
    name: 'pipelineStyle',
    message: [
      'Pipeline style — controls which GitHub Actions workflows are emitted:',
      '',
      '  starter    — 3 workflows: pr-fast, main-build, heartbeat',
      '  standard   — 8 workflows: starter + pr-extended, nightly, release, dependabot-auto, sbom, gitleaks',
      '  industrial — 18 workflows: standard + perf, chaos, mutation-nightly, archunit-extended,',
      '               cosign, attestation, rebuild, trivy-scheduled, license-scan, policy-eval',
      '',
    ].join('\n'),
    choices: [
      {
        name: 'starter    — minimal solo/small team CI (3 workflows)',
        value: 'starter',
      },
      {
        name: 'standard   — recommended team CI (8 workflows)  [recommended]',
        value: 'standard',
      },
      {
        name: 'industrial — enterprise-grade CI (18 workflows)',
        value: 'industrial',
      },
    ],
    default: 'standard',
  }
}

function buildBrownfieldClassQuestion(
  detected: 'gold' | 'light' | 'medium' | 'heavy',
  fileCount: number,
): object {
  return {
    type: 'list',
    name: 'brownfieldClass',
    message: [
      `Brownfield class (auto-detected: ${detected}, ${fileCount} source files):`,
      '  Determines which threshold column applies to existing code.',
      '  New code always uses gold-grade thresholds regardless of class.',
      '',
      '  gold   — greenfield / mature repo  (< 50 source files)',
      '  light  — light brownfield          (50–500 files, coverage > 30 %)',
      '  medium — medium brownfield         (500–2 000 files, coverage 5–30 %)',
      '  heavy  — heavy brownfield          (2 000+ files, coverage < 5 %)',
      '',
    ].join('\n'),
    choices: [
      { name: 'gold   — greenfield / already mature', value: 'gold' },
      { name: 'light  — light brownfield', value: 'light' },
      { name: 'medium — medium brownfield', value: 'medium' },
      { name: 'heavy  — heavy brownfield', value: 'heavy' },
    ],
    default: detected,
  }
}

function buildLanguageChoices(): { name: string; value: string }[] {
  return [
    { name: 'TypeScript / JavaScript', value: 'typescript' },
    { name: 'Java', value: 'java' },
    { name: 'Kotlin', value: 'kotlin' },
    { name: 'Rust', value: 'rust' },
    { name: 'Python', value: 'python' },
    { name: 'Go', value: 'go' },
    { name: 'Multi-language (polyglot repo)', value: 'multi' },
  ]
}

function buildLanguageQuestions(wizardInput: WizardInput): object[] {
  const isLocked = wizardInput.languageLocked ?? false
  const detectedLang = wizardInput.language
  const source = wizardInput.languageSource ?? null

  if (isLocked) return []

  if (detectedLang === 'unknown') {
    return [
      {
        type: 'list',
        name: 'language',
        message: 'Select language:',
        choices: buildLanguageChoices(),
        default: 'typescript',
      },
    ]
  }

  const confirmMessage = source
    ? `Use detected language '${detectedLang}' (from ${source})?`
    : `Use detected language '${detectedLang}'?`

  return [
    {
      type: 'confirm',
      name: 'keepDetectedLanguage',
      message: confirmMessage,
      default: true,
    },
    {
      type: 'list',
      name: 'language',
      message: 'Select language:',
      choices: buildLanguageChoices(),
      default: 'typescript',
      when: (answers: Record<string, unknown>) => answers['keepDetectedLanguage'] === false,
    },
  ]
}

function buildMainQuestions(wizardInput: WizardInput): object[] {
  const githubChoice = buildGithubChoice(wizardInput.githubAccess)
  const archetypeDefault: Archetype =
    detectArchetypeHint(wizardInput.targetDir, wizardInput.language, wizardInput.framework) ??
    'library'
  const brownfieldDetect = detectBrownfieldClass(wizardInput.targetDir, wizardInput.language)
  return [
    ...buildLanguageQuestions(wizardInput),
    {
      type: 'input',
      name: 'description',
      message: 'Project description:',
      default: `${wizardInput.projectName} project`,
    },
    {
      type: 'checkbox',
      name: 'tools',
      message: 'Which AI tools will you use?',
      choices: [
        { name: 'Claude Code (Anthropic)', value: 'claude', checked: true },
        { name: 'Codex (OpenAI)', value: 'codex', checked: true },
        { name: 'Cursor', value: 'cursor', checked: false },
        { name: 'Copilot', value: 'copilot', checked: false },
        { name: 'Gemini CLI (Google)', value: 'gemini', checked: false },
        { name: 'Windsurf (Codeium)', value: 'windsurf', checked: false },
        { name: 'Aider (terminal pair)', value: 'aider', checked: false },
      ],
    },
    ...buildGovernanceQuestions(),
    ...buildArchetypeQuestions(archetypeDefault),
    ...githubChoice,
    {
      // ADR-051 (#1119): 3-way collaborationMode replaces deprecated soloDevMode boolean.
      type: 'list',
      name: 'collaborationMode',
      message: [
        'Collaboration mode — controls branching, CI shape, and merge ceremony:',
        '',
        '  trunk-solo    — push to trunk directly; minimal CI; no PR required',
        '  peer-review   — feature branches + PR + fast-forward merge (recommended)',
        '  gated-review  — PR + required approvals + full CI (enterprise / regulated)',
        '',
      ].join('\n'),
      choices: [
        {
          name: 'trunk-solo    — solo dev, commit directly to main',
          value: 'trunk-solo',
        },
        {
          name: 'peer-review   — small team, PR-based workflow  [recommended]',
          value: 'peer-review',
        },
        {
          name: 'gated-review  — regulated / enterprise, required approvals',
          value: 'gated-review',
        },
      ],
      default: 'peer-review',
    },
    buildPipelineStyleQuestion(),
    buildBrownfieldClassQuestion(
      brownfieldDetect.brownfieldClass,
      brownfieldDetect.sourceFileCount,
    ),
  ]
}

function buildGithubChoice(access: GithubAccess): object[] {
  if (!access.available) {
    return []
  }
  if (!access.authenticated) {
    process.stdout.write(
      `${t('cli.wizard.gh_access_note', {
        message: access.error ?? 'gh not authenticated — GitHub assets skipped',
      })}\n`,
    )
    return []
  }
  return [
    {
      type: 'list',
      name: 'decompositionBackend',
      message: 'Decomposition backend (where tasks/work units are stored):',
      choices: [
        {
          name: `github — gh authenticated as ${access.username ?? 'unknown'}`,
          value: 'github',
        },
        {
          name: 'markdown — local .arbiter/work/*.md files (no gh required)',
          value: 'markdown',
        },
      ],
      default: 'github',
    },
  ]
}
