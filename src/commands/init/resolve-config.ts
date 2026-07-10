// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from init.ts — config resolution (interactive
// wizard vs non-interactive fast path, preset/recipe/tier application, default config
// derivation). Pure extraction, no behavior change.
import { ArbiterError } from '../../utils/errors.js'
import { jvmRoot } from '../../detectors/language.js'
import { detectBuildCommands } from '../../detectors/build.js'
import { detectArchetypeHint } from '../../detectors/framework.js'
import { detectGitInfo } from '../../detectors/git.js'
import { detectExisting } from '../../detectors/existing.js'
import { detectBasePackage } from '../../detectors/package.js'
import { detectGithubAccess } from '../../detectors/github.js'
import { getLanguageHooks } from '../../detectors/language-hooks.js'
import { runWizard } from '../../wizard/prompts.js'
import { DEFAULT_THRESHOLDS } from '../../config/schema.js'
import type { AutomationConfig } from '../../config/schema.js'
import { levelAtLeast } from '../../config/levels.js'
import { presetToTiers, defaultPresetForLevel } from '../../invariants/filter.js'
import { applyPreset } from '../../wizard/presets.js'
import { defaultContractType } from '../../wizard/archetype-defaults.js'
import type {
  ProjectConfig,
  AiTool,
  FrontendConfig,
  GovernanceLevel,
  Language,
  Archetype,
  Lane,
} from '../../wizard/types.js'
import type { Recipe } from '../../recipes/schema.js'
import type { InitOptions } from './types.js'

function resolveUseGitHub(
  options: InitOptions,
  _recipe: Recipe | undefined,
  githubAccess: ReturnType<typeof detectGithubAccess>,
): boolean {
  if (options.backend !== undefined)
    return options.backend === 'github' && githubAccess.authenticated
  if (options.github) return githubAccess.authenticated
  const arbGhEnv = process.env['ARBITER_GITHUB']
  if (arbGhEnv !== undefined && arbGhEnv !== '1') {
    process.stderr.write(
      `Warning: ARBITER_GITHUB=${arbGhEnv} is not '1' — only ARBITER_GITHUB=1 activates GitHub API calls. Ignored.\n`,
    )
  }
  if (arbGhEnv === '1') return githubAccess.authenticated
  return false
}

function buildNonInteractiveConfig(args: {
  options: InitOptions
  recipe: Recipe | undefined
  targetDir: string
  projectName: string
  language: Language
  framework: string | null
  buildCmds: ReturnType<typeof detectBuildCommands>
  gitInfo: ReturnType<typeof detectGitInfo>
  existing: ReturnType<typeof detectExisting>
  githubAccess: ReturnType<typeof detectGithubAccess>
  lanes: Lane[]
}): ProjectConfig {
  const {
    options,
    recipe,
    targetDir,
    projectName,
    language,
    framework,
    buildCmds,
    gitInfo,
    existing,
    githubAccess,
    lanes,
  } = args
  const useGitHub = resolveUseGitHub(options, recipe, githubAccess)
  const { tools, governanceLevel } = resolveToolsAndLevel(options, recipe)
  const config = buildDefaultConfig({
    targetDir,
    projectName,
    language: recipe?.language ?? language,
    framework: recipe && 'framework' in recipe ? (recipe.framework ?? null) : framework,
    buildCmds,
    gitInfo,
    existing,
    tools,
    governanceLevel,
    useGitHub,
    acceptBetaTools: options.acceptBetaTools ?? false,
    lanes,
    ...(options.archetype !== undefined ? { archetypeOverride: options.archetype } : {}),
    solo: options.solo === true,
  })
  if (recipe) applyRecipeOverrides(config, recipe)
  // #1677: a recipe's deployTarget (if any) is applied above; an explicit
  // --deploy-target flag is the operator's final word, so it wins last.
  if (options.deployTarget !== undefined) config.deployTarget = options.deployTarget
  return config
}

export function formatLangHint(locked: boolean, source: string | null): string {
  if (locked) return ''
  return source ? ` (detected from ${source})` : ' (no markers found)'
}

