// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from init.ts — generator execution, plugin
// loading, dry-run preview, and rollback/verification of generation output. Pure
// extraction, no behavior change.
import { existsSync } from 'node:fs'
import { resolve, join, normalize, isAbsolute, relative, sep, basename } from 'node:path'
import { ArbiterError } from '../../utils/errors.js'
import { t } from '../../i18n/index.js'
import { getLogger } from '../../utils/logger.js'
import type { ArbiterConfig } from '../../utils/config.js'
import type { Invariant } from '../../invariants/types.js'
import { levelAtLeast } from '../../config/levels.js'
import { buildRegistry, runGeneratorsFromRegistry } from '../../generators/registry.js'
import type { GeneratorFailure, GeneratorSpec } from '../../generators/registry.js'
import { loadPlugin } from '../../utils/plugin-loader.js'
import { renderFromAbsPath } from '../../utils/render.js'
import { copyFileTranslated, unlinkTranslated, writeFile } from '../../utils/fs.js'
import type { WriteResult } from '../../utils/fs.js'
import { runCli, CliError } from '../../utils/run-cli.js'
import type { ProjectConfig } from '../../wizard/types.js'
import type { InitOptions } from './types.js'
import { buildArbiterConfig } from './build-arbiter-config.js'
import { runBackendSetup } from './github-setup.js'
import { loadConfig, saveConfig } from '../../utils/config.js'
import { beginGenerationSession, endGenerationSession } from '../../utils/fs.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../../state/generated-manifest.js'
import { buildAdoptPredicate, recordLocalOverride } from '../adopt-policy.js'
import { detectInstalledSkills } from '../../integrations/skill-detector.js'
import type { InstalledSkill } from '../../integrations/types.js'
import { computeSkipReport, excludeOwnEmittedSkills } from '../../generators/skills.js'
import { jsonOutput, statusToExitCode } from '../../utils/json-output.js'

export function runGenerators(config: ProjectConfig): WriteResult[] {
  return runGeneratorsFromRegistry(buildRegistry(config), [], { dryRun: false })
}

interface GenerateAndFinalizeOptions {
  config: ProjectConfig
  targetDir: string
  initOptions: InitOptions
  log: (message: string) => void
  brownfieldDetected: boolean
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
}

/** Run generation, persistence, plugins, and the post-write baseline flow. */
export async function generateAndFinalize(args: GenerateAndFinalizeOptions): Promise<void> {
  const { config, targetDir, initOptions, log, brownfieldDetected, packageManager } = args
  log('\n  Generating...')
  const committed: WriteResult[] = []

  try {
    // #2452: the real run and `init --dry-run` execute the SAME plan through the
    // SAME entry point — only `dryRun` and the side-effecting `onAdopt` differ.
    // There is no second, hand-maintained preview to drift away from it.
    const execution = await executeInitGeneration({
      config,
      targetDir,
      dryRun: false,
      adoptGovernance: initOptions.adoptGovernance === true,
      onAdopt: (key, priorContent, newContent): void => {
        recordLocalOverride(targetDir, { key, priorContent, newContent })
      },
    })
    const { results, errors: generatorErrors, mergedConfig, plugins } = execution
    writeSkillAudit(targetDir, execution.installedSkills)
    saveGeneratedManifest(targetDir, { ...execution.prevManifest, ...execution.generatedHashes })
    committed.push(...results)

    const newConfig = buildArbiterConfig(mergedConfig)
    const backendResult = runBackendSetup(config, log)
    await saveConfig(targetDir, newConfig)

    // The plugin ctx config carries the merged invariants (workerData
    // serialization) so plugin templates render the same effective set.
    committed.push(...(await runPlugins(targetDir, plugins, newConfig)))

    if (!initOptions.json) printResults(committed, targetDir)
    printBrownfieldConflicts(committed, initOptions, log)
    assertEmittedFilesPresent(committed)
    printGreenfieldConflicts(committed, initOptions, log)

    const created = committed.filter((result) => result.action === 'created').length
    const skipped = committed.filter((result) => result.action === 'skipped').length
    const brownfieldWarning =
      brownfieldDetected && !initOptions.brownfield ? t('cli.init.brownfield_route') : undefined
    if (brownfieldWarning !== undefined && !initOptions.json) log(`\n  ${brownfieldWarning}`)
    log(`\n  Done! ${created} files created, ${skipped} skipped.`)

    maybeCaptureBaseline(config, targetDir, initOptions.brownfield, packageManager)
    activateGitHooks(targetDir, log)
    emitInitOutput(
      initOptions.json,
      generatorErrors.map((error) => `${error.key}: ${error.message}`),
      brownfieldWarning === undefined
        ? backendResult.warnings
        : [...backendResult.warnings, brownfieldWarning],
      created,
      skipped,
    )
  } catch (err) {
    process.stderr.write('\n  Generation failed — attempting rollback...\n')
    rollbackGeneration(committed)
    process.stderr.write('  Rollback complete. Review arbiter.json if it was partially written.\n')
    throw err
  } finally {
    endGenerationSession()
  }
}

