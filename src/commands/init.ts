// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): init.ts split into src/commands/init/*.ts by
// responsibility (was ~1734 LOC / 6 mixed concerns). This file stays the thin
// orchestrator (runInit + its immediate guards) and the public barrel — every
// symbol previously exported from here is re-exported below so no external
// import path changes. Pure extraction, no behavior change.
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, ArbiterError } from '../utils/errors.js'
import { t } from '../i18n/index.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { runProbes } from '../compatibility/probe.js'
import { formatText } from '../compatibility/report.js'
import { detectLanguageWithSource } from '../detectors/language.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework } from '../detectors/framework.js'
import { detectGitInfo, detectAdverseGitState } from '../detectors/git.js'
import { detectExisting } from '../detectors/existing.js'
import { detectGithubAccess } from '../detectors/github.js'
import { detectLanes } from '../detectors/lanes.js'
import { saveConfig, loadConfig } from '../utils/config.js'
import { slugifyProjectName, resolveProjectName } from '../config/resolve-project-name.js'
import { isWindows, isWSL2 } from '../utils/platform.js'
import { writeFile, beginGenerationSession, endGenerationSession } from '../utils/fs.js'
import type { WriteResult } from '../utils/fs.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../state/generated-manifest.js'
import { runCli, CliError } from '../utils/run-cli.js'
import type { ProjectConfig, Language } from '../wizard/types.js'
import type { InitOptions } from './init/types.js'
import { showTelemetryBannerIfFirstRun } from '../utils/first-run.js'
import { loadRecipe } from '../recipes/loader.js'
import type { Recipe } from '../recipes/schema.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { computeSkipReport, excludeOwnEmittedSkills } from '../generators/skills.js'
import {
  resolveConfig,
  applyPresetOptions,
  applyAdoptionTier,
  parseLanguage,
  formatLangHint,
  resolveAdoptionTier,
} from './init/resolve-config.js'
import { buildArbiterConfig } from './init/build-arbiter-config.js'
import {
  runGenerators,
  runGeneratorsWithErrors,
  runPlugins,
  computeDryRunPreview,
  displayDryRunPreview,
  rollbackGeneration,
  maybeCaptureBaseline,
  assertEmittedFilesPresent,
  printResults,
} from './init/generate.js'
import { runGithubSetup, runBackendSetup } from './init/github-setup.js'
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

  if (!options.noVerify && !options.dryRun) {
    runToolchainVerify(targetDir, Boolean(options.json))
  }

  mkdirSync(join(targetDir, '.arbiter'), { recursive: true })
  const lock = await acquireLock(join(targetDir, '.arbiter', '.lock'))
  try {
    showTelemetryBannerIfFirstRun(undefined, options.quiet)

    log('\n  Arbiter — AI Development Governance Framework\n')
    log('  Detecting project...')

    const resolvedLanguageOverride = parseLanguage(options.language)
    const languageLocked = resolvedLanguageOverride !== undefined
    let language: Language
    let languageSource: string | null
    if (resolvedLanguageOverride !== undefined) {
      language = resolvedLanguageOverride
      languageSource = null
    } else {
      const det = detectLanguageWithSource(targetDir)
      language = det.language
      languageSource = det.source
    }
    const framework = detectFramework(targetDir, language)
    const buildCmds = detectBuildCommands(targetDir, language)
    const gitInfo = detectGitInfo(targetDir)
    const existing = detectExisting(targetDir)
    const githubAccess = detectGithubAccess()
    const lanesResult = detectLanes(targetDir)

    log(
      `  ├── Language: ${language}${formatLangHint(languageLocked, languageSource)}${framework ? ` / ${framework}` : ''}`,
    )
    log(`  ├── Build: ${buildCmds.buildTool}`)
    log(
      `  ├── Git: ${gitInfo.isGitRepo ? 'yes' : 'no'}${gitInfo.githubRepo ? ` (${gitInfo.githubOwner}/${gitInfo.githubRepo})` : ''}`,
    )
    if (githubAccess.authenticated)
      log(`  ├── GitHub: authenticated as ${githubAccess.username ?? 'unknown'}`)
    if (!options.json) logExistingDetections(existing)

    if (gitInfo.isGitRepo) {
      guardAdverseGitState(targetDir, options.force)
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
      languageLocked,
      languageSource,
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
      warnings.length > 0 ? { warnings } : undefined,
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
  // #1640: drop arbiter's own emitted project skills so a post-init `arbiter update`
  // does not list them as third-party integrations in AGENTS.md (init == update).
  const installedSkills = excludeOwnEmittedSkills(detectInstalledSkills({ targetDir, claudeHome }))
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
    // #1328: bracket the registry run with a generation session so each emitted
    // file's render hash is recorded into the manifest (first-run baseline). The
    // session ends + the manifest persists BEFORE saveConfig/runPlugins (A1/A6).
    const prevManifest = loadGeneratedManifest(targetDir)
    beginGenerationSession({ targetDir, prevHashes: prevManifest })
    const { results, errors: generatorErrors } = runGeneratorsWithErrors(config, installedSkills)
    const generatedHashes = endGenerationSession()
    saveGeneratedManifest(targetDir, { ...prevManifest, ...generatedHashes })
    committed.push(...results)

    const newConfig = buildArbiterConfig(config)
    const backendResult = runBackendSetup(config, log)

    // Load existing stored config before overwriting (brownfield re-init may have plugins).
    // #1978: this is a SEPARATE read from the one resolveProjectName consults at the
    // top of runInit — a long-running init should still see the on-disk state
    // immediately before this write, not a value cached from function entry.
    const storedBefore = loadConfig(targetDir)
    await saveConfig(targetDir, newConfig)

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

    // Post-write presence check (M1/#1491): every file a generator claims it WROTE
    // must actually be on disk. A `created`/`replaced` result whose file is missing
    // is a silent content-loss bug (the class that dropped GLOBAL_INVARIANTS.md),
    // not a benign skip — fail hard rather than report a phantom success.
    assertEmittedFilesPresent(committed)

    if (!options.brownfield && !options.json) {
      const skippedFiles = committed.filter(
        (r) => r.action === 'skipped' && r.reason !== 'not-applicable',
      )
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

    activateGitHooks(targetDir, log)

    const generatorErrorLines = generatorErrors.map((e) => `${e.key}: ${e.message}`)
    emitInitOutput(options.json, generatorErrorLines, backendResult.warnings, created, skipped)
  } catch (err) {
    process.stderr.write('\n  Generation failed — attempting rollback...\n')
    rollbackGeneration(committed)
    process.stderr.write('  Rollback complete. Review arbiter.json if it was partially written.\n')
    throw err
  } finally {
    // A3 leak-guard: clear any session a throw left active. Idempotent.
    endGenerationSession()
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

/**
 * Activate arbiter's git hooks immediately so the guardrails are LIVE right after
 * init — without waiting for `npm install` (Node `prepare`) or a manual run of
 * scripts/setup-hooks.sh (non-Node stacks like Go/Rust/Python). The whole value
 * proposition is the gate guarding every commit/push; leaving it off by default is
 * a silent footgun. Sets `core.hooksPath` ONLY when it is currently unset, so an
 * existing hook manager (husky, a pre-existing core.hooksPath) is never clobbered.
 */
function activateGitHooks(targetDir: string, log: (msg: string) => void): void {
  if (!existsSync(join(targetDir, '.githooks', 'pre-commit'))) return
  let current = ''
  try {
    current = runCli('git', ['config', '--get', 'core.hooksPath'], { cwd: targetDir }).stdout.trim()
  } catch (err) {
    // `git config --get` exits 1 when the key is UNSET — that is the common path,
    // so `current` stays '' (its initial value) and we proceed to set it. Only
    // bail if git itself is absent.
    if (err instanceof CliError && err.notFound) return
  }
  if (current === '.githooks') return // already active
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

function runToolchainVerify(targetDir: string, jsonMode = false): void {
  // Under --json the stdout stream must be a single parseable JSON document
  // (M2/#1491): route the human-readable verify banner + report to stderr so it
  // does not precede the JSON object on stdout. Failures already go to stderr.
  const writeHuman = (s: string): void => {
    if (jsonMode) process.stderr.write(s)
    else process.stdout.write(s)
  }
  writeHuman(`${t('cli.init.verifying_toolchain')}\n`)
  let report: ReturnType<typeof runProbes>
  try {
    report = runProbes(targetDir)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `\n  Toolchain verification failed unexpectedly: ${msg}\n` +
        '  No files were generated or modified. Use --no-verify to skip verification.\n',
    )
    process.exit(1)
  }
  writeHuman(`${formatText(report)}\n`)
  if (report.hasFailures) {
    process.stderr.write(
      '\n  arbiter init aborted: toolchain incompatibilities detected.\n' +
        '  Fix the issues above and re-run, or use --no-verify to skip.\n',
    )
    process.exit(1)
  }
}
