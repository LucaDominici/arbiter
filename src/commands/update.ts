// SPDX-License-Identifier: Apache-2.0
import { resolve, basename } from 'node:path'
import type { WriteResult } from '../utils/fs.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { detectLanguage } from '../detectors/language.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework } from '../detectors/framework.js'
import { detectGitInfo } from '../detectors/git.js'
import { detectExisting } from '../detectors/existing.js'
import { detectGithubAccess } from '../detectors/github.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { resolveAxisFields } from '../detectors/axis.js'
import { loadConfig, loadSnapshot, saveConfig, saveSnapshot } from '../utils/config.js'
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
}

export interface UpdateResult {
  keysRun: Set<GeneratorKey | '*'> | null
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
  }
}

function printStats(results: WriteResult[]): void {
  const created = results.filter((r) => r.action === 'created').length
  const replaced = results.filter((r) => r.action === 'backed-up-and-replaced').length
  const skipped = results.filter((r) => r.action === 'skipped').length
  console.log(`\n  Done! ${created} created, ${replaced} updated, ${skipped} skipped.`)
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
    return { results: runGeneratorsFromRegistry(specs, errors), keysRun: null, errors }
  }
  const diff = diffConfig(snapshot, stored)
  if (diff.paths.length === 0) {
    console.log('  No config changes detected — re-running to pick up template updates.')
    return { results: runGeneratorsFromRegistry(specs, errors), keysRun: null, errors }
  }
  const keys = impactedGenerators(diff)
  if (keys.has('*') || keys.size === 0) {
    const reason = keys.size === 0 ? 'Unknown config change' : 'Governance/axis change'
    console.log(`  ${reason} detected — full regeneration.`)
    return { results: runGeneratorsFromRegistry(specs, errors), keysRun: keys, errors }
  }
  console.log(`  Selective update: ${keys.size} generator group(s).`)
  return { results: runGeneratorsSelective(specs, keys, errors), keysRun: keys, errors }
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
  const useGitHub = options.github
    ? githubAccess.authenticated
    : stored.useGitHub && githubAccess.authenticated
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
  const specs = buildRegistry(config)
  return { config, specs, useGitHub, axisFields }
}

function handlePluginError(err: unknown, json: boolean | undefined): never {
  const msg = err instanceof Error ? err.message : String(err)
  if (json) {
    jsonOutput('update', 'error', {}, [msg])
    process.exit(1)
  }
  throw err instanceof Error ? err : new Error(msg)
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
      backendWarnings.length > 0 ? backendWarnings : undefined,
    )
    if (status !== 'ok') process.exit(statusToExitCode(status))
    return
  }
  if (generatorErrorLines.length > 0) {
    console.log(
      `\n  Generator failures (${generatorErrorLines.length}):\n${generatorErrorLines
        .map((line) => `    - ${line}`)
        .join('\n')}\n`,
    )
    process.exit(statusToExitCode('error'))
  }
  console.log(`\n  Run: node scripts/check-all.mjs L1  to verify\n`)
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const targetDir = resolve(options.dir ?? process.cwd())
  const projectName = basename(targetDir)
  const log: (msg: string) => void = options.json
    ? (): void => {}
    : (msg: string): void => {
        console.log(msg)
      }

  log('\n  Arbiter — update\n')

  const stored = loadConfig(targetDir)
  if (!stored) {
    if (options.json) {
      jsonOutput('update', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
    } else {
      log('  No arbiter.json found. Run `arbiter init` first.\n')
    }
    process.exit(1)
    return { keysRun: null }
  }

  const { config, specs, useGitHub, axisFields } = detectProjectInfo(
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
    useGitHub,
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
      console.error(`  [arbiter] Config invalid after update: ${validation.errors.join('; ')}`)
    }
    process.exit(1)
  }

  saveConfig(targetDir, validation.config)
  saveSnapshot(targetDir, validation.config)

  const summary: UpdateSummary = {
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'backed-up-and-replaced').length,
    skipped: results.filter((r) => r.action === 'skipped').length,
  }
  emitUpdateOutcome(options, summary, generatorErrors, backendResult.warnings)

  return { keysRun }
}