function resolveToolsAndLevel(
  options: InitOptions,
  recipe: Recipe | undefined,
): { tools: AiTool[]; governanceLevel: GovernanceLevel } {
  return {
    tools: options.tools ? parseTools(options.tools) : (recipe?.tools ?? parseTools(undefined)),
    governanceLevel: options.level
      ? parseLevel(options.level)
      : (recipe?.governanceLevel ?? parseLevel(undefined)),
  }
}

export async function resolveConfig(args: {
  options: InitOptions
  recipe: Recipe | undefined
  targetDir: string
  projectName: string
  language: Language
  framework: string | null
  buildCmds: ReturnType<typeof detectBuildCommands>
  gitInfo: ReturnType<typeof detectGitInfo>
  existing: ReturnType<typeof detectExisting>
  githubAccess: ReturnType<typeof detectGithubAccess>
  lanes: import('../../wizard/types.js').Lane[]
  languageLocked: boolean
  languageSource: string | null
}): Promise<ProjectConfig | null> {
  const {
    options,
    recipe,
    targetDir,
    projectName,
    language,
    framework,
    buildCmds,
    gitInfo,
    existing,
    githubAccess,
    lanes,
    languageLocked,
    languageSource,
  } = args
  // #1839 (F3): `--preset` is a self-sufficient fast path — it must not additionally
  // require `--yes` to skip the interactive wizard. Without this, a bare `--preset
  // industrial-grade` fell through to runWizard() and blocked on stdin.
  const presetFastPath = options.preset !== undefined && options.preset !== 'none'
  if (options.yes || recipe !== undefined || presetFastPath) {
    return buildNonInteractiveConfig({
      options,
      recipe,
      targetDir,
      projectName,
      language,
      framework,
      buildCmds,
      gitInfo,
      existing,
      githubAccess,
      lanes,
    })
  }
  const wizardResult = await runWizard({
    targetDir,
    projectName,
    language,
    framework,
    buildCmds,
    gitInfo,
    existing,
    githubAccess,
    detectedLanes: lanes,
    languageLocked,
    languageSource,
  })
  if (wizardResult === null) {
    return null
  }
  // #1659: the interactive wizard never collects basePackage (only the non-interactive
  // path spread detectedBasePackage). A user who picks java/kotlin + hexagonal/layered in
  // the wizard otherwise got config.basePackage === undefined → generateArchUnit emits ZERO
  // enforcement. Enrich here, respecting any explicit value the wizard ever sets.
  if (wizardResult.basePackage === undefined) {
    Object.assign(wizardResult, detectedBasePackage(language, targetDir))
  }
  return wizardResult
}

