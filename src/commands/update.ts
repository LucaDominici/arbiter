// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, FatalError } from '../utils/errors.js'
import { beginGenerationSession, endGenerationSession, type WriteResult } from '../utils/fs.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../state/generated-manifest.js'
import { t } from '../i18n/index.js'
import { jsonOutput, statusToExitCode, type JsonOutputOpts } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { detectAdverseGitState } from '../detectors/git.js'
import { detectGithubAccess } from '../detectors/github.js'
import { resolveAxisFields } from '../detectors/axis.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { loadConfig, loadSnapshot, saveConfigAndSnapshot } from '../utils/config.js'
import { runGithubSetup, printResults, runPlugins } from './init.js'
import { diffConfig, impactedGenerators } from '../config/diff.js'
import { validateConfig } from '../config/schema.js'
import { resolveProjectConfig } from '../config/resolve-project-config.js'
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
  type GeneratorFailure,
} from '../generators/registry.js'
import type { GeneratorKey } from '../config/diff.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { ArbiterConfigV2 } from '../utils/config.js'

export interface UpdateOptions {
  dir: string | undefined
  github: boolean
  json?: boolean | undefined
  /** Override adverse git state check (detached HEAD, rebase, merge, etc.). Emits warning then continues. */
  force?: boolean
}

export interface UpdateResult {
  keysRun: Set<GeneratorKey | '*'> | null
}

function printStats(results: WriteResult[]): void {
  const created = results.filter((r) => r.action === 'created').length
  const replaced = results.filter((r) => r.action === 'backed-up-and-replaced').length
  const skipped = results.filter((r) => r.action === 'skipped' || r.action === 'dry-run').length
  // #1344: withheld files ARE skipped (preserved), but surface them separately so
  // the operator sees template fixes that did not land, not just a "skipped" lump.
  const withheld = results.filter((r) => r.withheld === true).length
  process.stdout.write(`${t('cli.update.done', { created, replaced, skipped, withheld })}\n`)
}

function selectAndRun(
  specs: ReturnType<typeof buildRegistry>,
  snapshot: ArbiterConfigV2 | null,
  stored: ArbiterConfigV2,
): {
  results: WriteResult[]
  keysRun: Set<GeneratorKey | '*'> | null
  errors: GeneratorFailure[]
} {
  const errors: GeneratorFailure[] = []
  if (!snapshot) {
    return {
      results: runGeneratorsFromRegistry(specs, errors, { dryRun: false }),
      keysRun: null,
      errors,
    }
  }
  const diff = diffConfig(snapshot, stored)
  if (diff.paths.length === 0) {
    process.stdout.write(`${t('cli.update.no_config_changes')}\n`)
    return {
      results: runGeneratorsFromRegistry(specs, errors, { dryRun: false }),
      keysRun: null,
      errors,
    }
  }
  const keys = impactedGenerators(diff)
  if (keys.has('*') || keys.size === 0) {
    const reason = keys.size === 0 ? 'Unknown config change' : 'Governance/axis change'
    process.stdout.write(`${t('cli.update.reason_regen', { reason })}\n`)
    return {
      results: runGeneratorsFromRegistry(specs, errors, { dryRun: false }),
      keysRun: keys,
      errors,
    }
  }
  process.stdout.write(`${t('cli.update.selective', { count: keys.size })}\n`)
  return {
    results: runGeneratorsSelective(specs, keys, errors, { dryRun: false }),
    keysRun: keys,
    errors,
  }
}

/**
 * Run the generator registry bracketed by a #1328 generation session: load the
 * prev manifest, make `writeFile` hash-aware (pristine skipIfExists files are
 * rewritten to propagate template fixes; user-modified ones are preserved +
 * warned), then persist the merged manifest. Persistence happens HERE — before
 * `saveConfigAndSnapshot`/`runPlugins` — so `arbiter.json`/`.arbiter-generated.json`
 * and plugin-written files never become manifest keys (A1/A6).
 */
function selectAndRunWithManifest(
  specs: ReturnType<typeof buildRegistry>,
  snapshot: ArbiterConfigV2 | null,
  stored: ArbiterConfigV2,
  targetDir: string,
): ReturnType<typeof selectAndRun> {
  const prevManifest = loadGeneratedManifest(targetDir)
  beginGenerationSession({ targetDir, prevHashes: prevManifest })
  const out = selectAndRun(specs, snapshot, stored)
  const generatedHashes = endGenerationSession()
  saveGeneratedManifest(targetDir, { ...prevManifest, ...generatedHashes })
  return out
}

