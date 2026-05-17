// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, ArbiterError } from '../utils/errors.js'
import { t } from '../i18n/index.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { runProbes } from '../compatibility/probe.js'
import { formatText } from '../compatibility/report.js'
import { detectLanguage } from '../detectors/language.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework, detectArchetypeHint } from '../detectors/framework.js'
import { detectGitInfo, detectAdverseGitState } from '../detectors/git.js'
import { detectExisting } from '../detectors/existing.js'
import { detectBasePackage } from '../detectors/package.js'
import { detectGithubAccess } from '../detectors/github.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { detectLanes } from '../detectors/lanes.js'
import { runWizard, buildMigrationPlan } from '../wizard/prompts.js'
import { provisionLabels } from '../github/labels.js'
import { applyBranchProtection } from '../github/branch-protection.js'
import { createProjectBoard } from '../github/project-board.js'
import { saveConfig, loadConfig } from '../utils/config.js'
import type { ArbiterConfig } from '../utils/config.js'
import { DEFAULT_THRESHOLDS } from '../config/schema.js'
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  type GeneratorFailure,
} from '../generators/registry.js'
import { loadPlugin } from '../utils/plugin-loader.js'
import { renderFromAbsPath } from '../utils/render.js'
import { isWindows, isWSL2 } from '../utils/platform.js'
import { writeFile } from '../utils/fs.js'
import { isL3Allowed } from '../utils/maturity-check.js'
import { runCli } from '../utils/run-cli.js'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import { applyPreset } from '../wizard/presets.js'
import { defaultContractType } from '../wizard/archetype-defaults.js'
import type {
  ProjectConfig,
  AiTool,
  GovernanceLevel,
  Language,
  Archetype,
  ProjectPreset,
  AuthProvider,
  ObservabilityProvider,
  Lane,
} from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import { showTelemetryBannerIfFirstRun } from '../utils/first-run.js'
import { loadRecipe } from '../recipes/loader.js'
import type { Recipe } from '../recipes/schema.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { computeSkipReport } from '../generators/skills.js'

export interface InitOptions {
  yes: boolean
  tools: string | undefined
  level: string | undefined
  dir: string | undefined
  dryRun: boolean
  /** Auto-capture debt baseline after generation (brownfield day-0 lock-in). */
  brownfield: boolean
  /** Skip toolchain compatibility probes after generation. */
  noVerify: boolean
  /** Allow L3 generation with beta-maturity tools. Persisted in arbiter.json for audit. */
  acceptBetaTools?: boolean
  /** Override decomposition backend (github|markdown). If absent, derived from gh auth status. */
  backend?: 'github' | 'markdown'
  /** Emit machine-readable JSON envelope instead of human output. Requires --yes (wizard is incompatible). */
  json?: boolean | undefined
  /** Suppress informational banners such as the telemetry notice. */
  quiet?: boolean
  /** Override adverse git state check (detached HEAD, rebase, merge, etc.). Emits warning then continues. */
  force?: boolean
  /** Apply a meta-preset (industrial-grade) after config is resolved. Default: 'none'. */
  preset?: ProjectPreset
  /** Override auth provider after preset is applied. */
  authProvider?: AuthProvider
  /** Override observability provider after preset is applied. */
  observabilityProvider?: ObservabilityProvider
  /** Override detected language (skips auto-detection). */
  language?: Language
  /** Override detected archetype (skips auto-detection). */
  archetype?: Archetype
  /** Path or https:// URL to a recipe JSON file for pre-configuring init options. */
  recipe?: string
  /** Expected SHA-256 hex digest of the recipe file for integrity verification. */
  recipeSha256?: string
}

function assertNotNativeWindows(): void {
  if (isWindows() && !isWSL2()) {
    throw ArbiterError.fromKey('E_INIT_WIN32', 'errors.E_INIT_WIN32')
  }
}

