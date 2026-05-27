// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, FatalError } from '../utils/errors.js'
import type { WriteResult } from '../utils/fs.js'
import { t } from '../i18n/index.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { detectLanguage } from '../detectors/language.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework } from '../detectors/framework.js'
import { detectGitInfo, detectAdverseGitState } from '../detectors/git.js'
import { detectExisting } from '../detectors/existing.js'
import { detectGithubAccess } from '../detectors/github.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { resolveAxisFields } from '../detectors/axis.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { loadConfig, loadSnapshot, saveConfigAndSnapshot } from '../utils/config.js'
import { runGithubSetup, printResults, runPlugins } from './init.js'
import { presetToTiers, defaultPresetForLevel } from '../invariants/filter.js'
import { diffConfig, impactedGenerators } from '../config/diff.js'
import { validateConfig } from '../config/schema.js'
import {
  buildRegistry,
  runGeneratorsFromRegistry,
  runGeneratorsSelective,
  type GeneratorFailure,
} from '../generators/registry.js'
import type { GeneratorKey } from '../config/diff.js'
import type { ProjectConfig, Lane } from '../wizard/types.js'
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

function resolveExtendedInvariants(stored: ArbiterConfigV2): boolean {
  return stored.governance?.invariants_catalog === 'extended'
}

function v2ToProjectConfig(
  stored: ArbiterConfigV2,
  detectorFields: {
    targetDir: string
    projectName: string
    language: ReturnType<typeof detectLanguage>
    framework: string | null
    buildTool: string
    buildCommand: string
    testCommand: string
    lintCommand: string
    formatCommand: string
    useGitHub: boolean
    permitGitHub: boolean
    githubOwner: string | null
    githubRepo: string | null
    existing: ProjectConfig['existing']
    languageHooks: ProjectConfig['languageHooks']
    archetype: ProjectConfig['archetype']
    architectureStyle: ProjectConfig['architectureStyle']
    isMultiTenant: boolean
    hasDatabase: boolean
    hasPublicApi: boolean
    contractType: ProjectConfig['contractType']
    lanes: Lane[]
  },
): ProjectConfig {
  const level = stored.governanceLevel
  return {
    ...detectorFields,
    projectName: detectorFields.projectName,
    description: `${detectorFields.projectName} project`,
    tools: stored.tools,
    governanceLevel: level,
    enableDebtGates: stored.features.debtGates,
    enableSuppressions: stored.features.suppressions,
    enableSecurityScanning: stored.features.securityScanning,
    enableMutationTesting: stored.features.mutationTesting,
    enableContractTesting: stored.features.contractTesting,
    enableEvidenceHarness: stored.features.evidenceHarness,
    enableSelfValidationHarness: stored.features.selfValidationHarness ?? true,
    enableSoloDevMode: stored.features.soloDevMode ?? false,
    invariantTiers: stored.invariantTiers ?? presetToTiers(defaultPresetForLevel(level)),
    acceptBetaTools: stored.acceptBetaTools ?? false,
    ...(stored.evidenceRetention !== undefined && {
      evidenceRetention: stored.evidenceRetention,
    }),
    ...(stored.thresholdProfile !== undefined && {
      thresholdProfile: stored.thresholdProfile,
    }),
    ...(stored.strictnessTier !== undefined && {
      strictnessTier: stored.strictnessTier,
    }),
    contractType: detectorFields.contractType,
    ...(stored.basePackage !== undefined ? { basePackage: stored.basePackage } : {}),
    thresholds: stored.thresholds,
    lanes: detectorFields.lanes,
    ...(stored.taskTiers !== undefined && { taskTiers: stored.taskTiers }),
    includeExtendedInvariants: resolveExtendedInvariants(stored),
  }
}

function printStats(results: WriteResult[]): void {
  const created = results.filter((r) => r.action === 'created').length
  const replaced = results.filter((r) => r.action === 'backed-up-and-replaced').length
  const skipped = results.filter((r) => r.action === 'skipped' || r.action === 'dry-run').length
  process.stdout.write(`${t('cli.update.done', { created, replaced, skipped })}\n`)
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

function detectProjectInfo(
  targetDir: string,
  projectName: string,
  stored: ArbiterConfigV2,
  options: UpdateOptions,
  log: (msg: string) => void,
): {
  config: ReturnType<typeof v2ToProjectConfig>
  specs: ReturnType<typeof buildRegistry>
  useGitHub: boolean
  axisFields: ReturnType<typeof resolveAxisFields>
} {
  log('  Detecting project...')
  const language = detectLanguage(targetDir)
  const framework = detectFramework(targetDir, language)
  const buildCmds = detectBuildCommands(targetDir, language)
  const gitInfo = detectGitInfo(targetDir)
  const existing = detectExisting(targetDir)
  const githubAccess = detectGithubAccess()
  log(`  ├── Language: ${language}${framework ? ` / ${framework}` : ''}`)
  log(`  ├── Config: tools=[${stored.tools.join(',')}] level=${stored.governanceLevel}`)
  const arbGhEnv = process.env['ARBITER_GITHUB']
  const envGitHub = arbGhEnv === '1'
  if (arbGhEnv !== undefined && !envGitHub) {
    process.stderr.write(
      `Warning: ARBITER_GITHUB=${arbGhEnv} is not '1' — only ARBITER_GITHUB=1 activates GitHub API calls. Ignored.\n`,
    )
  }
  const useGitHub = options.github || envGitHub ? githubAccess.authenticated : false
  const permitGitHub = stored.permitGitHub ?? stored.useGitHub ?? false
  const axisFields = resolveAxisFields(stored, targetDir, language, framework)
  const {
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
    lanes,
  } = axisFields
  const detectorFields = {
    targetDir,
    projectName,
    language,
    framework,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    useGitHub,
    permitGitHub,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    archetype,
    architectureStyle,
    isMultiTenant,
    hasDatabase,
    hasPublicApi,
    contractType,
    lanes,
  }
  const config = v2ToProjectConfig(stored, detectorFields)
  const claudeHome = process.env['HOME'] ? `${process.env['HOME']}/.claude` : ''
  const installedSkills = detectInstalledSkills({ targetDir, claudeHome })
  const specs = buildRegistry(config, installedSkills)
  return { config, specs, useGitHub, axisFields }
}

function handlePluginError(err: unknown, json: boolean | undefined): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (json) {
    jsonOutput('update', 'error', {}, [msg])
    process.exit(2)
  }
  throw new FatalError('E_GH_FATAL', msg)
}

interface UpdateSummary extends Record<string, unknown> {
  created: number
  updated: number
  skipped: number
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
    jsonOutput(
      'update',
      status,
      summary,
      generatorErrorLines.length > 0 ? generatorErrorLines : undefined,
      backendWarnings.length > 0 ? { warnings: backendWarnings } : undefined,
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
    const {
      archetype,
      architectureStyle,
      isMultiTenant,
      hasDatabase,
      hasPublicApi,
      contractType,
      lanes,
    } = axisFields

    const snapshot = loadSnapshot(targetDir)
    log('\n  Updating...')

    const nextConfig: ArbiterConfigV2 = {
      ...stored,
      archetype,
      architectureStyle,
      isMultiTenant,
      hasDatabase,
      hasPublicApi,
      contractType,
      ...(lanes.length > 0 && { lanes }),
    }

    const { results, keysRun, errors: generatorErrors } = selectAndRun(specs, snapshot, nextConfig)
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
    }
    emitUpdateOutcome(options, summary, generatorErrors, backendResult.warnings)

    return { keysRun }
  } finally {
    await lock.release()
  }
}