/**
 * #2452: detection ONLY — no write. The generator registry is built from this set, so
 * the preview and the real run must resolve it identically; the audit artifact that
 * used to be written from here is now {@link writeSkillAudit}, which a dry run skips.
 */
function detectSkillsForPlan(targetDir: string): InstalledSkill[] {
  const claudeHome = process.env['HOME'] ? `${process.env['HOME']}/.claude` : ''
  return excludeOwnEmittedSkills(detectInstalledSkills({ targetDir, claudeHome }))
}

/** Persist the detected-integrations audit artifact. Real runs only — this is a write. */
function writeSkillAudit(targetDir: string, installedSkills: InstalledSkill[]): void {
  if (installedSkills.length === 0) return
  writeFile(
    join(targetDir, '.arbiter', 'detected-integrations.json'),
    JSON.stringify(
      { detectedSkills: installedSkills, skippedGenerators: computeSkipReport(installedSkills) },
      null,
      2,
    ) + '\n',
  )
}

function printBrownfieldConflicts(
  committed: WriteResult[],
  options: InitOptions,
  log: (message: string) => void,
): void {
  if (!options.brownfield || options.json) return
  const conflicts = committed.filter((result) => result.action === 'skipped')
  if (conflicts.length > 0) {
    log(`\n  Brownfield conflicts: ${conflicts.length} existing file(s) kept unchanged.`)
    log('  Use --force to replace them with arbiter governance files.\n')
  }
}