/**
 * Build the to-be-persisted config from the stored config + freshly resolved axis
 * fields. #1317: the DERIVED databaseEngine is threaded in so saveConfigAndSnapshot
 * does not drop it every update (which would leave the diff engine-change detection
 * inert with snapshot + nextConfig both carrying the stale `...stored`).
 */
function buildNextConfig(
  stored: ArbiterConfigV2,
  axisFields: ReturnType<typeof resolveAxisFields>,
  language: ProjectConfig['language'],
  needsMigration: boolean,
): ArbiterConfigV2 {
  const {
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    databaseEngine,
    hasPublicApi,
    contractType,
    lanes,
  } = axisFields
  return {
    ...stored,
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    databaseEngine,
    hasPublicApi,
    contractType,
    language,
    ...(lanes.length > 0 && { lanes }),
    ...(needsMigration && { collaborationMode: 'trunk-solo' }),
  }
}

function detectProjectInfo(
  targetDir: string,
  projectName: string,
  stored: ArbiterConfigV2,
  options: UpdateOptions,
  log: (msg: string) => void,
): {
  config: ProjectConfig
  specs: ReturnType<typeof buildRegistry>
  useGitHub: boolean
  axisFields: ReturnType<typeof resolveAxisFields>
} {
  log('  Detecting project...')
  const arbGhEnv = process.env['ARBITER_GITHUB']
  const envGitHub = arbGhEnv === '1'
  if (arbGhEnv !== undefined && !envGitHub) {
    process.stderr.write(
      `Warning: ARBITER_GITHUB=${arbGhEnv} is not '1' — only ARBITER_GITHUB=1 activates GitHub API calls. Ignored.\n`,
    )
  }
  const useGitHub = options.github || envGitHub ? detectGithubAccess().authenticated : false

  // Shared resolver: builds the SAME ProjectConfig as `diff` (registry-dryRun)
  // so the two commands cannot drift on config either (#1077 secondary drift).
  const { config } = resolveProjectConfig(targetDir, projectName, stored, useGitHub)
  const { language, framework } = config
  log(`  ├── Language: ${language}${framework ? ` / ${framework}` : ''}`)
  log(`  ├── Config: tools=[${stored.tools.join(',')}] level=${stored.governanceLevel}`)

  const axisFields = resolveAxisFields(stored, targetDir, language, framework)
  const claudeHome = process.env['HOME'] ? `${process.env['HOME']}/.claude` : ''
  const installedSkills = detectInstalledSkills({ targetDir, claudeHome })
  const specs = buildRegistry(config, installedSkills)
  return { config, specs, useGitHub, axisFields }
}

function handlePluginError(err: unknown, json: boolean | undefined): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (json) {
    jsonOutput('update', 'error', {}, [msg], { errorClass: 'fatal' })
    process.exit(2)
  }
  throw new FatalError('E_PLUGIN_FATAL', msg)
}

interface UpdateSummary extends Record<string, unknown> {
  created: number
  updated: number
  skipped: number
  /** #1344: skipIfExists files whose template fix was withheld (user-modified). */
  withheld: number
}

/**
 * Surface generator failures and backend warnings via the canonical 0/1/2 exit-
 * code convention (#483, INV-53). Extracted from {@link runUpdate} to keep that
 * function within the lint budget (max-lines-per-function 100, complexity 15).
 */
function emitUpdateOutcome(
  options: UpdateOptions,
  summary: UpdateSummary,
  generatorErrors: GeneratorFailure[],
  backendWarnings: string[],
): void {
  const generatorErrorLines = generatorErrors.map((e) => `${e.key}: ${e.message}`)
  if (options.json) {
    const status =
      generatorErrorLines.length > 0 ? 'error' : backendWarnings.length > 0 ? 'warning' : 'ok'
    const jsonOpts: JsonOutputOpts = {}
    if (backendWarnings.length > 0) jsonOpts.warnings = backendWarnings
    if (status === 'error') jsonOpts.errorClass = 'fatal'
    else if (status === 'warning') jsonOpts.errorClass = 'recoverable'
    jsonOutput(
      'update',
      status,
      summary,
      generatorErrorLines.length > 0 ? generatorErrorLines : undefined,
      status !== 'ok' || backendWarnings.length > 0 ? jsonOpts : undefined,
    )
    if (status !== 'ok') process.exit(statusToExitCode(status))
    return
  }
  if (generatorErrorLines.length > 0) {
    process.stdout.write(
      `\n  Generator failures (${generatorErrorLines.length}):\n${generatorErrorLines
        .map((line) => `    - ${line}`)
        .join('\n')}\n`,
    )
    if (backendWarnings.length > 0) {
      process.stderr.write(
        `\n  GitHub warnings (${backendWarnings.length}):\n${backendWarnings
          .map((w) => `    - ${w}`)
          .join('\n')}\n`,
      )
    }
    process.exit(statusToExitCode('error'))
  }
  if (backendWarnings.length > 0) {
    process.stderr.write(
      `\n  GitHub warnings (${backendWarnings.length}):\n${backendWarnings
        .map((w) => `    - ${w}`)
        .join('\n')}\n`,
    )
    process.exit(statusToExitCode('warning'))
  }
  process.stdout.write(`${t('cli.update.verify_hint')}\n`)
}