export async function runInit(options: InitOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd())
  const projectName = basename(targetDir)
  const log: (msg: string) => void = options.json
    ? (): void => {}
    : (msg: string): void => {
        process.stdout.write(`${msg}\n`)
      }

  // --json requires --yes: interactive wizard reads stdin which is incompatible with
  // machine-readable output. Fail fast with a clear JSON error.
  if (options.json && !options.yes) {
    jsonOutput('init', 'error', {}, [
      '--json requires --yes (interactive wizard is incompatible with machine-readable output)',
    ])
    process.exit(1)
    return
  }

  assertNotNativeWindows()

  mkdirSync(join(targetDir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    showTelemetryBannerIfFirstRun(undefined, options.quiet)

    log('\n  Arbiter — AI Development Governance Framework\n')
    log('  Detecting project...')

    const language = resolveLanguage(options.language, targetDir)
    const framework = detectFramework(targetDir, language)
    const buildCmds = detectBuildCommands(targetDir, language)
    const gitInfo = detectGitInfo(targetDir)
    const existing = detectExisting(targetDir)
    const githubAccess = detectGithubAccess()
    const lanesResult = detectLanes(targetDir)

    log(`  ├── Language: ${language}${framework ? ` / ${framework}` : ''}`)
    log(`  ├── Build: ${buildCmds.buildTool}`)
    log(
      `  ├── Git: ${gitInfo.isGitRepo ? 'yes' : 'no'}${gitInfo.githubRepo ? ` (${gitInfo.githubOwner}/${gitInfo.githubRepo})` : ''}`,
    )
    if (githubAccess.authenticated)
      log(`  ├── GitHub: authenticated as ${githubAccess.username ?? 'unknown'}`)
    if (!options.json) logExistingDetections(existing)

    if (gitInfo.isGitRepo) {
      guardAdverseGitState(targetDir, options.force)
      if (options.brownfield) {
        guardBrownfieldDirtyTree(targetDir, options.force)
      }
    }

    const recipe = await loadRecipeFromOptions(options, log)

    const config = await resolveConfig({
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
      lanes: lanesResult.lanes,
    })
    if (config === null) return

    applyPresetOptions(options, config)

    if (options.dryRun) {
      displayDryRunPreview(config)
      return
    }

    checkL3MaturityGates(config)
    await generateAndFinalize(config, targetDir, options, log)
  } finally {
    await lock.release()
  }
}

function emitInitOutput(
  json: boolean | undefined,
  errorLines: string[],
  warnings: string[],
  created: number,
  skipped: number,
): void {
  if (json) {
    const status = errorLines.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok'
    jsonOutput(
      'init',
      status,
      { created, skipped },
      errorLines.length > 0 ? errorLines : undefined,
      warnings.length > 0 ? warnings : undefined,
    )
    if (status !== 'ok') process.exit(statusToExitCode(status))
    return
  }
  if (errorLines.length > 0) {
    // #483: print a structured stdout summary (not stderr — CI scripts pipe
    // stderr away) and exit non-zero so silent misconfiguration is impossible.
    process.stdout.write(
      `\n  Generator failures (${errorLines.length}):\n${errorLines
        .map((line) => `    - ${line}`)
        .join(
          '\n',
        )}\n\n  See https://github.com/arbiter-framework/arbiter/issues/483 for context.\n`,
    )
    process.exit(statusToExitCode('error'))
  }
  process.stdout.write(`${t('cli.init.verify_hint')}\n`)
}

function detectAndAuditSkills(targetDir: string): ReturnType<typeof detectInstalledSkills> {
  const claudeHome = process.env['HOME'] ? `${process.env['HOME']}/.claude` : ''
  const installedSkills = detectInstalledSkills({ targetDir, claudeHome })
  const skipReport = computeSkipReport(installedSkills)
  if (installedSkills.length > 0) {
    writeFile(
      join(targetDir, '.arbiter', 'detected-integrations.json'),
      JSON.stringify({ detectedSkills: installedSkills, skippedGenerators: skipReport }, null, 2) +
        '\n',
    )
  }
  return installedSkills
}

