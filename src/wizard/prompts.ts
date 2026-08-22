// SPDX-License-Identifier: Apache-2.0
import { select, multiselect, confirm, text, isCancel } from '@clack/prompts'
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
  GovernanceLevel,
  InvariantPreset,
  ArchitectureStyle,
  AutonomyLevel,
  ContractType,
  CollaborationMode,
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
import { levelAtLeast } from '../config/levels.js'
import { detectBrownfieldClass } from '../kit/brownfield-detect.js'
import {
  collaborationModeFromAnswers,
  resolveDefaultBranchingStrategy,
  resolveDefaultMaxParallelWorktrees,
  resolveDefaultAffinityBatching,
  resolveDefaultGateLevel,
} from '../config/collaboration-mode-defaults.js'
import {
  validateCollaborationCoherence,
  validateOverlayCoherence,
} from '../commands/wizard/coherence.js'

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

/**
 * Sentinel thrown internally when a @clack prompt returns a cancel symbol
 * (the user pressed Ctrl+C / Escape). runWizard catches it, performs the abort
 * cleanup, and returns null with exitCode 130. clack does not throw on cancel —
 * each prompt resolves to a cancel symbol checked via isCancel(), so we
 * centralise that check in `ask*` helpers to avoid per-prompt repetition.
 */
class WizardAborted extends Error {
  constructor() {
    super('wizard aborted')
    this.name = 'WizardAborted'
  }
}