function buildDefaultConfig(opts: {
  targetDir: string
  projectName: string
  language: Language
  framework: string | null
  buildCmds: ReturnType<typeof detectBuildCommands>
  gitInfo: ReturnType<typeof detectGitInfo>
  existing: ReturnType<typeof detectExisting>
  tools: AiTool[]
  governanceLevel: GovernanceLevel
  useGitHub: boolean
  acceptBetaTools?: boolean
  lanes?: import('../../wizard/types.js').Lane[]
  archetypeOverride?: Archetype
  /** ADR-051 (#1119): when true, sets collaborationMode='trunk-solo' (--solo flag). */
  solo?: boolean
}): ProjectConfig {
  const archetype =
    opts.archetypeOverride ??
    detectArchetypeHint(opts.targetDir, opts.language, opts.framework) ??
    'library'
  const hasDatabase = archetype === 'backend-web-db' || archetype === 'data-pipeline'
  const hasPublicApi = archetype === 'backend-web-db'
  return {
    targetDir: opts.targetDir,
    projectName: opts.projectName,
    description: `${opts.projectName} project`,
    language: opts.language,
    framework: opts.framework,
    archetype,
    architectureStyle: 'none',
    isMultiTenant: false,
    hasDatabase,
    hasPublicApi,
    buildTool: opts.buildCmds.buildTool,
    buildCommand: opts.buildCmds.buildCommand,
    testCommand: opts.buildCmds.testCommand,
    lintCommand: opts.buildCmds.lintCommand,
    formatCommand: opts.buildCmds.formatCommand,
    tools: opts.tools,
    governanceLevel: opts.governanceLevel,
    useGitHub: opts.useGitHub,
    decompositionBackend: opts.useGitHub ? 'github' : 'markdown',
    githubOwner: opts.gitInfo.githubOwner,
    githubRepo: opts.gitInfo.githubRepo,
    existing: opts.existing,
    languageHooks: getLanguageHooks(opts.language),
    enableDebtGates: opts.governanceLevel !== 'L1',
    enableSuppressions: true,
    enableSecurityScanning: opts.governanceLevel !== 'L1',
    enableMutationTesting: levelAtLeast(opts.governanceLevel, 'L3'),
    enableContractTesting: defaultContractType(archetype, hasPublicApi) !== 'none',
    enableEvidenceHarness: opts.governanceLevel === 'L4',
    enableSelfValidationHarness: true,
    enableSoloDevMode: false,
    // ADR-051 (#1119): --solo flag sets collaborationMode='trunk-solo' at init time.
    // Default (non-interactive): 'peer-review'. Wizard overrides this with user choice.
    collaborationMode: opts.solo === true ? 'trunk-solo' : 'peer-review',
    // #1261: non-interactive init defaults the ship-autonomy axis to the safe L0
    // (ask each step). Recipes may override via applyRecipeOverrides.
    automation: { autonomy: 'L0' },
    invariantTiers: presetToTiers(defaultPresetForLevel(opts.governanceLevel)),
    acceptBetaTools: opts.acceptBetaTools ?? false,
    contractType: defaultContractType(archetype, hasPublicApi),
    thresholds: DEFAULT_THRESHOLDS[opts.governanceLevel],
    lanes: opts.lanes ?? [],
    ...detectedBasePackage(opts.language, opts.targetDir),
    // #1127: auto-derive frontend.framework for frontend-spa projects from detected framework.
    // This makes the generated ESLint config and gate scripts framework-aware without
    // requiring an explicit --frontend.framework flag on init.
    ...(archetype === 'frontend-spa'
      ? inferFEFramework(opts.framework) !== undefined
        ? { frontend: { framework: inferFEFramework(opts.framework) } as FrontendConfig }
        : {}
      : {}),
  }
}

/**
 * #1127: Map the detected top-level framework string (e.g. 'vue', 'react', 'next')
 * to the FrontendConfig.framework discriminant for frontend-spa projects.
 * Returns undefined for unknown or non-FE frameworks (e.g. 'spring-boot').
 */
function inferFEFramework(framework: string | null): FrontendConfig['framework'] | undefined {
  if (!framework) return undefined
  const lower = framework.toLowerCase()
  if (lower === 'vue' || lower.endsWith('+vue') || lower.startsWith('vue+')) return 'vue'
  if (lower === 'svelte') return 'svelte'
  // 'next' → backend-web-db archetype (never reaches here from auto-detection).
  // 'express+react' → backend-web-db archetype (same). Both branches are intentionally
  // omitted to avoid silently setting frontend.framework on non-SPA archetypes.
  // 'tauri+react' → frontend-spa, reachable.
  if (lower === 'react' || lower.includes('react')) return 'react'
  return undefined
}

function applyRecipeOverrides(config: ProjectConfig, recipe: Recipe): void {
  if (recipe.archetype !== undefined) config.archetype = recipe.archetype
  if (recipe.architectureStyle !== undefined) config.architectureStyle = recipe.architectureStyle
  if (recipe.isMultiTenant !== undefined) config.isMultiTenant = recipe.isMultiTenant
  if (recipe.hasDatabase !== undefined) config.hasDatabase = recipe.hasDatabase
  if (recipe.hasPublicApi !== undefined) config.hasPublicApi = recipe.hasPublicApi
  if (recipe.enableDebtGates !== undefined) config.enableDebtGates = recipe.enableDebtGates
  if (recipe.enableSuppressions !== undefined) config.enableSuppressions = recipe.enableSuppressions
  if (recipe.enableSecurityScanning !== undefined)
    config.enableSecurityScanning = recipe.enableSecurityScanning
  if (recipe.enableMutationTesting !== undefined)
    config.enableMutationTesting = recipe.enableMutationTesting
  if (recipe.enableContractTesting !== undefined)
    config.enableContractTesting = recipe.enableContractTesting
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (recipe.enableSoloDevMode !== undefined) config.enableSoloDevMode = recipe.enableSoloDevMode
  if (recipe.enableMcpFallback !== undefined) config.enableMcpFallback = recipe.enableMcpFallback
  if (recipe.enableNoSkippedTests !== undefined)
    config.enableNoSkippedTests = recipe.enableNoSkippedTests
  // #1261: recipes are the supported non-interactive knob for ship autonomy.
  // #1306: the automation block (incl. the three orchestration prefs) is merged
  // by a helper to keep applyRecipeOverrides within the complexity-15 limit.
  if (recipe.automation !== undefined) config.automation = recipeAutomation(recipe.automation)
  // #1317/#1318.4: the database engine + axis fields are merged by a helper to
  // keep applyRecipeOverrides within the complexity-15 limit.
  applyRecipeAxisOverrides(config, recipe)
  // #1835: the CI-gate opt-in is merged by a helper to keep
  // applyRecipeOverrides within the complexity-15 limit.
  applyRecipeCiOverrides(config, recipe)
}