function handleAdverseState(
  adverseState: ReturnType<typeof detectAdverseGitState>,
  force: boolean | undefined,
): void {
  if (!adverseState) return
  const warning = `\n  Warning: ${adverseState.message}\n  ${adverseState.suggestedFix}\n`
  if (!force) {
    throw new UserFacingError(
      `${adverseState.message}\n${adverseState.suggestedFix}\n${t('cli.shared.force_override_hint')}`,
    )
  }
  getLogger().warn(
    'update.adverse_git_state',
    { message: adverseState.message, suggested_fix: adverseState.suggestedFix },
    warning,
  )
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const targetDir = resolve(options.dir ?? process.cwd())
  const projectName = basename(targetDir)
  const log: (msg: string) => void = options.json
    ? (): void => {}
    : (msg: string): void => {
        process.stdout.write(`${msg}\n`)
      }

  log('\n  Arbiter — update\n')

  mkdirSync(join(targetDir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    const stored = loadConfig(targetDir)
    if (!stored) {
      if (options.json) {
        jsonOutput('update', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'], {
          errorClass: 'config',
        })
      } else {
        log('  No arbiter.json found. Run `arbiter init` first.\n')
      }
      process.exit(78)
      return { keysRun: null }
    }

    handleAdverseState(detectAdverseGitState(targetDir), options.force)

    const { config, specs, axisFields } = detectProjectInfo(
      targetDir,
      projectName,
      stored,
      options,
      log,
    )

    const snapshot = loadSnapshot(targetDir)
    log('\n  Updating...')

    // ADR-051: migrate soloDevMode → collaborationMode on first update after upgrade.
    const needsMigration = stored.features.soloDevMode === true && !stored.collaborationMode
    if (needsMigration) {
      log("  Migrating soloDevMode=true → collaborationMode='trunk-solo' (ADR-051)")
    }
    const nextConfig = buildNextConfig(stored, axisFields, config.language, needsMigration)

    // #1328: registry run bracketed by a generation session (manifest persisted
    // BEFORE saveConfigAndSnapshot/runPlugins — A1/A6). See selectAndRunWithManifest.
    const {
      results,
      keysRun,
      errors: generatorErrors,
    } = selectAndRunWithManifest(specs, snapshot, nextConfig, targetDir)
    const pluginResults = await runPlugins(
      targetDir,
      Array.isArray(stored.plugins) ? stored.plugins : [],
      stored,
    ).catch((err: unknown) => handlePluginError(err, options.json))
    results.push(...pluginResults)

    if (!options.json) {
      printResults(results, targetDir)
      printStats(results)
    }

    const backendResult = runGithubSetup(config, log)

    const validation = validateConfig(nextConfig)
    if (!validation.ok) {
      if (options.json) {
        jsonOutput('update', 'error', {}, [
          `Config invalid after update: ${validation.errors.join('; ')}`,
        ])
      } else {
        process.stderr.write(
          `${t('cli.update.config_invalid', { errors: validation.errors.join('; ') })}\n`,
        )
      }
      process.exit(2)
    }

    saveConfigAndSnapshot(targetDir, validation.config)

    const summary: UpdateSummary = {
      created: results.filter((r) => r.action === 'created').length,
      updated: results.filter((r) => r.action === 'backed-up-and-replaced').length,
      skipped: results.filter((r) => r.action === 'skipped' || r.action === 'dry-run').length,
      withheld: results.filter((r) => r.withheld === true).length,
    }
    emitUpdateOutcome(options, summary, generatorErrors, backendResult.warnings)

    return { keysRun }
  } finally {
    // A3 leak-guard: clear any session left active by a throw/early-exit so it can
    // never corrupt the next in-process command (tests, batch mode). Idempotent.
    endGenerationSession()
    await lock.release()
  }
}