async function generateAndFinalize(
  config: ProjectConfig,
  targetDir: string,
  options: InitOptions,
  log: (msg: string) => void,
): Promise<void> {
  log('\n  Generating...')
  const committed: WriteResult[] = []

  try {
    const installedSkills = detectAndAuditSkills(targetDir)
    const { results, errors: generatorErrors } = runGeneratorsWithErrors(config, installedSkills)
    committed.push(...results)

    const newConfig = buildArbiterConfig(config)
    const backendResult = runBackendSetup(config, log)

    // Load existing stored config before overwriting (brownfield re-init may have plugins)
    const storedBefore = loadConfig(targetDir)
    saveConfig(targetDir, newConfig)

    const plugins: string[] = Array.isArray(storedBefore?.plugins) ? storedBefore.plugins : []
    const pluginResults = await runPlugins(targetDir, plugins, newConfig)
    committed.push(...pluginResults)

    if (!options.json) printResults(committed, targetDir)

    if (options.brownfield && !options.json) {
      const conflicts = committed.filter((r) => r.action === 'skipped')
      if (conflicts.length > 0) {
        log(`\n  Brownfield conflicts: ${conflicts.length} existing file(s) kept unchanged.`)
        log('  Use --force to replace them with arbiter governance files.\n')
      }
    }

    if (!options.brownfield && !options.json) {
      const skippedFiles = committed.filter((r) => r.action === 'skipped')
      if (skippedFiles.length > 0) {
        const names = skippedFiles.map((r) => basename(r.path)).join(', ')
        log(`\n  ${skippedFiles.length} file(s) already exist: ${names}`)
        log('  Re-run with --force to overwrite existing files.\n')
      }
    }

    const allResults = committed
    const created = allResults.filter((r) => r.action === 'created').length
    const skipped = allResults.filter((r) => r.action === 'skipped').length
    log(`\n  Done! ${created} files created, ${skipped} skipped.`)

    maybeCaptureBaseline(config, targetDir, options.brownfield)

    if (!options.noVerify) {
      runToolchainVerify(targetDir)
    }

    const generatorErrorLines = generatorErrors.map((e) => `${e.key}: ${e.message}`)
    emitInitOutput(options.json, generatorErrorLines, backendResult.warnings, created, skipped)
  } catch (err) {
    process.stderr.write('\n  Generation failed — attempting rollback...\n')
    rollbackGeneration(committed)
    process.stderr.write('  Rollback complete. Review arbiter.json if it was partially written.\n')
    throw err
  }
}

async function loadRecipeFromOptions(
  options: InitOptions,
  log: (msg: string) => void,
): Promise<Recipe | undefined> {
  if (!options.recipe) return undefined
  const recipe = await loadRecipe(
    options.recipe,
    options.recipeSha256 !== undefined ? { sha256: options.recipeSha256 } : {},
  )
  if (!options.json) log('  ├── Recipe: loaded')
  return recipe
}

function resolveUseGitHub(
  options: InitOptions,
  recipe: Recipe | undefined,
  githubAccess: ReturnType<typeof detectGithubAccess>,
): boolean {
  if (options.backend !== undefined) return options.backend === 'github'
  return recipe?.useGitHub ?? githubAccess.authenticated
}

function buildNonInteractiveConfig(args: {
  options: InitOptions
  recipe: Recipe | undefined
  targetDir: string
  projectName: string
  language: ReturnType<typeof detectLanguage>
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
  })
  if (recipe) applyRecipeOverrides(config, recipe)
  return config
}

function resolveLanguage(override: Language | undefined, targetDir: string): Language {
  if (override !== undefined) return override
  return detectLanguage(targetDir)
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

async function resolveConfig(args: {
  options: InitOptions
  recipe: Recipe | undefined
  targetDir: string
  projectName: string
  language: ReturnType<typeof detectLanguage>
  framework: string | null
  buildCmds: ReturnType<typeof detectBuildCommands>
  gitInfo: ReturnType<typeof detectGitInfo>
  existing: ReturnType<typeof detectExisting>
  githubAccess: ReturnType<typeof detectGithubAccess>
  lanes: import('../wizard/types.js').Lane[]
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
  } = args
  if (options.yes || recipe !== undefined) {
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
  })
  if (wizardResult === null) {
    return null
  }
  return wizardResult
}

export function runGenerators(config: ProjectConfig): WriteResult[] {
  return runGeneratorsFromRegistry(buildRegistry(config))
}

/**
 * Same as {@link runGenerators} but also returns generator failures collected
 * by `safeRun` (#483). Callers that surface command-level exit codes must use
 * this variant and surface any non-empty `errors` array via a non-zero exit
 * (INV-53 status=error → exit 2). The plain `runGenerators` wrapper is kept
 * for legacy callers (brownfield integration tests) that only consume results.
 */
function runGeneratorsWithErrors(
  config: ProjectConfig,
  installedSkills: Parameters<typeof buildRegistry>[1] = [],
): {
  results: WriteResult[]
  errors: GeneratorFailure[]
} {
  const errors: GeneratorFailure[] = []
  const results = runGeneratorsFromRegistry(buildRegistry(config, installedSkills), errors)
  return { results, errors }
}

