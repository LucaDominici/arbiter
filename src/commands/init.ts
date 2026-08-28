// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): init.ts split into src/commands/init/*.ts by
// responsibility (was ~1734 LOC / 6 mixed concerns). This file stays the thin
// orchestrator (runInit + its immediate guards) and the public barrel — every
// symbol previously exported from here is re-exported below so no external
// import path changes. Pure extraction, no behavior change.
import { resolve, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, ArbiterError } from '../utils/errors.js'
import { t } from '../i18n/index.js'
import { jsonOutput } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { detectGitInfo, detectAdverseGitState } from '../detectors/git.js'
import { detectExisting, isBrownfield } from '../detectors/existing.js'
import { loadConfig } from '../utils/config.js'
import { slugifyProjectName, resolveProjectName } from '../config/resolve-project-name.js'
import { isWindows, isWSL2 } from '../utils/platform.js'
import { runCli } from '../utils/run-cli.js'
import type { Language } from '../wizard/types.js'
import type { InitOptions } from './init/types.js'
import { showTelemetryBannerIfFirstRun } from '../utils/first-run.js'
import { loadRecipe } from '../recipes/loader.js'
import type { Recipe } from '../recipes/schema.js'
import {
  resolveConfig,
  applyPresetOptions,
  applyAdoptionTier,
  resolveAdoptionTier,
  detectProjectForInit,
} from './init/resolve-config.js'
import { buildArbiterConfig } from './init/build-arbiter-config.js'
import {
  runGenerators,
  runPlugins,
  computeDryRunPreview,
  displayDryRunPreview,
  rollbackGeneration,
  assertEmittedFilesPresent,
  printResults,
  generateAndFinalize,
} from './init/generate.js'
import { ensureDir } from '../utils/fs.js'
import { runGithubSetup } from './init/github-setup.js'
import { verifyToolchainBeforeWrite } from './init/toolchain.js'
import {
  checkL3MaturityGates,
  checkCollaborationCoherenceGate,
  deriveWorkflowCapabilities,
  deriveL3MaturityChecks,
  type L3MaturityCapability,
} from './init/maturity-gates.js'

export {
  runGenerators,
  runPlugins,
  computeDryRunPreview,
  rollbackGeneration,
  assertEmittedFilesPresent,
  printResults,
  runGithubSetup,
  buildArbiterConfig,
  resolveAdoptionTier,
  deriveWorkflowCapabilities,
  deriveL3MaturityChecks,
}
export type { L3MaturityCapability, InitOptions }

function assertNotNativeWindows(): void {
  if (isWindows() && !isWSL2()) {
    throw ArbiterError.fromKey('E_INIT_WIN32', 'errors.E_INIT_WIN32')
  }
}

function assertKnownLanguage(language: Language): void {
  if (language !== 'unknown') return
  throw ArbiterError.fromKey('E_INIT_UNKNOWN_LANGUAGE', 'errors.E_INIT_UNKNOWN_LANGUAGE')
}

// Run git guards BEFORE any FS mutation (#1039 fix): creating .arbiter/ would
// appear as an untracked file, making the dirty-tree check a false positive.
function runPreMutationGitGuards(targetDir: string, options: InitOptions): void {
  const gitInfo = detectGitInfo(targetDir)
  if (!gitInfo.isGitRepo) return
  guardAdverseGitState(targetDir, options.force)
  if (options.brownfield) {
    guardBrownfieldDirtyTree(targetDir, options.force)
  }
}

// #1978: slugifyProjectName + resolveProjectName now live in
// src/config/resolve-project-name.ts (config-boundary normalization, alongside
// the precedence chain that FEEDS it). Re-exported here so the existing
// `from './init.js'` import sites (explain.ts, update.ts, diff.ts and their
// tests) are unaffected.
export { slugifyProjectName, resolveProjectName }

export async function runInit(options: InitOptions): Promise<void> {
  const targetDir = resolve(options.dir ?? process.cwd())
  // #1978: consult the precedence chain (stored name → package.json → git
  // remote → cwd basename) rather than the cwd basename directly, so a
  // brownfield re-init from a worktree dir keeps the durable name. A missing
  // arbiter.json (fresh init) returns null and resolveProjectName falls
  // through to the next source.
  const projectName = slugifyProjectName(resolveProjectName(targetDir, loadConfig(targetDir)))
  const log: (msg: string) => void = options.json
    ? (): void => {}
    : (msg: string): void => {
        process.stdout.write(`${msg}\n`)
      }

  // --json requires --yes: interactive wizard reads stdin which is incompatible with
  // machine-readable output. Fail fast with a clear JSON error.
  if (options.json && !options.yes) {
    jsonOutput(
      'init',
      'error',
      {},
      ['--json requires --yes (interactive wizard is incompatible with machine-readable output)'],
      { errorClass: 'config' },
    )
    process.exit(78)
    return
  }

  // #1447 (ADR-098): `--tier` is the progressive-adoption on-ramp; desugar it into the
  // existing `--level` + `--brownfield` settings so the rest of the flow is tier-agnostic.
  applyAdoptionTier(options)

  assertNotNativeWindows()
  runPreMutationGitGuards(targetDir, options)

  verifyToolchainBeforeWrite(targetDir, options)

  ensureDir(join(targetDir, '.arbiter'))
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    showTelemetryBannerIfFirstRun(undefined, options.quiet)

    log('\n  Arbiter — AI Development Governance Framework\n')
    log('  Detecting project...')

    const detection = detectProjectForInit(targetDir, options, log)
    if (!options.json) logExistingDetections(detection.existing)

    if (detection.gitInfo.isGitRepo) {
      guardAdverseGitState(targetDir, options.force)
    }

    const recipe = await loadRecipeFromOptions(options, log)

    const config = await resolveConfig({
      options,
      recipe,
      targetDir,
      projectName,
      language: detection.language,
      framework: detection.framework,
      buildCmds: detection.buildCmds,
      gitInfo: detection.gitInfo,
      existing: detection.existing,
      githubAccess: detection.githubAccess,
      externalModelAccess: detection.externalModelAccess,
      lanes: detection.lanes,
      languageLocked: detection.languageLocked,
      languageSource: detection.languageSource,
    })
    if (config === null) return

    applyPresetOptions(options, config)
    assertKnownLanguage(config.language)

    if (options.dryRun) {
      displayDryRunPreview(config)
      return
    }

    checkL3MaturityGates(config)
    checkCollaborationCoherenceGate(config)
    await generateAndFinalize({
      config,
      targetDir,
      initOptions: options,
      log,
      brownfieldDetected: isBrownfield(detection.existing),
      ...(detection.packageManager ? { packageManager: detection.packageManager.name } : {}),
    })
  } finally {
    await lock.release()
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
    if (!force) throw ArbiterError.fromKey('E_INIT_DIRTY_TREE', 'errors.E_INIT_DIRTY_TREE')
    getLogger().warn('init.dirty_tree', {}, t('cli.init.dirty_tree_warn'))
  } catch (err) {
    if (err instanceof UserFacingError) throw err
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'EACCES') return // git binary not found
    throw err
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