/**
 * #1835 — apply the CI-gate opt-in flags a recipe may declare
 * (`enableAuditToolchain`, `enableFiveLaneCi` — Task B, #1825). Extracted to keep
 * applyRecipeOverrides under the complexity-15 ceiling.
 */
function applyRecipeCiOverrides(config: ProjectConfig, recipe: Recipe): void {
  if (recipe.enableAuditToolchain !== undefined) {
    config.enableAuditToolchain = recipe.enableAuditToolchain
  }
  if (recipe.enableFiveLaneCi !== undefined) {
    config.enableFiveLaneCi = recipe.enableFiveLaneCi
  }
}

/**
 * #1317/#1318.4 — apply the database engine + axis fields a recipe may declare.
 * `databaseEngine` is authoritative: when present it also re-derives `hasDatabase`
 * (engine !== 'none') so the two never diverge (mirrors detectors/axis.ts).
 * Extracted to keep applyRecipeOverrides under the complexity-15 ceiling.
 */
function applyRecipeAxisOverrides(config: ProjectConfig, recipe: Recipe): void {
  if (recipe.databaseEngine !== undefined) {
    config.databaseEngine = recipe.databaseEngine
    config.hasDatabase = recipe.databaseEngine !== 'none'
  }
  if (recipe.contractType !== undefined) config.contractType = recipe.contractType
  if (recipe.lanes !== undefined) config.lanes = recipe.lanes
  if (recipe.evidenceHarness !== undefined) config.enableEvidenceHarness = recipe.evidenceHarness
  if (recipe.decomposition !== undefined) {
    config.decompositionBackend = recipe.decomposition.backend
  }
}

/**
 * #1306 — build a persisted AutomationConfig from a recipe's automation block,
 * including ONLY the orchestration prefs that are present (exactOptionalPropertyTypes:
 * an absent recipe field must NOT land as an explicit `undefined` on the config).
 */
function recipeAutomation(a: NonNullable<Recipe['automation']>): AutomationConfig {
  return {
    autonomy: a.autonomy,
    ...(a.maxParallelWorktrees !== undefined
      ? { maxParallelWorktrees: a.maxParallelWorktrees }
      : {}),
    ...(a.defaultGateLevel !== undefined ? { defaultGateLevel: a.defaultGateLevel } : {}),
    ...(a.affinityBatching !== undefined ? { affinityBatching: a.affinityBatching } : {}),
  }
}

export function applyPresetOptions(options: InitOptions, config: ProjectConfig): void {
  applyPreset(options.preset ?? 'none', config)
  if (options.authProvider != null && options.authProvider !== 'none') {
    config.auth = { provider: 'none', ...config.auth }
    config.auth.provider = options.authProvider
  }
  if (options.observabilityProvider != null && options.observabilityProvider !== 'none') {
    config.observability = { provider: 'none', ...config.observability }
    config.observability.provider = options.observabilityProvider
  }
}

function detectedBasePackage(
  language: Language,
  targetDir: string,
): { basePackage: string } | Record<never, never> {
  // #1659: kotlin is a JVM language generateArchUnit processes — it was excluded here,
  // so even `--language kotlin` got basePackage undefined and emitted zero ArchUnit.
  if (language !== 'java' && language !== 'kotlin' && language !== 'multi') return {}
  // #1659: detect against the JVM root (root or `backend/` for a multi monorepo, per the
  // #1567 jvmRoot SSOT), not the repo root — otherwise a polyglot repo with backend/pom.xml
  // detects no basePackage and the Java ArchUnit suite is silently dropped.
  const bp = detectBasePackage(jvmRoot(targetDir) ?? targetDir)
  return bp !== undefined ? { basePackage: bp } : {}
}