function printGreenfieldConflicts(
  committed: WriteResult[],
  options: InitOptions,
  log: (message: string) => void,
): void {
  if (options.brownfield || options.json) return
  const skippedFiles = committed.filter(
    (result) => result.action === 'skipped' && result.reason !== 'not-applicable',
  )
  if (skippedFiles.length > 0) {
    const names = skippedFiles.map((result) => basename(result.path)).join(', ')
    log(`\n  ${skippedFiles.length} file(s) already exist: ${names}`)
    log('  Re-run with --force to overwrite existing files.\n')
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
      warnings.length > 0 ? { warnings } : undefined,
    )
    if (status !== 'ok') process.exit(statusToExitCode(status))
    return
  }
  if (errorLines.length > 0) {
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

function activateGitHooks(targetDir: string, log: (message: string) => void): void {
  if (!existsSync(join(targetDir, '.githooks', 'pre-commit'))) return
  let current = ''
  try {
    current = runCli('git', ['config', '--get', 'core.hooksPath'], { cwd: targetDir }).stdout.trim()
  } catch (err) {
    if (err instanceof CliError && err.notFound) return
  }
  if (current === '.githooks') return
  if (current !== '') {
    getLogger().warn(
      'init.hookspath_external',
      { current },
      `core.hooksPath is set to '${current}'; arbiter's hooks (.githooks) are NOT active. ` +
        `To use the gate guards, run: git config core.hooksPath .githooks`,
    )
    return
  }
  try {
    runCli('git', ['config', 'core.hooksPath', '.githooks'], { cwd: targetDir })
    log(
      '  ✓ Git hooks activated (core.hooksPath → .githooks) — the gate now guards every commit and push.',
    )
  } catch {
    getLogger().warn(
      'init.hookspath_set_failed',
      {},
      'Could not set core.hooksPath automatically. Activate manually: git config core.hooksPath .githooks',
    )
  }
}

/** Throws if resolvedPath does not start with safeRoot + path separator. */
function assertPathContained(resolvedPath: string, safeRoot: string, rawPath: string): void {
  if (!resolvedPath.startsWith(safeRoot + sep)) {
    throw new Error(`Plugin output path escapes target directory: ${rawPath}`)
  }
}

/**
 * #2035 (TC-5): plugin-declared invariants, collected BEFORE the generators run.
 * Load failures are reported by runPlugins' own E_INIT_PLUGIN_FAILURES path —
 * this collection is best-effort (the module is already loaded at least twice
 * per plugin today: host shape-validation + worker execution).
 */
export async function collectPluginInvariants(
  targetDir: string,
  plugins: string[],
): Promise<Invariant[]> {
  const all: Invariant[] = []
  for (const pkg of plugins) {
    try {
      const plugin = await loadPlugin(pkg, targetDir)
      if (plugin.invariants !== undefined) all.push(...plugin.invariants)
    } catch (err) {
      getLogger().warn(
        'init.plugin_invariants_unavailable',
        { plugin: pkg },
        `Plugin "${pkg}" invariants unavailable: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return all
}

/**
 * #2035 (TC-5): merge plugin-contributed invariants into the ProjectConfig.
 * Config-declared projectInvariants win on id conflict (deterministic
 * precedence: catalog < plugin < config), so a project can override a stack
 * preset's rule without removing the plugin.
 */
export function mergeProjectInvariants(
  config: ProjectConfig,
  pluginInvariants: Invariant[],
): ProjectConfig {
  if (pluginInvariants.length === 0) return config
  const configIds = new Set((config.projectInvariants ?? []).map((inv) => inv.id))
  const pluginOnly = pluginInvariants.filter((inv) => !configIds.has(inv.id))
  return { ...config, projectInvariants: [...(config.projectInvariants ?? []), ...pluginOnly] }
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
          const safe = normalize(relPath)
          if (safe.startsWith('..') || isAbsolute(safe)) {
            throw new Error(`Invalid plugin template path: ${relPath}`)
          }
          return renderFromAbsPath(join(plugin.templateRoot, safe), data)
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
        const resolvedFilePath = resolve(targetDir, file.path)
        assertPathContained(resolvedFilePath, resolve(targetDir), file.path)
        writtenPaths.add(file.path)
        all.push(
          writeFile(resolvedFilePath, file.content, {
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

interface DryRunPreview {
  created: string[]
  modified: string[]
  skipped: string[]
}

/**
 * #2452: the ONE plan an init run executes — the generator specs plus every input the
 * registry resolves them against. Built once, then executed either dry (preview) or wet
 * (the real run). Holding it in a single shape is what makes the preview structurally
 * incapable of drifting from the run, the way `diff` already cannot drift from `update`
 * (#1077).
 */
interface InitGenerationPlan {
  /** Config with plugin-contributed invariants merged in (catalog < plugin < config). */
  mergedConfig: ProjectConfig
  specs: GeneratorSpec[]
  installedSkills: InstalledSkill[]
  plugins: string[]
  prevManifest: Record<string, string>
}

/**
 * Resolve the plan. Read-only: detection, config/manifest reads, and plugin-module
 * loading for their declared invariants — no file is written here, by either caller.
 */
async function buildInitGenerationPlan(
  config: ProjectConfig,
  targetDir: string,
): Promise<InitGenerationPlan> {
  const installedSkills = detectSkillsForPlan(targetDir)
  // #2035 (TC-5): plugin-contributed invariants must reach the generators, so the
  // plugin list + their invariants are collected BEFORE generation and merged into
  // the ProjectConfig (config-declared projectInvariants win on id conflict —
  // deterministic precedence: catalog < plugin < config).
  const storedBefore = loadConfig(targetDir)
  const plugins: string[] = Array.isArray(storedBefore?.plugins) ? storedBefore.plugins : []
  const mergedConfig = mergeProjectInvariants(
    config,
    await collectPluginInvariants(targetDir, plugins),
  )
  return {
    mergedConfig,
    specs: buildRegistry(mergedConfig, installedSkills),
    installedSkills,
    plugins,
    prevManifest: loadGeneratedManifest(targetDir),
  }
}

export interface InitGenerationResult extends InitGenerationPlan {
  results: WriteResult[]
  errors: GeneratorFailure[]
  generatedHashes: Record<string, string>
}

/**
 * Build the plan and execute it. `dryRun: true` resolves the PROSPECTIVE action for
 * every file without touching disk (`writeFile` shares one `resolveWriteAction` between
 * both paths — #1077), so the caller sees exactly what `dryRun: false` would have done.
 *
 * The only input a dry run withholds is `onAdopt`: recording a reversible local override
 * is a write, and a preview must not perform the side effects it is previewing. The
 * adopt PREDICATE is still applied in both modes, so a file the real run would
 * force-adopt is classified the same way in the preview.
 */
export async function executeInitGeneration(args: {
  config: ProjectConfig
  targetDir: string
  dryRun: boolean
  adoptGovernance?: boolean
  onAdopt?: (key: string, priorContent: string, newContent: string) => void
}): Promise<InitGenerationResult> {
  const { config, targetDir, dryRun } = args
  const plan = await buildInitGenerationPlan(config, targetDir)
  beginGenerationSession({
    targetDir,
    prevHashes: plan.prevManifest,
    adoptPredicate: buildAdoptPredicate({ adoptGovernance: args.adoptGovernance === true }),
    ...(dryRun || args.onAdopt === undefined ? {} : { onAdopt: args.onAdopt }),
  })
  const errors: GeneratorFailure[] = []
  let results: WriteResult[]
  let generatedHashes: Record<string, string>
  try {
    results = runGeneratorsFromRegistry(plan.specs, errors, { dryRun })
  } finally {
    generatedHashes = endGenerationSession()
  }
  return { ...plan, results, errors, generatedHashes }
}

/**
 * #2452: the `--dry-run` preview is a PROJECTION of the plan above, never a parallel
 * hand-maintained list. It previously came from `buildMigrationPlan` — a ~8-entry stub
 * of directory blobs that named none of the real writes and none of the real
 * skip-if-exists preserves, so a brownfield adopter evaluating whether arbiter was safe
 * to run saw a preview bearing no relation to the run.
 *
 * `not-applicable` results are dropped for the same reason `printResults` drops them
 * (#1491): they were deliberately never emitted, so listing them as "already exists"
 * would be a false claim.
 */
export async function computeDryRunPreview(config: ProjectConfig): Promise<DryRunPreview> {
  const { results } = await executeInitGeneration({
    config,
    targetDir: config.targetDir,
    dryRun: true,
  })
  const preview: DryRunPreview = { created: [], modified: [], skipped: [] }
  for (const result of results) {
    if (result.reason === 'not-applicable') continue
    const rel = relative(config.targetDir, result.path)
    if (result.action === 'created') preview.created.push(rel)
    else if (result.action === 'skipped') preview.skipped.push(rel)
    else preview.modified.push(rel)
  }
  return preview
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
        if (existsSync(result.path)) unlinkTranslated(result.path)
      } catch (err) {
        rollbackErrors.push(`Could not remove ${result.path}: ${errMsg(err)}`)
      }
    } else if (result.action === 'backed-up-and-replaced') {
      const backup = `${result.path}.arbiter-backup`
      try {
        if (existsSync(backup)) {
          copyFileTranslated(backup, result.path)
          unlinkTranslated(backup)
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

export function maybeCaptureBaseline(
  config: ProjectConfig,
  targetDir: string,
  brownfield: boolean,
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun',
): void {
  const fatal = levelAtLeast(config.governanceLevel, 'L3') && config.enableDebtGates
  if (!shouldCaptureBaseline(fatal, brownfield, config.enableDebtGates)) return

  // The JS/TS collectors are npx-based. Before dependencies are installed they
  // cannot measure the project, so attempting capture would produce a missing
  // baseline (or, historically, a phantom zero baseline). This is a deferral,
  // not a fatal capture failure: make the remediation explicit and leave the
  // absent baseline discoverable to the user and later debt gate.
  if (typescriptDependenciesAreMissing(config, targetDir)) {
    reportMissingTypescriptDependencies(config, packageManager)
    return
  }

  // #1732 Step 3: floor check (not `=== 'L3'`) — the generated debt-report.mjs
  // is fail-closed at `isL3Plus` (L3 and L4), so init must fatally capture the
  // baseline at L4 too; a hand-rolled `=== 'L3'` literal silently skipped it.
  runBrownfieldCapture(targetDir, fatal ? { fatal: true } : undefined)
}

function shouldCaptureBaseline(
  fatal: boolean,
  brownfield: boolean,
  debtGatesEnabled: boolean,
): boolean {
  return fatal || (brownfield && debtGatesEnabled)
}

function typescriptDependenciesAreMissing(config: ProjectConfig, targetDir: string): boolean {
  return config.language === 'typescript' && !existsSync(join(targetDir, 'node_modules'))
}

function reportMissingTypescriptDependencies(
  config: ProjectConfig,
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun',
): void {
  const installCommand = `${packageManager ?? config.packageManager ?? 'npm'} install`
  process.stdout.write(
    `  Debt baseline NOT captured: node_modules is absent, so the collectors cannot measure this project yet. Run ${installCommand}, then: node scripts/capture-debt-baseline.mjs\n`,
  )
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

/**
 * Post-write presence guard (M1/#1491). A generator result with action
 * `created`/`replaced`/`backed-up-and-replaced` asserts a file was written; if it
 * is not on disk the emission silently lost content. `skipped` files (including
 * `reason: 'not-applicable'` deliberate non-emissions and skipIfExists preserves)
 * are exempt — they are not expected to be (re)written.
 */
export function assertEmittedFilesPresent(results: WriteResult[]): void {
  const missing = results
    .filter((r) => r.action !== 'skipped' && r.action !== 'dry-run')
    .filter((r) => !existsSync(r.path))
    .map((r) => r.path)
  if (missing.length > 0) {
    throw new Error(
      `Emission integrity check failed — ${missing.length} file(s) reported written but ` +
        `not found on disk:\n${missing.map((p) => `    - ${p}`).join('\n')}\n` +
        `This is a generator bug (content silently dropped). Re-run init or file an issue.`,
    )
  }
}

export function printResults(results: WriteResult[], targetDir: string): void {
  for (const result of results) {
    // not-applicable files were deliberately NOT emitted — do not list them as
    // "skipped — already exists" (false claim on a clean project, M1/#1491).
    if (result.reason === 'not-applicable') continue
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

export async function displayDryRunPreview(config: ProjectConfig): Promise<void> {
  const preview = await computeDryRunPreview(config)
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