/** Resolve a clack prompt, throwing WizardAborted when the user cancels. */
async function unwrap<T>(promise: Promise<T | symbol>): Promise<T> {
  const value = await promise
  if (isCancel(value)) throw new WizardAborted()
  return value
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

/**
 * #1254: print the resulting (team × compliance) cell — the chosen
 * collaborationMode and industryOverlay, what they produce (branching strategy,
 * gate level, overlay artefacts), and any (overlay × governanceLevel) advisory.
 * Always prints a one-line cell summary (even for coherent cells), then a WARN
 * line when the compliance weight outpaces the governance level.
 */
function displayComplianceCell(answers: WizardAnswers): void {
  const mode = collaborationModeFromAnswers(answers)
  const branching = answers.branchingStrategy ?? resolveDefaultBranchingStrategy(mode)
  const overlay = answers.industryOverlay ?? 'none'
  const overlayLabel = overlay === 'none' ? 'no compliance overlay' : `${overlay} overlay`

  process.stdout.write(
    `\nResulting cell: team=${mode} × compliance=${overlayLabel} @ ${answers.governanceLevel}\n` +
      `  branching: ${branching}  |  gates: ${answers.governanceLevel}  |  overlay: ${overlayLabel}` +
      `  |  autonomy: ${answers.autonomy ?? 'L0'}\n`,
  )

  const coherence = validateOverlayCoherence(overlay, answers.governanceLevel)
  if (coherence.severity === 'WARN') {
    process.stdout.write(`⚠ ${coherence.message}\n`)
  }
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

type RawAnswers = Omit<WizardAnswers, 'language'> & {
  language?: Language
  keepDetectedLanguage?: boolean
}

/**
 * Prompts 1a/1b — language confirmation + selection. SKIP the confirm entirely
 * when --language is locked or when detection is 'unknown'; the language list
 * is shown directly for 'unknown' and otherwise only when the user declines the
 * detected language. Mutates `raw` in place.
 */
async function collectLanguageAnswers(wizardInput: WizardInput, raw: RawAnswers): Promise<void> {
  if (wizardInput.languageLocked === true) return

  const detectedLang = wizardInput.language
  const langSource = wizardInput.languageSource ?? null
  let showLanguageList = detectedLang === 'unknown'

  if (detectedLang !== 'unknown') {
    const confirmMessage = langSource
      ? `Use detected language '${detectedLang}' (from ${langSource})?`
      : `Use detected language '${detectedLang}'?`
    const keep = await unwrap(confirm({ message: confirmMessage, initialValue: true }))
    raw.keepDetectedLanguage = keep
    showLanguageList = !keep
  }

  if (showLanguageList) {
    raw.language = await unwrap(
      select({
        message: 'Select language:',
        options: buildLanguageOptions(),
        initialValue: 'typescript',
      }),
    )
  }
}

/**
 * Prompts 8–11 — hasDatabase / hasPublicApi / isMultiTenant / contractType.
 * contractType is asked only when hasPublicApi === true (the old inquirer
 * `when:` becomes an imperative guard). Mutates `raw` in place.
 */
async function collectAxisAnswers(raw: RawAnswers): Promise<void> {
  // 8 — hasDatabase (default from archetype DB set).
  raw.hasDatabase = await unwrap(
    select({
      message: 'Does the project connect to a database?',
      options: YES_NO_OPTIONS,
      initialValue: ARCHETYPE_DB_SET.has(raw.archetype),
    }),
  )

  // 9 — hasPublicApi (default from deploy archetypes).
  raw.hasPublicApi = await unwrap(
    select({
      message: `Does the project expose a public API?\n${PUBLIC_API_COST}`,
      options: YES_NO_OPTIONS,
      initialValue: DEPLOY_ARCHETYPES.includes(raw.archetype),
    }),
  )

  // 9b — deployTarget (only for deploy archetypes). #1639: this is the only thing that
  // ever populates answers.deployTarget — without it the cloud targets were unreachable
  // through init and the deriveDeployTarget `?? 'ghcr'` left operand was dead.
  if (DEPLOY_ARCHETYPES.includes(raw.archetype)) {
    raw.deployTarget = await unwrap(
      select({
        message: 'Deploy target (CI deploy workflows):',
        options: DEPLOY_TARGET_OPTIONS,
        initialValue: 'ghcr',
      }),
    )
  }

  // 10 — multi-tenant.
  raw.isMultiTenant = await unwrap(
    select({
      message: `Is the project multi-tenant?\n${MULTI_TENANT_COST}`,
      options: YES_NO_OPTIONS,
      initialValue: false,
    }),
  )

  // 11 — contractType — only when hasPublicApi === true.
  if (shouldAskContractType({ hasPublicApi: raw.hasPublicApi })) {
    raw.contractType = await unwrap(
      select({
        message: `Contract testing style:\n${CONTRACT_TYPE_COST}`,
        options: CONTRACT_TYPE_OPTIONS,
        initialValue: defaultContractType(raw.archetype, raw.hasPublicApi),
      }),
    )
  }
}

/**
 * Prompt 12 — decomposition backend. Shown only when gh is available AND
 * authenticated. When gh is available but unauthenticated, print the access
 * note (parity with the old buildGithubChoice) and skip the prompt.
 */
async function collectDecompositionBackend(
  wizardInput: WizardInput,
  raw: RawAnswers,
): Promise<void> {
  const { available, authenticated, username, error } = wizardInput.githubAccess
  if (available && !authenticated) {
    process.stdout.write(
      `${t('cli.wizard.gh_access_note', {
        message: error ?? 'gh not authenticated — GitHub assets skipped',
      })}\n`,
    )
  }
  if (available && authenticated) {
    raw.decompositionBackend = await unwrap(
      select({
        message: 'Decomposition backend (where tasks/work units are stored):',
        options: [
          { value: 'github', label: `github — gh authenticated as ${username ?? 'unknown'}` },
          {
            value: 'markdown',
            label: 'markdown — local .arbiter/work/*.md files (no gh required)',
          },
        ],
        initialValue: 'github',
      }),
    )
  }
}

/**
 * Prompt 14.5 — #1835 (Task B, #1825): collapsed 5-lane CI doctrine, GitHub-only
 * opt-in. Asked only when the decomposition backend is GitHub (the generator
 * mutually excludes the standard github/ci-tier shape when this is on —
 * registry.ts). Skipped entirely for markdown-backend projects so the default
 * interactive flow is unaffected. Extracted to keep collectRawAnswers under the
 * max-lines-per-function ceiling.
 */
async function collectFiveLaneCiAnswer(raw: RawAnswers): Promise<void> {
  if (raw.decompositionBackend !== 'github') return
  raw.enableFiveLaneCi = await unwrap(
    confirm({
      message: FIVE_LANE_CI_MESSAGE,
      initialValue: false,
    }),
  )
}

/**
 * Collect the wizard answers via sequential @clack/prompts calls. Returns the
 * raw answer object in the same shape inquirer produced; conditional prompts
 * (`when:` in the old inquirer model) are expressed as imperative `if`s here,
 * and function `default:`s are precomputed into `initialValue`s. Throws
 * WizardAborted if the user cancels any prompt.
 */
async function collectRawAnswers(wizardInput: WizardInput): Promise<RawAnswers> {
  const raw: RawAnswers = {} as never

  // 1a/1b — language confirmation + selection.
  await collectLanguageAnswers(wizardInput, raw)

  // 2 — description.
  raw.description = await unwrap(
    text({
      message: 'Project description:',
      defaultValue: `${wizardInput.projectName} project`,
    }),
  )

  // 3 — AI tools (empty selection allowed).
  raw.tools = await unwrap(
    multiselect({
      message: 'Which AI tools will you use?',
      options: TOOL_OPTIONS,
      initialValues: ['claude', 'codex'],
      required: false,
    }),
  )

  // 4 — governance level.
  raw.governanceLevel = await unwrap(
    select({ message: GOVERNANCE_MESSAGE, options: GOVERNANCE_OPTIONS, initialValue: 'L2' }),
  )

  // 5 — invariant preset (default derived from the chosen governance level).
  raw.invariantPreset = await unwrap(
    select({
      message: INVARIANT_PRESET_MESSAGE,
      options: INVARIANT_PRESET_OPTIONS,
      initialValue: defaultPresetForLevel(raw.governanceLevel),
    }),
  )

  // 6 — archetype (default from framework hint).
  const archetypeDefault: Archetype =
    detectArchetypeHint(wizardInput.targetDir, wizardInput.language, wizardInput.framework) ??
    'library'
  raw.archetype = await unwrap(
    select({
      message: ARCHETYPE_MESSAGE,
      options: ARCHETYPE_OPTIONS,
      initialValue: archetypeDefault,
    }),
  )

  // 7 — architecture style.
  raw.architectureStyle = await unwrap(
    select({
      message: ARCHITECTURE_STYLE_MESSAGE,
      options: ARCHITECTURE_STYLE_OPTIONS,
      initialValue: 'none',
    }),
  )

  // 8–11 — DB / public-API / multi-tenant / contract-type axis questions.
  await collectAxisAnswers(raw)

  // 12 — decomposition backend (only when gh is available AND authenticated).
  await collectDecompositionBackend(wizardInput, raw)

  // 13 — collaboration mode.
  raw.collaborationMode = await unwrap(
    select({
      message: COLLABORATION_MODE_MESSAGE,
      options: COLLABORATION_MODE_OPTIONS,
      initialValue: DEFAULT_COLLABORATION_MODE,
    }),
  )

  // 14 — pipeline style.
  raw.pipelineStyle = await unwrap(
    select({
      message: PIPELINE_STYLE_MESSAGE,
      options: PIPELINE_STYLE_OPTIONS,
      initialValue: 'standard',
    }),
  )

  // 14.5 — #1835 (Task B, #1825): collapsed 5-lane CI doctrine, GitHub-only opt-in.
  await collectFiveLaneCiAnswer(raw)

  // 15 — brownfield class (default auto-detected).
  const brownfieldDetect = detectBrownfieldClass(wizardInput.targetDir, wizardInput.language)
  raw.brownfieldClass = await unwrap(
    select({
      message: buildBrownfieldClassMessage(
        brownfieldDetect.brownfieldClass,
        brownfieldDetect.sourceFileCount,
      ),
      options: BROWNFIELD_CLASS_OPTIONS,
      initialValue: brownfieldDetect.brownfieldClass,
    }),
  )

  // 16 — #1254: industry compliance overlay. Default 'none'.
  raw.industryOverlay = await unwrap(
    select({
      message: INDUSTRY_OVERLAY_MESSAGE,
      options: INDUSTRY_OVERLAY_OPTIONS,
      initialValue: 'none',
    }),
  )

  // 17 — #1261: ship autonomy level (Project Profile automation axis). Default 'L0'.
  raw.autonomy = await unwrap(
    select({
      message: AUTONOMY_MESSAGE,
      options: AUTONOMY_OPTIONS,
      initialValue: 'L0',
    }),
  )

  // 18 — #1693 (ADR-101): runner profile axis. Default 'fleet' (current behavior).
  raw.runnerProfile = await unwrap(
    select({
      message: RUNNER_PROFILE_MESSAGE,
      options: RUNNER_PROFILE_OPTIONS,
      initialValue: 'fleet',
    }),
  )

  return raw
}

export async function runWizard(wizardInput: WizardInput): Promise<ProjectConfig | null> {
  process.stdout.write('\n')

  const flow = determineFlow(wizardInput.existing)
  printFlowPreamble(wizardInput, flow)

  try {
    const rawAnswers = await collectRawAnswers(wizardInput)

    const answers: WizardAnswers = resolveWizardAnswers(rawAnswers, wizardInput)

    const tools = answers.tools.length > 0 ? answers.tools : (['claude', 'codex'] as AiTool[])
    const decompositionBackend: 'github' | 'markdown' =
      answers.decompositionBackend ??
      (wizardInput.githubAccess.available && wizardInput.githubAccess.authenticated
        ? 'github'
        : 'markdown')

    const config = buildConfigFromAnswers(wizardInput, answers)

    // #1254: surface the resulting (team × compliance) cell + overlay advisory.
    displayComplianceCell(answers)

    // ADR-051 (#1093): reject CRITICAL (collaborationMode × governanceLevel) cells
    // before writing the project; WARN cells print an advisory and proceed.
    if (coherenceBlocksInit(answers)) {
      process.exitCode = 1
      return null
    }

    displayFlowSummary(flow, wizardInput, tools, decompositionBackend === 'github')

    // 16 — final confirmation. isCancel (Ctrl+C) → abort (exitCode 130);
    // an explicit `false` → cancelled, return null with exitCode unchanged.
    const confirmMsg = flow === 'brownfield' ? 'Proceed with migration?' : 'Proceed?'
    const proceed = await unwrap(confirm({ message: confirmMsg, initialValue: true }))
    if (!proceed) {
      process.stdout.write(`${t('cli.wizard.cancelled')}\n`)
      return null
    }

    return config
  } catch (err) {
    if (err instanceof WizardAborted) {
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
const DEFAULT_COLLABORATION_MODE: CollaborationMode = 'peer-review'

function deriveDeployTarget(answers: WizardAnswers): DeployTarget {
  if (!DEPLOY_ARCHETYPES.includes(answers.archetype)) return 'none'
  return answers.deployTarget ?? 'ghcr'
}

/**
 * #1254/#1261: the Project-Profile axes persisted from wizard answers.
 * industryOverlay is only set for a real overlay ('none'/absent leaves the field
 * off so overlay generators stay disabled); automation is always explicit
 * (absent answer = safe L0) so `arbiter settings` shows a configured profile.
 * Extracted from buildConfigFromAnswers to keep it within the complexity-15 limit.
 */
function buildProfileAxes(
  answers: WizardAnswers,
): Pick<ProjectConfig, 'industryOverlay' | 'automation'> {
  // #1306 (ADR-094 §Decision.4): derive the three orchestration prefs from the
  // collaboration mode + governance level (convention over configuration — the
  // wizard does NOT ask for them). Persisted explicitly so `arbiter settings`
  // shows a fully-populated profile and `arbiter doctor` has values to check.
  const mode = collaborationModeFromAnswers(answers)
  return {
    ...(answers.industryOverlay !== undefined && answers.industryOverlay !== 'none'
      ? { industryOverlay: answers.industryOverlay }
      : {}),
    automation: {
      autonomy: answers.autonomy ?? 'L0',
      maxParallelWorktrees: resolveDefaultMaxParallelWorktrees(mode),
      defaultGateLevel: resolveDefaultGateLevel(answers.governanceLevel),
      affinityBatching: resolveDefaultAffinityBatching(mode),
    },
  }
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
    packageManager: input.buildCmds.packageManager ?? 'npm',
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
    enableMutationTesting: levelAtLeast(answers.governanceLevel, 'L3'),
    enableContractTesting:
      (answers.contractType ?? defaultContractType(answers.archetype, answers.hasPublicApi)) !==
      'none',
    enableEvidenceHarness: answers.governanceLevel === 'L4',
    enableSelfValidationHarness: true,
    // ADR-051 (#1119): collaborationMode is now the primary axis from the wizard.
    // Keep writing enableSoloDevMode as a back-compat alias for legacy readers.
    collaborationMode: answers.collaborationMode ?? DEFAULT_COLLABORATION_MODE,
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
    pipelineStyle: answers.pipelineStyle ?? 'standard',
    // #1835 (Task B, #1825): only ever asked (and thus only ever true) for a GitHub backend.
    enableFiveLaneCi: answers.enableFiveLaneCi === true,
    brownfieldClass: answers.brownfieldClass ?? 'gold',
    kitEnabled: true,
    // #1693 (ADR-101): runner profile axis. Default 'fleet' — current behavior.
    runnerProfile: answers.runnerProfile ?? 'fleet',
    // #1254/#1261: compliance-overlay + ship-autonomy Project-Profile axes.
    ...buildProfileAxes(answers),
  }
}

// ── @clack option tables + message strings (Phase 4 migration) ───────────────
// Inquirer `list`/`checkbox` choices become @clack select/multiselect options
// ({ value, label }). Multi-line inquirer `message` strings are preserved
// verbatim so the on-screen prompt text is unchanged.

type Opt<T extends string | boolean> = { value: T; label: string }

export function buildLanguageOptions(): Opt<Language>[] {
  return [
    { value: 'typescript', label: 'TypeScript / JavaScript' },
    // #1770 (T6/release maturity labels): Java is not dogfooded end-to-end at
    // the same parity as TypeScript/Python/Go. Mark it experimental so a wizard
    // user does not pick it expecting the same support level.
    { value: 'java', label: 'Java (experimental)' },
    // #1491 (M2/matrix-coverage): Kotlin has ZERO `proven` matrix cells, only a
    // snapshot-tier fixture (init never executed against it), and no L4 — it is
    // not at runtime-verified parity with the other JVM stack (Java). Mark it
    // experimental so a wizard user does not pick it expecting Java-level support.
    { value: 'kotlin', label: 'Kotlin (experimental — beta tooling, not fixture-verified)' },
    // #1770 (T6/release maturity labels): same rationale as Java above.
    { value: 'rust', label: 'Rust (experimental)' },
    { value: 'python', label: 'Python' },
    { value: 'go', label: 'Go' },
    { value: 'multi', label: 'Multi-language (polyglot repo)' },
  ]
}

// Customer-facing supported tools only (see AiTool support policy in types.ts).
// Experimental tools (cursor/copilot/gemini/windsurf/aider) are intentionally
// not offered in the wizard — their generators are retained but unadvertised.
const TOOL_OPTIONS: Opt<AiTool>[] = [
  { value: 'claude', label: 'Claude Code (Anthropic)' },
  { value: 'codex', label: 'Codex (OpenAI)' },
]

const YES_NO_OPTIONS: Opt<boolean>[] = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
]

/**
 * #1315 — per-flag cost lines. Each prefixes "what answering Yes generates" so a
 * solo operator can weigh the machinery before opting in. Kept terse (one line)
 * to stay readable inside a clack select header.
 */
const PUBLIC_API_COST =
  '  Generates: OWASP ZAP DAST scan, OpenAPI/contract test suite, API deprecation policy + breaking-change gate.'
const MULTI_TENANT_COST =
  '  Generates: risk-register entry for tenant data isolation; descriptive metadata only (does not generate isolation machinery).'
const CONTRACT_TYPE_COST =
  '  Generates: a consumer/provider contract-test suite (Pact / OpenAPI-diff / buf / schema-registry) wired into CI.'

const GOVERNANCE_MESSAGE = [
  'Governance level:',
  '',
  '  Level  | Activates',
  '  -------|----------------------------------------------------------',
  '  L1     | lint + format + unit tests',
  '  L2     | + coverage + integration + debt gates + security scan',
  '  L3     | + E2E + mutation testing',
  '  L4     | + evidence harness + STRIDE risk + TRACK_ROUTER + SLSA',
  '',
].join('\n')

const GOVERNANCE_OPTIONS: Opt<GovernanceLevel>[] = [
  { value: 'L1', label: 'L1 — Lightweight (lint + format + unit tests)' },
  {
    value: 'L2',
    label: 'L2 — Standard (+ coverage + integration + debt + security)  [recommended]',
  },
  { value: 'L3', label: 'L3 — Strict (+ E2E + mutation testing)' },
  { value: 'L4', label: 'L4 — Audit/Compliance (+ evidence harness + STRIDE risk + SLSA)' },
]

const INVARIANT_PRESET_MESSAGE = [
  'Invariant coverage — which categories of rules to enforce:',
  '',
  '  Essential  — arch (no circular deps, hexagonal boundaries) + governance (no any, no orphan TODOs)',
  '  Standard   — + data integrity (input validation, null guards) + operational (logging, error handling)',
  '  Full       — + security tier (secrets, auth, injection guards)',
  '',
].join('\n')

const INVARIANT_PRESET_OPTIONS: Opt<InvariantPreset>[] = [
  { value: 'essential', label: 'Essential — architectural + governance rules only (~14 rules)' },
  {
    value: 'standard',
    label: 'Standard  — + data integrity + operational rules (~23 rules)  [recommended]',
  },
  { value: 'full', label: 'Full      — all 28 rules including security tier' },
]

const ARCHETYPE_MESSAGE = [
  'Project archetype — determines scaffold templates and enforcement gates:',
  '',
  '  backend-web-db  — generates REST middleware, DB migrations, Pact/OpenAPI contract tests',
  '  cli             — generates arg parsing, exit-code enforcement, no HTTP scaffolding',
  '  library         — generates public-API surface tracking, no runtime scaffolding',
  '  data-pipeline   — generates data quality checks, idempotency guards',
  '  frontend-spa    — generates bundle-size tracking, a11y stubs',
  '  embedded        — minimal scaffold, no network/DB',
  '',
].join('\n')

const ARCHETYPE_OPTIONS: Opt<Archetype>[] = [
  { value: 'backend-web-db', label: 'backend-web-db  — HTTP service with database' },
  { value: 'cli', label: 'cli             — Command-line tool' },
  { value: 'library', label: 'library         — Reusable library / package' },
  { value: 'data-pipeline', label: 'data-pipeline   — ETL / batch processing' },
  { value: 'frontend-spa', label: 'frontend-spa    — Browser / desktop UI' },
  { value: 'embedded', label: 'embedded        — Firmware / bare-metal' },
]

const ARCHITECTURE_STYLE_MESSAGE = [
  'Internal architecture style — generates package-level enforcement rules (ArchUnit / import checks):',
  '',
  '  none            — no architecture rules, use when starting or unsure',
  '  hexagonal       — ports & adapters: domain/ has no deps on infra/; strict layer separation',
  '  layered         — web → service → repository: unidirectional package dependencies enforced',
  '  modular-monolith — bounded-context isolation: modules cannot directly import each other',
  '',
].join('\n')

const ARCHITECTURE_STYLE_OPTIONS: Opt<ArchitectureStyle>[] = [
  { value: 'none', label: 'none            — No architecture rules generated  [default]' },
  { value: 'hexagonal', label: 'hexagonal       — Ports & adapters (Clean Architecture)' },
  { value: 'layered', label: 'layered         — Package-direction layers' },
  {
    value: 'modular-monolith',
    label: 'modular-monolith — Bounded-context module isolation',
  },
]

// #1639: deploy-target choices. Without this prompt nothing ever set
// answers.deployTarget, so the `?? 'ghcr'` fallback's left operand was dead and the
// three cloud targets (azure/aws/gcp) were unreachable through interactive init.
const DEPLOY_TARGET_OPTIONS: Opt<DeployTarget>[] = [
  { value: 'ghcr', label: 'ghcr                — GitHub Container Registry image build (default)' },
  { value: 'azure-container-app', label: 'azure-container-app — Azure Container Apps deploy' },
  { value: 'aws-ecs', label: 'aws-ecs             — AWS ECS deploy' },
  { value: 'gcp-cloud-run', label: 'gcp-cloud-run       — Google Cloud Run deploy' },
  {
    value: 'nas-compose',
    label: 'nas-compose         — SSH + docker-compose deploy to a self-hosted NAS',
  },
  { value: 'none', label: 'none                — no deploy workflows' },
]

const CONTRACT_TYPE_OPTIONS: Opt<ContractType>[] = [
  { value: 'rest-owned', label: 'rest-owned     — Pact (consumer + provider you own)' },
  { value: 'rest-public', label: 'rest-public    — OpenAPI diff (breaking-change detector)' },
  { value: 'graphql', label: 'graphql        — Schema diff (graphql-inspector)' },
  { value: 'grpc', label: 'grpc           — buf breaking' },
  { value: 'message-queue', label: 'message-queue  — Schema registry (Avro/Protobuf)' },
  { value: 'none', label: 'none           — No contract testing' },
]

const COLLABORATION_MODE_MESSAGE = [
  'Collaboration mode — controls branching, CI shape, and merge ceremony:',
  '',
  '  trunk-solo    — push to trunk directly, no PR ceremony; requires the FULL gate',
  '                  locally (run.sh gate full ≡ CI) as your independent net — CI',
  '                  becomes a verification mirror, not extra ceremony',
  '  peer-review   — feature branches + PR + fast-forward merge (recommended)',
  '  gated-review  — PR + required approvals + full CI (enterprise / regulated)',
  '',
].join('\n')

const COLLABORATION_MODE_OPTIONS: Opt<CollaborationMode>[] = [
  {
    value: 'trunk-solo',
    label: 'trunk-solo    — solo dev, no PR; full gate locally ≡ CI (parity-gated)',
  },
  { value: 'peer-review', label: 'peer-review   — small team, PR-based workflow  [recommended]' },
  {
    value: 'gated-review',
    label: 'gated-review  — regulated / enterprise, required approvals',
  },
]

const PIPELINE_STYLE_MESSAGE = [
  'Pipeline style — controls which GitHub Actions workflows are emitted:',
  '',
  '  starter    — 3 workflows: pr-fast, main-build, heartbeat',
  '  standard   — 8 workflows: starter + pr-extended, nightly, release, dependabot-auto, sbom, gitleaks',
  '  industrial — 18 workflows: standard + perf, chaos, mutation-nightly, archunit-extended,',
  '               cosign, attestation, rebuild, trivy-scheduled, license-scan, policy-eval',
  '',
].join('\n')

const PIPELINE_STYLE_OPTIONS: Opt<'starter' | 'standard' | 'industrial'>[] = [
  { value: 'starter', label: 'starter    — minimal solo/small team CI (3 workflows)' },
  { value: 'standard', label: 'standard   — recommended team CI (8 workflows)  [recommended]' },
  { value: 'industrial', label: 'industrial — enterprise-grade CI (18 workflows)' },
]

// #1835 (Task B, #1825): opt-in collapsed 5-lane CI doctrine — replaces the
// pipeline-style workflow set above with exactly 4 workflows (ci/nightly/weekly/
// release) + local pre-commit. Advanced/opinionated shape (validated on a
// 100k-LOC reference project — see src/generators/ci-five-lane.ts) — default No
// so the standard flow is unaffected.
const FIVE_LANE_CI_MESSAGE = [
  'Use the collapsed 5-lane CI doctrine instead of the pipeline style above?',
  '(advanced — pre-commit + ci/nightly/weekly/release, replaces the standard github + ci-tier shape)',
].join('\n')

function buildBrownfieldClassMessage(
  detected: 'gold' | 'light' | 'medium' | 'heavy',
  fileCount: number,
): string {
  return [
    `Brownfield class (auto-detected: ${detected}, ${fileCount} source files):`,
    '  Determines which threshold column applies to existing code.',
    '  New code always uses gold-grade thresholds regardless of class.',
    '',
    '  gold   — greenfield / mature repo  (< 50 source files)',
    '  light  — light brownfield          (50–500 files, coverage > 30 %)',
    '  medium — medium brownfield         (500–2 000 files, coverage 5–30 %)',
    '  heavy  — heavy brownfield          (2 000+ files, coverage < 5 %)',
    '',
  ].join('\n')
}

const BROWNFIELD_CLASS_OPTIONS: Opt<'gold' | 'light' | 'medium' | 'heavy'>[] = [
  { value: 'gold', label: 'gold   — greenfield / already mature' },
  { value: 'light', label: 'light  — light brownfield' },
  { value: 'medium', label: 'medium — medium brownfield' },
  { value: 'heavy', label: 'heavy  — heavy brownfield' },
]

const INDUSTRY_OVERLAY_MESSAGE = [
  'Industry compliance overlay — emits domain-specific compliance scaffolding + gates:',
  '',
  '  none      — no overlay (default)',
  '  generic   — language-neutral audit-trail policy + gate rules (light)',
  '  sox        — SOX audit-trail docs + gate rules',
  '  gdpr      — GDPR controls→gates traceability overlay',
  '  iso9001   — quality-process overlay: requirement→test RTM + doc-control + CAPA + gate',
  '  iso27001  — ISO 27001:2022 Annex-A security controls→gate traceability (heavy)',
  '  pharma    — 21 CFR Part 11 audit-trail overlay (heavy; recommend L3+)',
  '  regulated — high-assurance bundle: separation-of-duties (human approval on AI PRs)',
  '              + audit retention + suppression-expiry + signing/SBOM + mutation (heavy)',
  '',
  '  Heavy overlays (pharma, iso27001, regulated) assume L3+ governance rigour.',
  '',
].join('\n')

type IndustryOverlayValue =
  'none' | 'generic' | 'sox' | 'gdpr' | 'iso9001' | 'iso27001' | 'pharma' | 'regulated'

const INDUSTRY_OVERLAY_OPTIONS: Opt<IndustryOverlayValue>[] = [
  { value: 'none', label: 'none      — no compliance overlay  [default]' },
  { value: 'generic', label: 'generic   — language-neutral audit-trail policy (light)' },
  { value: 'sox', label: 'sox       — SOX audit-trail docs + gate rules' },
  { value: 'gdpr', label: 'gdpr      — GDPR controls→gates traceability' },
  { value: 'iso9001', label: 'iso9001   — quality-process RTM + doc-control + CAPA' },
  { value: 'iso27001', label: 'iso27001  — ISO 27001 Annex-A controls→gates (heavy)' },
  { value: 'pharma', label: 'pharma    — 21 CFR Part 11 audit-trail (heavy, L3+)' },
  {
    value: 'regulated',
    label: 'regulated — high-assurance bundle: SoD + retention + signing + mutation (heavy, L3+)',
  },
]

// #1261: ship autonomy level (ADR-093 §4) — how much of `arbiter ship` runs
// without asking. Labels mirror the AUTONOMY_GRANTS table in ship-profile.ts.
const AUTONOMY_MESSAGE = [
  'Ship autonomy level — how much of `arbiter ship` runs without asking:',
  '',
  '  L0 — ask at each ship step (default)',
  '  L1 — auto-advance + auto-merge on green; stops at any fix decision',
  '  L2 — also attempts fix-on-red autonomously; push needs a human',
  '  L3 — full auto: wave/batch, autonomous fix push, sub-agent spawn',
  '',
  '  Per-run override: arbiter ship --autonomy Lx',
  '',
].join('\n')

const AUTONOMY_OPTIONS: Opt<AutonomyLevel>[] = [
  { value: 'L0', label: 'L0 — ask at each ship step  [default]' },
  { value: 'L1', label: 'L1 — auto-advance + auto-merge on green' },
  { value: 'L2', label: 'L2 — + autonomous fix-on-red attempt' },
  { value: 'L3', label: 'L3 — full auto: wave/batch + fix push + sub-agents' },
]

// #1693 (ADR-101): runner profile axis — moves the fuzz + soak-e2e heavy
// scheduled jobs between nightly and weekly cadence. Orthogonal to
// collaborationMode/pipelineStyle. Message must start with the literal
// 'Runner profile' so the message-keyed test mock can match it.
const RUNNER_PROFILE_MESSAGE = [
  'Runner profile — cadence for the fuzz + soak/E2E heavy scheduled sweeps:',
  '',
  '  fleet — heavy sweeps (fuzz, soak/E2E) run nightly  [recommended for CI fleets]',
  '  solo  — heavy sweeps run weekly instead (single self-hosted runner / solo dev)',
  '',
].join('\n')

const RUNNER_PROFILE_OPTIONS: Opt<'solo' | 'fleet'>[] = [
  {
    value: 'fleet',
    label: 'fleet — heavy sweeps run nightly  [recommended for CI fleets]',
  },
  {
    value: 'solo',
    label: 'solo  — heavy sweeps run weekly instead (single self-hosted runner)',
  },
]