function parseTools(tools: string | undefined): AiTool[] {
  if (!tools) return ['claude', 'codex']
  // Customer-facing supported tools only. The experimental tools (cursor,
  // copilot, gemini, windsurf, aider) keep their generators but are NOT
  // advertised or accepted here — see the AiTool support policy in
  // wizard/types.ts. The E_INVALID_TOOL message lists this set verbatim.
  const VALID = new Set(['claude', 'codex'])
  const parsed = tools.split(',').map((s) => s.trim())
  const invalid = parsed.filter((s) => !VALID.has(s))
  if (invalid.length > 0) {
    // The message template owns no quotes; we quote each invalid tool exactly
    // once here so a list renders as `"cursor", "copilot"` (never `""cursor""`),
    // and agree the noun in number for a clean first-run error.
    throw ArbiterError.fromKey('E_INVALID_TOOL', 'errors.E_INVALID_TOOL', {
      noun: invalid.length === 1 ? 'tool' : 'tools',
      tool: invalid.map((s) => `"${s}"`).join(', '),
      valid: [...VALID].join(', '),
    })
  }
  return parsed as AiTool[]
}

function parseLevel(level: string | undefined): GovernanceLevel {
  if (level === undefined) return 'L2'
  if (level === 'L1' || level === 'L2' || level === 'L3' || level === 'L4') return level
  throw ArbiterError.fromKey(
    'E_INVALID_LEVEL',
    'errors.E_INVALID_LEVEL',
    { level },
    { hint: 'Use L1 (fast), L2 (standard, default), L3 (audit-grade), or L4 (compliance-grade).' },
  )
}

/**
 * #1447 (ADR-098): map a progressive-adoption tier to concrete init settings.
 * `bootstrap` is the gentlest Day-1 entry — governance L1 (the minimal runnable gate)
 * plus brownfield baseline lock-in so a messy repo's pre-existing debt is captured
 * rather than failing the gate on day one. `L1`–`L4` are governance-level aliases that
 * do NOT force brownfield. Graduation up the ladder (bootstrap → L1 → L2 → L3 → L4)
 * uses the existing `arbiter upgrade-level` / `arbiter configure` flow (see ADR-098).
 * Returns the resolved governance level + whether to auto-capture the brownfield debt
 * baseline. The return shape is inlined (not an exported interface) to keep the public
 * API surface to the single function.
 */
export function resolveAdoptionTier(tier: string): {
  governanceLevel: GovernanceLevel
  brownfield: boolean
} {
  if (tier === 'bootstrap') return { governanceLevel: 'L1', brownfield: true }
  if (tier === 'L1' || tier === 'L2' || tier === 'L3' || tier === 'L4') {
    return { governanceLevel: tier, brownfield: false }
  }
  throw ArbiterError.fromKey(
    'E_INVALID_LEVEL',
    'errors.E_INVALID_LEVEL',
    { level: tier },
    { hint: 'Use bootstrap (gentlest Day-1 on-ramp), L1, L2, L3, or L4.' },
  )
}

/**
 * #1447 (ADR-098): desugar `--tier` into the existing `--level` + `--brownfield` init
 * settings (bootstrap → L1 + brownfield baseline). `--tier` takes precedence over
 * `--level`. Extracted so runInit stays within the complexity budget.
 */
export function applyAdoptionTier(options: InitOptions): void {
  if (options.tier === undefined) return
  const resolved = resolveAdoptionTier(options.tier)
  options.level = resolved.governanceLevel
  if (resolved.brownfield) options.brownfield = true
}

export function parseLanguage(language: Language | undefined): Language | undefined {
  if (language === undefined) return undefined
  const VALID = new Set<Language>(['typescript', 'java', 'kotlin', 'rust', 'python', 'go', 'multi'])
  if (VALID.has(language)) return language
  throw ArbiterError.fromKey('E_INVALID_LANGUAGE', 'errors.E_INVALID_LANGUAGE', { language })
}