export async function runPlugins(
  targetDir: string,
  plugins: string[],
  storedConfig: ArbiterConfig,
): Promise<WriteResult[]> {
  const all: WriteResult[] = []
  const writtenPaths = new Set<string>()
  const failures: string[] = []
  for (const pkg of plugins) {
    try {
      const plugin = await loadPlugin(pkg, targetDir)
      if (plugin.detect && !(await plugin.detect(storedConfig))) continue
      const ctx = {
        config: storedConfig,
        targetDir,
        renderTemplate(relPath: string, data: Record<string, unknown>): string {
          return renderFromAbsPath(join(plugin.templateRoot, relPath), data)
        },
      }
      const result = await plugin.generate(ctx)
      if (!Array.isArray(result.files)) {
        getLogger().warn(
          'init.plugin_invalid_result',
          { plugin: pkg },
          `Plugin "${pkg}" returned invalid result (no files array). Skipping.`,
        )
        continue
      }
      for (const file of result.files) {
        if (writtenPaths.has(file.path)) {
          getLogger().warn(
            'init.plugin_conflict',
            { plugin: pkg, path: file.path },
            `Plugin "${pkg}" conflict: "${file.path}" already written by a prior plugin. Skipping.`,
          )
          all.push({ path: file.path, action: 'skipped' })
          continue
        }
        writtenPaths.add(file.path)
        all.push(
          writeFile(file.path, file.content, {
            backup: file.action === 'backup-and-replace',
            skipIfExists: file.action === 'skip',
          }),
        )
      }
    } catch (err) {
      failures.push(`Plugin "${pkg}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failures.length > 0) {
    throw ArbiterError.fromKey('E_INIT_PLUGIN_FAILURES', 'errors.E_INIT_PLUGIN_FAILURES', {
      failures: failures.join('\n  '),
    })
  }
  return all
}

interface BackendResult {
  warnings: string[]
  errors: string[]
}

function runBackendSetup(config: ProjectConfig, log: (msg: string) => void): BackendResult {
  const backend = config.decompositionBackend ?? (config.useGitHub ? 'github' : 'markdown')
  if (backend === 'github') {
    return runGithubSetup(config, log)
  }
  const workDir = join(config.targetDir, '.arbiter', 'work')
  mkdirSync(workDir, { recursive: true })
  log('\n  Markdown backend: scaffolded .arbiter/work/')
  return { warnings: [], errors: [] }
}

export function runGithubSetup(
  config: ProjectConfig,
  log: (msg: string) => void = (msg: string): void => {
    process.stdout.write(`${msg}\n`)
  },
): BackendResult {
  if (!config.useGitHub || !config.githubOwner || !config.githubRepo)
    return { warnings: [], errors: [] }

  const warnings: string[] = []

  log('\n  GitHub setup...')
  log('  ├── Provisioning labels...')
  const labelResult = provisionLabels(config.githubOwner, config.githubRepo)
  if (labelResult.created.length > 0) log(`  │   Created: ${labelResult.created.join(', ')}`)
  if (labelResult.updated.length > 0) log(`  │   Updated: ${labelResult.updated.join(', ')}`)
  for (const e of labelResult.errors) {
    log(`  │   Error: ${e}`)
    warnings.push(e)
  }

  log('  ├── Applying branch protection to main...')
  const bp = applyBranchProtection(
    config.githubOwner,
    config.githubRepo,
    config.enableSoloDevMode === true,
  )
  if (bp.applied) {
    log('  │   Branch protection applied.')
  } else if (bp.error) {
    log(`  │   Skipped (requires admin access): ${bp.error}`)
    warnings.push(`branch protection skipped: ${bp.error}`)
  } else {
    log('  │   Skipped (requires admin access).')
  }

  log('  └── Creating project board...')
  const pb = createProjectBoard(config.githubOwner, config.githubRepo)
  if (pb.created) {
    log(`      Project board created: ${pb.projectUrl}`)
    for (const w of pb.warnings) {
      log(`      Warning: ${w}`)
      warnings.push(`project board: ${w}`)
    }
  } else if (pb.error) {
    log(`      Skipped: ${pb.error}`)
    warnings.push(`project board: ${pb.error}`)
  } else {
    log(`      Already exists: ${pb.projectUrl ?? 'unknown'}`)
  }

  return { warnings, errors: [] }
}

function guardAdverseGitState(targetDir: string, force: boolean | undefined): void {
  const adverseState = detectAdverseGitState(targetDir)
  if (!adverseState) return
  const warning = `\n  Warning: ${adverseState.message}\n  ${adverseState.suggestedFix}\n`
  if (!force) {
    throw new UserFacingError(
      `${adverseState.message}\n${adverseState.suggestedFix}\n${t('cli.shared.force_override_hint')}`,
    )
  }
  getLogger().warn(
    'init.adverse_git_state',
    { message: adverseState.message, suggested_fix: adverseState.suggestedFix },
    warning,
  )
}

export function guardBrownfieldDirtyTree(targetDir: string, force: boolean | undefined): void {
  try {
    const result = runCli('git', ['status', '--porcelain'], { cwd: targetDir, timeoutMs: 5000 })
    if (result.stdout.trim() === '') return
    if (!force)
      throw ArbiterError.fromKey(
        'E_INIT_DIRTY_TREE',
        'errors.E_INIT_DIRTY_TREE',
        {},
        { hint: 'Commit or stash changes first, or use --force to override.' },
      )
    getLogger().warn('init.dirty_tree', {}, t('cli.init.dirty_tree_warn'))
  } catch (err) {
    if (err instanceof UserFacingError) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EACCES') return // git binary not found
    throw err
  }
}

export interface DryRunPreview {
  created: string[]
  modified: string[]
  skipped: string[]
}

export function computeDryRunPreview(config: ProjectConfig): DryRunPreview {
  const plan = buildMigrationPlan(config.existing, config.tools, config.useGitHub)
  return {
    created: plan.created,
    modified: [...plan.replaced, ...plan.merged],
    skipped: plan.preserved,
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function rollbackGeneration(results: WriteResult[]): void {
  const rollbackErrors: string[] = []
  for (const result of results) {
    if (result.action === 'created') {
      try {
        if (existsSync(result.path)) unlinkSync(result.path)
      } catch (err) {
        rollbackErrors.push(`Could not remove ${result.path}: ${errMsg(err)}`)
      }
    } else if (result.action === 'backed-up-and-replaced') {
      const backup = `${result.path}.arbiter-backup`
      try {
        if (existsSync(backup)) {
          copyFileSync(backup, result.path)
          unlinkSync(backup)
        }
      } catch (err) {
        rollbackErrors.push(`Could not restore backup for ${result.path}: ${errMsg(err)}`)
      }
    }
  }
  if (rollbackErrors.length > 0) {
    process.stderr.write(`  Rollback partial — manual cleanup required:\n`)
    for (const e of rollbackErrors) process.stderr.write(`    ${e}\n`)
  }
}

function logExistingDetections(existing: ReturnType<typeof detectExisting>): void {
  if (existing.agentsMd) process.stdout.write(`${t('cli.init.existing_agents_md')}\n`)
  if (existing.claudeDir) process.stdout.write(`${t('cli.init.existing_claude_dir')}\n`)
  if (existing.agentsDir) process.stdout.write(`${t('cli.init.existing_agents_dir')}\n`)
  if (existing.geminiDir) process.stdout.write(`${t('cli.init.existing_gemini_dir')}\n`)
  if (existing.windsurfRules) process.stdout.write(`${t('cli.init.existing_windsurf')}\n`)
  if (existing.aiderConf) process.stdout.write(`${t('cli.init.existing_aider')}\n`)
  if (existing.aiRulez) process.stdout.write(`${t('cli.init.ai_rulez_detected')}\n`)
}

function maybeCaptureBaseline(config: ProjectConfig, targetDir: string, brownfield: boolean): void {
  if (config.governanceLevel === 'L3' && config.enableDebtGates) {
    runBrownfieldCapture(targetDir, { fatal: true })
  } else if (brownfield && config.enableDebtGates) {
    runBrownfieldCapture(targetDir)
  }
}

function runBrownfieldCapture(
  targetDir: string,
  opts: { fatal: boolean } = { fatal: false },
): void {
  process.stdout.write(`${t('cli.init.capturing_baseline')}\n`)
  try {
    runCli('node', ['scripts/capture-debt-baseline.mjs'], {
      cwd: targetDir,
      timeoutMs: 600_000,
    })
    process.stdout.write(`${t('cli.init.baseline_captured')}\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (opts.fatal) {
      process.stderr.write(
        `  GATE FAIL: Baseline capture failed (${msg}). Fix toolchain or run: node scripts/capture-debt-baseline.mjs\n`,
      )
      process.exit(1)
    }
    getLogger().warn(
      'init.baseline_capture_failed',
      { err: msg },
      `Baseline capture failed (${msg}). Re-run manually: node scripts/capture-debt-baseline.mjs`,
    )
  }
}

export function printResults(results: WriteResult[], targetDir: string): void {
  for (const result of results) {
    const icon = result.action === 'skipped' ? '│  ' : '├──'
    const label =
      result.action === 'skipped'
        ? ' (skipped — already exists)'
        : result.action === 'backed-up-and-replaced'
          ? ' (backed up + replaced)'
          : ''
    const relPath = result.path.replace(targetDir + '/', '')
    process.stdout.write(`${t('cli.init.file_entry', { icon, relPath, label })}\n`)
  }
}

function displayDryRunPreview(config: ProjectConfig): void {
  const preview = computeDryRunPreview(config)
  process.stdout.write(`${t('cli.init.dry_run_notice_full')}\n`)

  if (preview.created.length > 0) {
    process.stdout.write(`${t('cli.init.dry_run_create_header')}\n`)
    for (const entry of preview.created) {
      process.stdout.write(`${t('cli.init.dry_run_create_file', { entry })}\n`)
    }
  }
  if (preview.modified.length > 0) {
    process.stdout.write(`${t('cli.init.dry_run_modify_header')}\n`)
    for (const entry of preview.modified) {
      process.stdout.write(`${t('cli.init.dry_run_modify_file', { entry })}\n`)
    }
  }
  if (preview.skipped.length > 0) {
    process.stdout.write(`${t('cli.init.dry_run_skip_header')}\n`)
    for (const entry of preview.skipped) {
      process.stdout.write(`${t('cli.init.dry_run_skip_file', { entry })}\n`)
    }
  }

  process.stdout.write(`${t('cli.init.dry_run_run_hint')}\n`)
}

function buildDefaultConfig(opts: {
  targetDir: string
  projectName: string
  language: ReturnType<typeof detectLanguage>
  framework: string | null
  buildCmds: ReturnType<typeof detectBuildCommands>
  gitInfo: ReturnType<typeof detectGitInfo>
  existing: ReturnType<typeof detectExisting>
  tools: AiTool[]
  governanceLevel: GovernanceLevel
  useGitHub: boolean
  acceptBetaTools?: boolean
  lanes?: import('../wizard/types.js').Lane[]
  archetypeOverride?: Archetype
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
    enableMutationTesting: opts.governanceLevel !== 'L1',
    enableContractTesting: defaultContractType(archetype, hasPublicApi) !== 'none',
    enableEvidenceHarness: opts.governanceLevel !== 'L1',
    enableSelfValidationHarness: true,
    enableSoloDevMode: false,
    invariantTiers: presetToTiers(defaultPresetForLevel(opts.governanceLevel)),
    acceptBetaTools: opts.acceptBetaTools ?? false,
    contractType: defaultContractType(archetype, hasPublicApi),
    thresholds: DEFAULT_THRESHOLDS[opts.governanceLevel],
    lanes: opts.lanes ?? [],
    ...detectedBasePackage(opts.language, opts.targetDir),
  }
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
  if (recipe.enableSoloDevMode !== undefined) config.enableSoloDevMode = recipe.enableSoloDevMode
  if (recipe.enableMcpFallback !== undefined) config.enableMcpFallback = recipe.enableMcpFallback
  if (recipe.enableNoSkippedTests !== undefined)
    config.enableNoSkippedTests = recipe.enableNoSkippedTests
}

function buildArbiterConfig(config: ProjectConfig): ArbiterConfig {
  const level = config.governanceLevel
  const backend = config.decompositionBackend ?? (config.useGitHub ? 'github' : 'markdown')
  return {
    version: '0.2',
    tools: config.tools,
    governanceLevel: level,
    useGitHub: config.useGitHub,
    decomposition: { backend },
    features: {
      debtGates: config.enableDebtGates,
      suppressions: config.enableSuppressions,
      securityScanning: config.enableSecurityScanning,
      mutationTesting: config.enableMutationTesting !== false,
      contractTesting: config.enableContractTesting !== false,
      evidenceHarness: config.enableEvidenceHarness === true,
      selfValidationHarness: config.enableSelfValidationHarness !== false,
      soloDevMode: config.enableSoloDevMode === true,
    },
    thresholds: config.thresholds ?? DEFAULT_THRESHOLDS[level],
    invariantTiers: config.invariantTiers,
    archetype: config.archetype,
    architectureStyle: config.architectureStyle,
    isMultiTenant: config.isMultiTenant,
    hasDatabase: config.hasDatabase,
    hasPublicApi: config.hasPublicApi,
    ...(config.acceptBetaTools === true ? { acceptBetaTools: true } : {}),
    ...(config.evidenceRetention !== undefined
      ? { evidenceRetention: config.evidenceRetention }
      : {}),
    ...(config.thresholdProfile !== undefined ? { thresholdProfile: config.thresholdProfile } : {}),
    ...(config.strictnessTier !== undefined ? { strictnessTier: config.strictnessTier } : {}),
    contractType: config.contractType,
    ...(config.basePackage !== undefined ? { basePackage: config.basePackage } : {}),
    ...(config.lanes.length > 0 ? { lanes: config.lanes } : {}),
    ...(config.taskTiers !== undefined ? { taskTiers: config.taskTiers } : {}),
    ...(config.observability !== undefined ? { observability: config.observability } : {}),
    ...(config.auth !== undefined ? { auth: config.auth } : {}),
    ...(config.preset !== undefined && config.preset !== 'none' ? { preset: config.preset } : {}),
  }
}

function applyPresetOptions(options: InitOptions, config: ProjectConfig): void {
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
  language: ReturnType<typeof detectLanguage>,
  targetDir: string,
): { basePackage: string } | Record<never, never> {
  if (language !== 'java' && language !== 'multi') return {}
  const bp = detectBasePackage(targetDir)
  return bp !== undefined ? { basePackage: bp } : {}
}

function parseTools(tools: string | undefined): AiTool[] {
  if (!tools) return ['claude', 'codex']
  const VALID = new Set(['claude', 'codex', 'cursor', 'copilot', 'gemini', 'windsurf', 'aider'])
  const parsed = tools.split(',').map((s) => s.trim())
  const invalid = parsed.filter((s) => !VALID.has(s))
  if (invalid.length > 0) {
    throw ArbiterError.fromKey('E_INVALID_TOOL', 'errors.E_INVALID_TOOL', {
      tool: invalid.map((s) => `"${s}"`).join(', '),
      valid: [...VALID].join(', '),
    })
  }
  return parsed as AiTool[]
}

function parseLevel(level: string | undefined): GovernanceLevel {
  if (level === undefined) return 'L2'
  if (level === 'L1' || level === 'L2' || level === 'L3') return level
  throw ArbiterError.fromKey(
    'E_INVALID_LEVEL',
    'errors.E_INVALID_LEVEL',
    { level },
    { hint: 'Use L1 (fast), L2 (standard, default), or L3 (audit-grade).' },
  )
}

/**
 * Gate check for L3 maturity. Blocks generation if any L3 feature
 * (mutation, contract) is marked unsafe or beta without --accept-beta-tools.
 * Exits the process with an actionable error message on violation.
 */
function checkL3MaturityGates(config: ProjectConfig): void {
  if (config.governanceLevel !== 'L3') return

  const l3Features: Array<'mutation' | 'contract'> = ['mutation', 'contract']
  const blocked: string[] = []

  for (const feature of l3Features) {
    const result = isL3Allowed(config.language, feature, config.acceptBetaTools ?? false)
    if (!result.allowed && result.errorMessage) {
      blocked.push(`  • ${result.errorMessage}`)
    }
  }

  if (blocked.length > 0) {
    process.stderr.write(`${t('cli.init.gate_failed')}\n`)
    for (const msg of blocked) {
      process.stderr.write(`${msg}\n`)
    }
    process.stderr.write(`${t('cli.init.accept_beta_hint')}\n`)
    process.exit(1)
  }
}

function runToolchainVerify(targetDir: string): void {
  process.stdout.write(`${t('cli.init.verifying_toolchain')}\n`)
  let report: ReturnType<typeof runProbes>
  try {
    report = runProbes(targetDir)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `\n  Toolchain verification failed unexpectedly: ${msg}\n` +
        '  Generated files are on disk. Use --no-verify to skip verification.\n',
    )
    process.exit(1)
  }
  process.stdout.write(`${formatText(report)}\n`)
  if (report.hasFailures) {
    process.stderr.write(
      '\n  arbiter init aborted: toolchain incompatibilities detected.\n' +
        '  Fix the issues above and re-run, or use --no-verify to skip.\n',
    )
    process.exit(1)
  }
}
