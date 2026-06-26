// SPDX-License-Identifier: Apache-2.0
import { mkdirSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'
import { acquireLock } from '../utils/file-lock.js'
import { UserFacingError, FatalError } from '../utils/errors.js'
import { beginGenerationSession, endGenerationSession, type WriteResult } from '../utils/fs.js'
import {
  loadGeneratedManifest,
  saveGeneratedManifest,
  manifestKey,
} from '../state/generated-manifest.js'
import { t } from '../i18n/index.js'
import { jsonOutput, statusToExitCode, type JsonOutputOpts } from '../utils/json-output.js'
import { getLogger } from '../utils/logger.js'
import { detectAdverseGitState } from '../detectors/git.js'
import { detectGithubAccess } from '../detectors/github.js'
import { detectLegacyWorkflowCollisionWarning } from '../detectors/workflow-collision.js'
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

/** A newly LANDED gate script (created or replaced) named `scripts/check-*.mjs`. */
function isNewlyLandedCheckScript(r: WriteResult): boolean {
  if (r.action !== 'created' && r.action !== 'backed-up-and-replaced') return false
  const norm = r.path.replace(/\\/g, '/')
  return /(^|\/)scripts\/check-[^/]+\.mjs$/.test(norm)
}

/**
 * #1410: detect the un-wired-gate footgun. When `arbiter update` emits a NEW
 * `scripts/check-*.mjs` gate AND `scripts/check-all.mjs` is WITHHELD (user-
 * modified, so the template fix that would wire the new gate did not land), the
 * new gate sits on disk but is never invoked — a silently inert check. Returns a
 * human-readable warning string, or null when there is nothing to warn about.
 *
 * Exported for unit testing the pure decision independent of the heavy runUpdate
 * filesystem/git path.
 */
/**
 * The newly-landed `scripts/check-*.mjs` gate scripts that are unwired because
 * `scripts/check-all.mjs` is withheld. The single source for BOTH the post-update
 * warning ({@link detectUnwiredGateWarning}) and the honest manifest section
 * ({@link unwiredGuardKeys}) — they must list exactly the same set so the file on
 * disk and the operator's console can never disagree.
 */
function unwiredGuardResults(results: WriteResult[]): WriteResult[] {
  const checkAllWithheld = results.some(
    (r) => r.withheld === true && r.path.replace(/\\/g, '/').endsWith('/scripts/check-all.mjs'),
  )
  if (!checkAllWithheld) return []
  return results.filter(isNewlyLandedCheckScript)
}

/**
 * #1504 (M1): the targetDir-relative manifest keys of the shipped-but-unwired
 * guards, for recording in `.arbiter-generated-manifest.json`. Paths that escape
 * targetDir (manifestKey → null) are dropped, matching the manifest's own
 * portable-key contract. Exported for unit testing the pure decision.
 */
export function unwiredGuardKeys(results: WriteResult[], targetDir: string): string[] {
  return unwiredGuardResults(results)
    .map((r) => manifestKey(targetDir, r.path))
    .filter((k): k is string => k !== null)
}

export function detectUnwiredGateWarning(results: WriteResult[]): string | null {
  const newGates = unwiredGuardResults(results).map((r) => {
    const norm = r.path.replace(/\\/g, '/')
    return norm.slice(norm.lastIndexOf('/') + 1)
  })
  if (newGates.length === 0) return null
  const list = newGates.join(', ')
  return (
    `Warning: ${list} added but check-all.mjs is withheld — the new gate is NOT wired ` +
    `(it will never run). Your check-all.mjs is user-modified, so the template fix that ` +
    `wires it was preserved, not applied. Please re-sync check-all.mjs (delete it and re-run ` +
    `\`arbiter update\`, or manually add the runCheck line) to activate the gate.`
  )
}

/** CI workflows that invoke the gate as `node scripts/check-all.mjs <level> --json <path>`. */
const GATE_INVOKING_WORKFLOWS = ['01-pr-fast.yml', '06-nightly.yml', 'drift-shadow.yml']

/**
 * #1504: detect a possible gate-signature mismatch. When `arbiter update`
 * (re)writes a CI workflow that runs `node scripts/check-all.mjs L2 --json <path>`
 * AND `scripts/check-all.mjs` is WITHHELD (user-modified), the withheld gate may
 * not parse that invocation — a parser that reads the level positionally as
 * `process.argv[2]` only (or ignores `--json`) runs the wrong level and writes no
 * gate-result artifact while the job stays GREEN (the B1 fake-green). Returns a
 * human-readable warning string, or null when there is nothing to warn about.
 *
 * Exported for unit testing the pure decision independent of runUpdate.
 */
export function detectGateSignatureWarning(results: WriteResult[]): string | null {
  const checkAllWithheld = results.some(
    (r) => r.withheld === true && r.path.replace(/\\/g, '/').endsWith('/scripts/check-all.mjs'),
  )
  if (!checkAllWithheld) return null
  const wroteGateWorkflow = results.some((r) => {
    if (r.action !== 'created' && r.action !== 'backed-up-and-replaced') return false
    const norm = r.path.replace(/\\/g, '/')
    return GATE_INVOKING_WORKFLOWS.some((w) => norm.endsWith(`/.github/workflows/${w}`))
  })
  if (!wroteGateWorkflow) return null
  return (
    `Warning: a CI workflow that invokes \`node scripts/check-all.mjs <level> --json <path>\` ` +
    `was (re)written but check-all.mjs is withheld (user-modified) — its arg parser may not ` +
    `match this invocation. Verify your check-all.mjs accepts a POSITIONAL level (\`L2\`) and ` +
    `\`--json [path]\`; a parser that reads the level only as \`process.argv[2]\` or ignores ` +
    `\`--json\` will silently run the wrong level and write no gate-result artifact while the ` +
    `job stays green (a fake-green). Re-sync check-all.mjs to the template, or update its parser.`
  )
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
  // #1504 (M1): record any delivered-but-unwired guard scripts (check-all withheld)
  // as an HONEST status in the manifest — re-derived every update so wiring the
  // gate later clears it. Without this the manifest's `files` map over-claims a
  // guard that never runs as "delivered protection" (the exact fake-green this wave
  // exists to kill). Mirrors the post-update warning surfaced in runUpdate.
  const unwired = unwiredGuardKeys(out.results, targetDir)
  saveGeneratedManifest(targetDir, { ...prevManifest, ...generatedHashes }, unwired)
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

    // #1410: surface the un-wired-gate footgun (new check-*.mjs emitted while a
    // user-modified check-all.mjs withheld the wiring fix) through the same
    // warnings channel as backend warnings — json mode lists it, text mode prints it.
    const unwiredWarning = detectUnwiredGateWarning(results)
    const gateSigWarning = detectGateSignatureWarning(results)
    // B2 (#1502): after emitting the numbered workflow set, scan the target for
    // pre-existing LEGACY workflows whose triggers collide (double-running CI,
    // racing release/signing on one tag). Conservative warn-only — never deletes.
    const legacyCollisionWarning = detectLegacyWorkflowCollisionWarning(targetDir)
    const allWarnings = [
      ...backendResult.warnings,
      ...(unwiredWarning ? [unwiredWarning] : []),
      ...(gateSigWarning ? [gateSigWarning] : []),
      ...(legacyCollisionWarning ? [legacyCollisionWarning] : []),
    ]

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
    emitUpdateOutcome(options, summary, generatorErrors, allWarnings)

    return { keysRun }
  } finally {
    // A3 leak-guard: clear any session left active by a throw/early-exit so it can
    // never corrupt the next in-process command (tests, batch mode). Idempotent.
    endGenerationSession()
    await lock.release()
  }
}
