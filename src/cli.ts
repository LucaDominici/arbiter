#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { Command, Option } from 'commander'
import { runInit } from './commands/init.js'
import { resolvePresetOption } from './wizard/presets.js'
import { runUpdate } from './commands/update.js'
import { runDiff } from './commands/diff.js'
import { runConfigure } from './commands/configure.js'
import { runSettings } from './commands/settings.js'
import { runTui } from './commands/tui.js'
import { runWorktreeOpen, runWorktreeClose, runWorktreeList } from './commands/worktree.js'
import { runVerify, runVerifyEvidence } from './commands/verify.js'
import { runGoldAudit } from './commands/gold-audit.js'
import { runDocSet } from './commands/doc-set.js'
import { runAntiFakeGreen } from './commands/anti-fake-green.js'
import { runCloseGoldGap } from './commands/close-gold-gap.js'
import { runVerifyPlan } from './commands/verify-plan.js'
import { loadConfig } from './utils/config.js'
import { loadPlugin } from './utils/plugin-loader.js'
import {
  runDoctorRepairState,
  runDoctorHealth,
  runDoctorRecoverLock,
  runDoctorClean,
} from './commands/doctor.js'
import { runIntegrationsList } from './commands/integrations.js'
import { runReviewCode, runReviewPlan, runReviewSubmit } from './commands/review.js'
import type { SubmittedPass } from './review/dispatch.js'
import { jsonOutput } from './utils/json-output.js'
import type { ReviewTier } from './review/tier-constants.js'
import { runUpgradeLevel } from './commands/upgrade-level.js'
import { runPluginAdd, runPluginRemove, runPluginList, runPluginInit } from './commands/plugin.js'
import {
  runTaskAdvance,
  runTaskRecover,
  runTaskResume,
  runTaskInit,
  runTaskGet,
  runTaskMark,
  HandoffRequiredError,
  BudgetBreachError,
} from './commands/task.js'
import type { TaskPhase } from './commands/task.js'
import { isTddPhase } from './commands/task-state.js'
import { runTaskShip, buildShipStepLines } from './commands/task-ship.js'
import { shipAffinityLines } from './affinity/gh-issues.js'
import { runShipFixOnRed } from './commands/ship-fix-on-red.js'
import { resolveShipProfile, autonomyAllows, buildShipOverrides } from './commands/ship-profile.js'
import { resolveShipTier } from './sizing/diff-signals.js'
import { parseIssueList, runShipBatch } from './batch/batch-runner.js'
import { runTaskRecordRed } from './commands/task-record-red.js'
import { runTaskRecordTechDebt } from './commands/task-record-tech-debt.js'
import { runTaskNote } from './commands/task-note.js'
import {
  runFindingsPromote,
  listSpoolFindings,
  defaultPromoteDeps,
} from './commands/findings-promote.js'
import { runVerifyTdd } from './commands/verify-tdd.js'
import { runHarness } from './commands/harness.js'
import { runKnowledgeMapUpdate } from './commands/knowledge-map.js'
import { runGraphBuild, runVerifyGraph } from './commands/graph.js'
import type { GraphFormat } from './commands/graph.js'
import { runTrace, type TraceFormat } from './commands/trace.js'
import { runBlame, type BlameFormat } from './commands/blame.js'
import { runAgentRulesExport, runAgentRulesVerify } from './commands/agent-rules.js'
import { runCiPlan, runCiVerifyPlan } from './commands/ci.js'
import { runReviewDiff, renderMarkdown } from './commands/review-diff.js'
import { confirmChannelDowngrade } from './utils/confirm-downgrade.js'
import type { ReleaseChannel } from './utils/channel.js'
import {
  runWorkList,
  runWorkCreate,
  runWorkShow,
  runWorkClose,
  runWorkAdvance,
} from './commands/work.js'
import type { WorkUnitPhase, WorkUnitStatus } from './decomposition/types.js'
import { appendEvidenceLine } from './utils/evidence-log.js'
import { getBoolFlag } from './config/env-registry.js'
import {
  AUTH_PROVIDERS,
  OBSERVABILITY_PROVIDERS,
  DEPLOY_TARGETS,
  isDeployTarget,
} from './config/schema.js'
import { runCli } from './utils/run-cli.js'
import {
  ArbiterError,
  UserFacingError,
  FatalError,
  ConfigError,
  RecoverableError,
} from './utils/errors.js'
import { SnapshotChecksumError } from './state/envelope.js'
import { registerCleanupHandlers } from './utils/fs.js'
import { runExplain } from './commands/explain.js'
import { getRunId, formatRunIdFooter } from './utils/run-id.js'
import { parseExperimentalArgv, isEnabled } from './experimental/index.js'
import { applyDeprecatedFlagFilter } from './internal/deprecate.js'
import { CLI_DEPRECATED_FLAGS } from './internal/cli-deprecation-registry.js'
import { warnExperimental } from './internal/experimental-warn.js'
import { setRootLogger, getLogger, type LogLevel } from './utils/logger.js'
import { resolveFromProcess } from './utils/logger-config.js'
import { startReplay, rotateReplayLogs, type ReplayHandle } from './utils/replay.js'
import { startProfiler, type ProfilerHandle } from './utils/profiler.js'
import { runReport } from './commands/report.js'
import {
  runKitList,
  runKitShow,
  runKitExplain,
  runKitValidate,
  runKitGenerate,
  enforceKitGate,
} from './commands/kit.js'
import type { KitListFormat, KitListFilter } from './commands/kit.js'
import type { Stack } from './kit/schema.js'
import { runKitInstall } from './commands/kit-install.js'
import type { BrownfieldClass } from './kit/thresholds.js'
import { runFeatureMatrixExport } from './commands/feature-matrix.js'
import { runConformance } from './commands/conformance.js'
import {
  renderText as renderConformanceText,
  renderConformanceMd,
  computeSummary,
} from './conformance/render.js'

registerCleanupHandlers()

// Mint run ID at CLI entry so all downstream code and subprocesses can read
// process.env.ARBITER_RUN_ID for log correlation.
getRunId()

function printCliError(msg: string): void {
  process.stderr.write(`  Error: ${msg}${formatRunIdFooter()}\n`)
}

// ── Evidence logging setup ────────────────────────────────────────────────────

/**
 * Strip --no-evidence from argv before Commander sees it (Commander would
 * reject it as an unknown option on subcommands), and capture the flag value.
 */
const _rawArgv = process.argv.slice(2)
const _noEvidenceIdx = _rawArgv.indexOf('--no-evidence')
const _noEvidence = _noEvidenceIdx !== -1 || getBoolFlag('ARBITER_NO_EVIDENCE')
if (_noEvidenceIdx !== -1) {
  process.argv.splice(2 + _noEvidenceIdx, 1)
}

const _verboseIdx = process.argv.indexOf('--verbose')
const _verbose = _verboseIdx !== -1
if (_verbose) {
  process.argv.splice(_verboseIdx, 1)
}

// Strip --experimental.<name> tokens before Commander sees them (unknown option rejection).
// Validates each name against the registry; throws on unknown experiments.
// Enabled experiments stored in ARBITER_EXPERIMENTAL (JSON) for downstream command access.
try {
  const { remaining, flags } = parseExperimentalArgv(process.argv)
  process.argv.length = 0
  process.argv.push(...remaining)
  if (Object.keys(flags).length > 0) {
    process.env['ARBITER_EXPERIMENTAL'] = JSON.stringify(flags)
    for (const name of Object.keys(flags)) {
      warnExperimental(name)
    }
  }
} catch (err) {
  process.stderr.write(`arbiter: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}

// Apply deprecated flag lifecycle filter (warn/hide/remove stages).
{
  const result = applyDeprecatedFlagFilter(process.argv, CLI_DEPRECATED_FLAGS)
  if (result.exitCode !== undefined) {
    process.stderr.write(`${result.errorMessage ?? 'Removed flag used.'}\n`)
    process.exit(result.exitCode)
  }
  process.argv.length = 0
  process.argv.push(...result.remaining)
}

// ── Observability flags (#635-#640) ──────────────────────────────────────────
// These are global flags that Commander does not understand on subcommands;
// strip them from argv before Commander sees the args, but capture the values.
// Logger runId is bound to the same value as ARBITER_RUN_ID (utils/run-id.ts)
// so log records, replay dirs, and error footers all correlate cleanly.

function consumeFlag(name: string): boolean {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return false
  process.argv.splice(idx, 1)
  return true
}

function consumeFlagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  if (idx === -1) {
    const eqMatch = process.argv.find((a) => a.startsWith(`${name}=`))
    if (eqMatch !== undefined) {
      process.argv.splice(process.argv.indexOf(eqMatch), 1)
      return eqMatch.slice(name.length + 1)
    }
    return undefined
  }
  const value = process.argv[idx + 1]
  process.argv.splice(idx, 2)
  return value
}

const _debugFlag = consumeFlag('--debug')
const _profileFlag = consumeFlag('--profile')
const _noReplayFlag = consumeFlag('--no-replay')
const _logLevelFlag = consumeFlagValue('--log-level')
const _logFormatFlag = consumeFlagValue('--log-format')
const _seedFlag = consumeFlagValue('--seed')
// --channel is consumed early so doctor/update can read it without re-scanning argv
const _channelFlag = consumeFlagValue('--channel')
if (_channelFlag !== undefined && !['latest', 'beta', 'canary'].includes(_channelFlag)) {
  process.stderr.write(
    `[arbiter] error: --channel "${_channelFlag}" is not a valid channel.\n` +
      `  Valid values: latest, beta, canary\n`,
  )
  process.exit(1)
}

const _resolvedLogger = resolveFromProcess(
  [
    ...(_logLevelFlag !== undefined ? ['--log-level', _logLevelFlag] : []),
    ...(_logFormatFlag !== undefined ? ['--log-format', _logFormatFlag] : []),
  ],
  process.env,
)
const _effectiveLevel: LogLevel = _debugFlag ? 'debug' : _resolvedLogger.level
const _runId = getRunId()
setRootLogger({
  level: _effectiveLevel,
  format: _resolvedLogger.format,
  runId: _runId,
})

if (_seedFlag !== undefined) {
  process.env.ARBITER_SEED = _seedFlag
}

let _replayHandle: ReplayHandle | null = null
if (!_noReplayFlag) {
  try {
    rotateReplayLogs({ capN: 10 })
    _replayHandle = startReplay({
      runId: _runId,
      argv: process.argv.slice(1),
      env: process.env,
      cwd: process.cwd(),
    })
  } catch (err) {
    process.stderr.write(`[warn] replay capture failed: ${String(err)}\n`)
  }
}

let _profilerHandle: ProfilerHandle | null = null
async function _startProfileIfRequested(): Promise<void> {
  if (!_profileFlag) return
  try {
    _profilerHandle = await startProfiler({ runId: _runId })
  } catch (err) {
    getLogger().warn('profiler.start_failed', undefined, String(err))
  }
}

/** Resolve git HEAD SHA once at startup; fall back to "unknown" in non-git dirs. */
function resolveHeadSha(): string {
  try {
    return runCli('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()
  } catch {
    return 'unknown'
  }
}

const _headSha = _noEvidence ? '' : resolveHeadSha()
const _startMs = Date.now()

/**
 * Derive cmd + args from process.argv (after Commander strips the node binary
 * and script path).
 * Convention: `cmd` = top-level subcommand (e.g. "init", "worktree open"),
 *             `args` = remaining tokens after the subcommand.
 */
function parseCmdArgs(): { cmd: string; args: string[] } {
  const tokens = process.argv.slice(2)
  if (tokens.length === 0) return { cmd: '', args: [] }
  // Handle nested commands like "worktree open" / "task advance" / "work list"
  const nested: ReadonlySet<string> = new Set(['worktree', 'wt', 'task', 'plugin', 'work', 'kit'])
  const first = tokens[0] ?? ''
  if (nested.has(first) && tokens.length >= 2) {
    const sub = tokens[1] ?? ''
    // Skip flags as second token (e.g. "worktree --help")
    if (!sub.startsWith('-')) {
      return { cmd: `${first} ${sub}`, args: tokens.slice(2) }
    }
  }
  return { cmd: first, args: tokens.slice(1) }
}

/**
 * Validate the `init` union-typed flags against their exported value sets BEFORE any
 * scaffolding, so an out-of-union value fails with an explicit error instead of being
 * blind-cast and corrupting generated output. Extracted from the init action to keep
 * that action under the complexity/line ceilings (#1671/#1676/#1677).
 */
function validateInitFlags(opts: {
  archetype?: string
  authProvider?: string
  observabilityProvider?: string
  deployTarget?: string
}): void {
  const VALID_ARCHETYPES = [
    'backend-web-db',
    'cli',
    'library',
    'data-pipeline',
    'frontend-spa',
    'embedded',
  ]
  if (opts.archetype !== undefined && !VALID_ARCHETYPES.includes(opts.archetype)) {
    throw ArbiterError.fromKey(
      'E_INVALID_ARCHETYPE',
      'errors.E_INVALID_ARCHETYPE',
      { field: 'archetype', value: opts.archetype, valid: VALID_ARCHETYPES.join(', ') },
      { hint: 'Run `arbiter init --help` for the list of valid archetypes.' },
    )
  }
  if (opts.authProvider !== undefined && !AUTH_PROVIDERS.has(opts.authProvider)) {
    throw ArbiterError.fromKey(
      'E_INVALID_ARCHETYPE',
      'errors.E_INVALID_ARCHETYPE',
      { field: 'auth-provider', value: opts.authProvider, valid: [...AUTH_PROVIDERS].join(', ') },
      { hint: 'Run `arbiter init --help` for the list of valid auth providers.' },
    )
  }
  if (
    opts.observabilityProvider !== undefined &&
    !OBSERVABILITY_PROVIDERS.has(opts.observabilityProvider)
  ) {
    throw ArbiterError.fromKey(
      'E_INVALID_ARCHETYPE',
      'errors.E_INVALID_ARCHETYPE',
      {
        field: 'observability-provider',
        value: opts.observabilityProvider,
        valid: [...OBSERVABILITY_PROVIDERS].join(', '),
      },
      { hint: 'Run `arbiter init --help` for the list of valid observability providers.' },
    )
  }
  if (opts.deployTarget !== undefined && !isDeployTarget(opts.deployTarget)) {
    throw ArbiterError.fromKey(
      'E_INVALID_ARCHETYPE',
      'errors.E_INVALID_ARCHETYPE',
      { field: 'deploy-target', value: opts.deployTarget, valid: [...DEPLOY_TARGETS].join(', ') },
      { hint: 'Run `arbiter init --help` for the list of valid deploy targets.' },
    )
  }
}

const _parsedCmd = parseCmdArgs()

let _evidenceLogged = false

process.on('exit', (code) => {
  if (_replayHandle !== null) {
    try {
      _replayHandle.close(code)
    } catch {
      // replay close is best-effort; never block CLI exit
    }
  }
  if (_evidenceLogged || _noEvidence) return
  _evidenceLogged = true
  try {
    appendEvidenceLine({
      ts: new Date().toISOString(),
      cmd: _parsedCmd.cmd,
      args: _parsedCmd.args,
      exit: code,
      durationMs: Date.now() - _startMs,
      headSha: _headSha,
    })
  } catch {
    // evidence log write can fail during ENOSPC or signal-driven exit; log entry lost
    process.stderr.write('[arbiter] warning: evidence log write failed on exit — log entry lost\n')
  }
})

// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()

program.name('arbiter').description('AI development governance framework').version('0.3.0')

// #1770 (T5): public 11-command surface. Experimental commands are registered with
// `{ hidden: true }` — fully functional, omitted from default --help. The built-in
// help command is replaced by a hidden `help [command] [--all]` so `arbiter help --all`
// can list the hidden surface (see registration at the bottom of this file).
program.helpCommand(false)
program.addHelpText('after', '\nRun `arbiter help --all` for experimental commands.')

// Global flags. Declared so `--help` documents them; values are consumed pre-parse above.
program
  .option('--log-level <level>', 'Log level: error|warn|info|debug|trace (default: info)')
  .option('--log-format <format>', 'Log format: text|json (default: text)')
  .option('--debug', 'Enable debug-level logging (implies --log-level=debug)')
  .option(
    '--seed <n>',
    'Deterministic seed for generators (overrides arbiter.json-derived default)',
  )
  .option('--no-replay', 'Disable replay log capture for this invocation')
  .option('--profile', 'Capture a V8 CPU profile to ~/.arbiter/profiles/<runId>.cpuprofile')
  // #662 — channel flag: overrides channel field in arbiter.json for this invocation.
  // No subcommand defines its own --channel, so no collision risk.
  .option(
    '--channel <name>',
    'Channel for this invocation: latest|beta|canary — gates downgrade warnings and shown in `doctor health` (default: arbiter.json channel or latest)',
  )

program
  .command('report', { hidden: true })
  .description('Bundle a replay run for bug reports')
  .option('--run-id <id>', 'Specific run to bundle (default: most recent in ~/.arbiter/logs/)')
  .option('--auto', 'Skip editor preview; bundle all files', false)
  .option('--print-only', 'Print manifest path without producing a tarball', false)
  .action(async (opts: { runId?: string; auto: boolean; printOnly: boolean }): Promise<void> => {
    const reportOpts: import('./commands/report.js').ReportOptions = {
      auto: opts.auto,
      printOnly: opts.printOnly,
    }
    if (opts.runId !== undefined) reportOpts.runId = opts.runId
    const result = await runReport(reportOpts)
    const logger = getLogger()
    if (result.bundlePath !== null) {
      logger.info('report.bundle_ready', { path: result.bundlePath, files: result.files.length })
      process.stdout.write(`Bundle ready: ${result.bundlePath}\n`)
      process.stdout.write('Attach to GH issue (never uploaded automatically).\n')
    } else {
      process.stdout.write(`Manifest: ${result.manifestPath}\n`)
    }
    if (result.rejected.length > 0) {
      logger.warn('report.rejected_entries', { count: result.rejected.length })
    }
  })

// #1401 — zero-friction incidental-finding capture. Appends ONE line to a per-shard JSONL spool
// under .arbiter/findings/<shard>.jsonl. Non-blocking, no network. See rule 60-incidental-capture.
program
  .command('note')
  .description('Capture an out-of-scope finding to the per-agent JSONL spool (#1401)')
  .argument('[note]', 'Finding text (or use --note)')
  .option('--note <text>', 'Finding text (alternative to the positional argument)')
  .option('--kind <kind>', 'Finding class: dup|smell|risk|debt|note (default: note)')
  .option('--severity <sev>', 'Severity band: low|med|high|info (default: info)')
  .option('--file <path>', 'Repo-relative file the finding concerns')
  .option('--line <n>', 'Line number the finding was seen at (excluded from the fingerprint)')
  .option('--dir <path>', 'Project root (default: cwd)')
  .action(
    (
      positional: string | undefined,
      opts: {
        note?: string
        kind?: string
        severity?: string
        file?: string
        line?: string
        dir?: string
      },
    ): void => {
      const text = (positional ?? opts.note ?? '').trim()
      const logger = getLogger()
      if (text.length === 0) {
        process.stderr.write('arbiter note: a finding text is required (positional or --note)\n')
        process.exitCode = 1
        return
      }
      const noteOpts: import('./commands/task-note.js').TaskNoteOptions = { note: text }
      if (opts.kind !== undefined) noteOpts.kind = opts.kind
      if (opts.severity !== undefined) noteOpts.severity = opts.severity
      if (opts.file !== undefined) noteOpts.file = opts.file
      if (opts.dir !== undefined) noteOpts.dir = opts.dir
      const parsedLine = opts.line !== undefined ? Number.parseInt(opts.line, 10) : NaN
      if (Number.isInteger(parsedLine)) noteOpts.line = parsedLine
      const result = runTaskNote(noteOpts)
      if (result.ok) {
        logger.info('note.captured', { spool: result.spoolPath, fingerprint: result.fingerprint })
        process.stdout.write(`noted → ${result.spoolPath}\n`)
      } else {
        process.stderr.write(`arbiter note: ${result.reason}\n`)
        process.exitCode = 1
      }
    },
  )

// #1403 — drain the incidental-finding spool. `findings list` shows the deduped spool;
// `findings promote` re-validates each finding vs HEAD, dedups vs open issues, and files the
// survivors as tracked issues (recorded to .arbiter/evidence so they surface in GAP.md).
const findings = program
  .command('findings', { hidden: true })
  .description('Inspect and promote the incidental-finding spool (#1403)')

findings
  .command('list')
  .description('List the deduped findings currently in the spool')
  .option('--dir <path>', 'Project root (default: cwd)')
  .action((opts: { dir?: string }): void => {
    const dir = opts.dir ?? process.cwd()
    const entries = listSpoolFindings(dir)
    if (entries.length === 0) {
      process.stdout.write('findings: spool is empty (nothing to promote)\n')
      return
    }
    for (const f of entries) {
      const loc = f.file.length > 0 ? ` (${f.file}${f.line !== null ? `:${f.line}` : ''})` : ''
      process.stdout.write(`[${f.severity}] ${f.kind}: ${f.note}${loc}\n`)
    }
    process.stdout.write(`\nfindings: ${entries.length} unique finding(s) in spool\n`)
  })

findings
  .command('promote')
  .description('Re-validate vs HEAD, dedup vs open issues, and file the surviving findings')
  .option('--dir <path>', 'Project root (default: cwd)')
  .option(
    '--age-sweep-days <n>',
    'Force-decide findings unpromoted longer than N days (default: 14)',
  )
  .action((opts: { dir?: string; ageSweepDays?: string }): void => {
    const promoteOpts: import('./commands/findings-promote.js').PromoteOptions = {}
    if (opts.dir !== undefined) promoteOpts.dir = opts.dir
    const parsedDays =
      opts.ageSweepDays !== undefined ? Number.parseInt(opts.ageSweepDays, 10) : NaN
    if (Number.isInteger(parsedDays) && parsedDays >= 0) promoteOpts.ageSweepDays = parsedDays
    const result = runFindingsPromote(promoteOpts, defaultPromoteDeps)
    const logger = getLogger()
    if (!result.ok) {
      process.stderr.write(`arbiter findings promote: ${result.reason}\n`)
      process.exitCode = 1
      return
    }
    logger.info('findings.promoted', {
      promoted: result.promoted.length,
      dropped: result.dropped.length,
      skipped: result.skipped.length,
      deferred: result.deferred.length,
    })
    process.stdout.write(
      `findings promote: ${result.promoted.length} filed, ${result.dropped.length} dropped (stale), ` +
        `${result.skipped.length} skipped (existing), ${result.deferred.length} deferred (age-sweep)\n`,
    )
  })

program
  .command('init')
  .description('Initialize AI governance in a project')
  .option('-y, --yes', 'Skip wizard — use auto-detected defaults', false)
  .option('--tools <tools>', 'Comma-separated list of AI tools (claude,codex)')
  .option('--level <level>', 'Governance level: L1, L2, L3, or L4', 'L2')
  .option(
    '--tier <tier>',
    'Progressive-adoption tier: bootstrap (gentlest Day-1: L1 + brownfield) | L1 | L2 | L3 | L4. Overrides --level.',
  )
  .option(
    '--language <lang>',
    'Override detected language (typescript|java|kotlin|rust|python|go|multi)',
  )
  .option(
    '--archetype <archetype>',
    'Override detected archetype (backend-web-db|cli|library|data-pipeline|frontend-spa|embedded)',
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--dry-run', 'Preview what would be generated without writing files', false)
  .option(
    '--brownfield',
    'Auto-capture debt baseline after generation (locks current state as day-0 baseline)',
    false,
  )
  .option('--no-verify', 'Skip toolchain compatibility probes after generation')
  .option(
    '--accept-beta-tools',
    'Allow generation of L3 features backed by beta-maturity tools (audit trail written to arbiter.json)',
    false,
  )
  .option(
    '--backend <backend>',
    'Decomposition backend: github or markdown (overrides gh auth detection)',
  )
  .option('--json', 'Emit machine-readable JSON output (requires --yes)', false)
  .option('--quiet', 'Suppress informational banners (e.g. telemetry notice)', false)
  .option('--force', 'Override adverse git state check (detached HEAD, rebase, etc.)', false)
  .option(
    '--preset <preset>',
    'Apply a meta-preset: industrial-grade (governance + compliance + observability + auth bundle) | solo-homelab (compliance off, governance ≤ L2, mutation off, no prod runbooks)',
  )
  .option('--auth-provider <provider>', 'Override auth provider (used with --preset or standalone)')
  .option(
    '--observability-provider <provider>',
    'Override observability provider (used with --preset or standalone)',
  )
  .option(
    '--deploy-target <target>',
    'Deploy target: ghcr | azure-container-app | aws-ecs | gcp-cloud-run | none (non-interactive complement to the wizard)',
  )
  .option('--github', 'Activate GitHub API calls and set permitGitHub:true in stored config', false)
  .option(
    '--solo',
    'Set collaborationMode=trunk-solo (direct-merge, minimal CI). Shorthand for ADR-051 trunk-solo mode.',
    false,
  )
  .option('--recipe <path>', 'Path or https:// URL to a recipe JSON file for pre-configured init')
  .option('--recipe-sha256 <hash>', 'Expected SHA-256 hex digest of the recipe file')
  .action(
    async (opts: {
      yes: boolean
      tools?: string
      level?: string
      tier?: string
      language?: string
      archetype?: string
      dir?: string
      dryRun: boolean
      brownfield: boolean
      verify: boolean
      acceptBetaTools: boolean
      github: boolean
      solo: boolean
      backend?: string
      json: boolean
      quiet: boolean
      force: boolean
      preset?: string
      authProvider?: string
      observabilityProvider?: string
      deployTarget?: string
      recipe?: string
      recipeSha256?: string
    }) => {
      // Validate union-typed flags (archetype #1671, auth/observability #1676, deploy
      // #1677) BEFORE scaffolding — see validateInitFlags. --language is validated inside
      // runInit via parseLanguage.
      validateInitFlags(opts)
      const backend =
        opts.backend === 'github' || opts.backend === 'markdown' ? opts.backend : undefined
      const preset = resolvePresetOption(opts.preset)
      await runInit({
        yes: opts.yes,
        tools: opts.tools,
        level: opts.level,
        ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
        dir: opts.dir,
        dryRun: opts.dryRun,
        brownfield: opts.brownfield,
        noVerify: !opts.verify,
        acceptBetaTools: opts.acceptBetaTools,
        github: opts.github,
        ...(opts.solo ? { solo: true as const } : {}),
        ...(backend !== undefined ? { backend } : {}),
        json: opts.json,
        quiet: opts.quiet,
        force: opts.force,
        ...(preset !== undefined ? { preset } : {}),
        ...(opts.authProvider !== undefined
          ? { authProvider: opts.authProvider as import('./wizard/types.js').AuthProvider }
          : {}),
        ...(opts.observabilityProvider !== undefined
          ? {
              observabilityProvider:
                opts.observabilityProvider as import('./wizard/types.js').ObservabilityProvider,
            }
          : {}),
        ...(opts.recipe !== undefined ? { recipe: opts.recipe } : {}),
        ...(opts.recipeSha256 !== undefined ? { recipeSha256: opts.recipeSha256 } : {}),
        ...(opts.language !== undefined
          ? { language: opts.language as import('./wizard/types.js').Language }
          : {}),
        ...(opts.archetype !== undefined
          ? { archetype: opts.archetype as import('./wizard/types.js').Archetype }
          : {}),
        ...(opts.deployTarget !== undefined
          ? { deployTarget: opts.deployTarget as import('./wizard/types.js').DeployTarget }
          : {}),
      })
    },
  )

program
  .command('update')
  .description('Re-generate governance files using stored config (arbiter.json)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option(
    '--github',
    'Activate live GitHub API calls (opt-in; ARBITER_GITHUB=1 also activates)',
    false,
  )
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--force', 'Override adverse git state check (detached HEAD, rebase, etc.)', false)
  .action(async (opts: { dir?: string; github: boolean; json: boolean; force: boolean }) => {
    if (_channelFlag !== undefined) {
      const config = loadConfig(opts.dir ?? '.')
      await confirmChannelDowngrade(_channelFlag as ReleaseChannel, config?.channel)
    }
    await runUpdate({
      dir: opts.dir,
      github: opts.github,
      json: opts.json,
      force: opts.force,
    })
  })

program
  .command('configure')
  .description('Modify arbiter.json configuration (interactive on TTY, or use --set)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option(
    '--set <path=value>',
    'Set a config path to a value (repeatable)',
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string | undefined; set: string[]; json: boolean }) => {
    const handler = async (): Promise<void> => {
      if (opts.set.length === 0 && !opts.json && process.stdin.isTTY) {
        const { runInteractiveConfigure } = await import('./commands/configure-interactive.js')
        return runInteractiveConfigure(opts.dir)
      }
      return runConfigure({ dir: opts.dir, sets: opts.set, json: opts.json })
    }
    handler().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    })
  })

program
  .command('tui', { hidden: true })
  .description('Interactive umbrella menu routing to configure/settings/doctor/upgrade (#1122)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string | undefined }) => {
    if (!process.stdin.isTTY) {
      process.stderr.write('arbiter tui requires an interactive terminal (TTY).\n')
      process.exit(1)
    }
    runTui({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    })
  })

program
  .command('settings', { hidden: true })
  .description('List every settable arbiter.json path with its current value (#1121)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string | undefined; json: boolean }) => {
    try {
      runSettings({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}), json: opts.json })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    }
  })

program
  .command('diff')
  .description('Show what arbiter update would change (dry run)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--withheld', 'Show only template fixes withheld from user-modified files (#1344)', false)
  .action((opts: { dir?: string; json: boolean; withheld: boolean }) => {
    runDiff({ dir: opts.dir, json: opts.json, withheld: opts.withheld })
  })

const worktree = program
  .command('worktree')
  .alias('wt')
  .description('Manage git worktrees for parallel task development')

worktree
  .command('open <task-id> [slug]')
  .description('Create a sibling worktree with a task branch and symlinked local files')
  .option('--base <branch>', 'Base branch to branch from', 'main')
  .option('--sibling [slug]', 'Place worktree at <repo>.worktrees/<slug> (sibling layout)')
  .option('--with-build-links', 'Also materialize buildLinks from config', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (
      taskId: string,
      slug: string | undefined,
      opts: { base: string; sibling?: string | boolean; withBuildLinks: boolean; json: boolean },
    ) => {
      runWorktreeOpen({
        taskId,
        ...(slug !== undefined ? { slug } : {}),
        base: opts.base,
        ...(opts.sibling !== undefined
          ? { sibling: opts.sibling === true ? '' : (opts.sibling as string) }
          : {}),
        withBuildLinks: opts.withBuildLinks,
        json: opts.json,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`  Error: ${msg}\n`)
        process.exit(1)
      })
    },
  )

worktree
  .command('close <task-id>')
  .description('Tear down a task worktree after its branch is merged')
  .option('--force', 'Close even if branch is unmerged or hook fails', false)
  .option('--keep-branch', 'Do not delete the task branch after closing', false)
  .option('--no-fetch', 'Skip git fetch before the merge check', false)
  .option('--harvest', 'Copy modified/untracked files back to main repo before closing', false)
  .option(
    '--harvest-all',
    'Harvest all files and skip merge check (implies --force for cleanup)',
    false,
  )
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (
      taskId: string,
      opts: {
        force: boolean
        keepBranch: boolean
        fetch: boolean
        harvest: boolean
        harvestAll: boolean
        json: boolean
      },
    ) => {
      runWorktreeClose({
        taskId,
        force: opts.force,
        keepBranch: opts.keepBranch,
        noFetch: !opts.fetch,
        harvest: opts.harvest,
        harvestAll: opts.harvestAll,
        json: opts.json,
      })
    },
  )

worktree
  .command('list')
  .description('List open task worktrees')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { json: boolean }) => {
    runWorktreeList({ json: opts.json })
  })

/**
 * Parse repeated `--pass N:VERDICT` specs into structured pass verdicts (#1329).
 * Returns null on any malformed spec so the caller can exit 2.
 */
function parsePassSpecs(specs: readonly string[]): SubmittedPass[] | null {
  const out: SubmittedPass[] = []
  for (const spec of specs) {
    const idx = spec.indexOf(':')
    if (idx <= 0) return null
    const head = spec.slice(0, idx)
    const v = spec.slice(idx + 1).toUpperCase()
    // Strict decimal index — reject `1e2`, `0x1f`, surrounding whitespace, etc.
    if (!/^\d+$/.test(head)) return null
    const n = Number(head)
    if (n < 1) return null
    if (v !== 'PASS' && v !== 'WARN' && v !== 'FAIL') return null
    out.push({ pass: n, verdict: v })
  }
  return out
}

const review = program
  .command('review', { hidden: true })
  .description('Review artefacts (plans, code) against governance invariants')

review
  .command('plan <file>')
  .description('Review a plan markdown file via a Claude subagent (#235)')
  .option('--dir <dir>', 'Project root (default: current directory)')
  .option('--tier <tier>', 'Review tier: XS, S, or Standard (default: S)')
  .option(
    '--emit-prompts <dir>',
    'Write per-pass reviewer prompts to <dir> and exit (agent-agnostic; no claude). Review them, then `arbiter review submit` (#1329).',
  )
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (file: string, opts: { dir?: string; tier?: string; emitPrompts?: string; json: boolean }) => {
      const tier: ReviewTier | undefined =
        opts.tier === 'XS' || opts.tier === 'S' || opts.tier === 'Standard' ? opts.tier : undefined
      if (opts.tier !== undefined && tier === undefined) {
        printCliError(`invalid --tier "${opts.tier}". Valid: XS, S, Standard.`)
        getLogger().error('invalid_tier', { value: opts.tier ?? null })
        process.exit(1)
      }
      const result = runReviewPlan({
        file,
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(tier !== undefined ? { tier } : {}),
        ...(opts.emitPrompts !== undefined ? { emitPrompts: opts.emitPrompts } : {}),
        json: opts.json,
      })
      process.exit(result.exitCode)
    },
  )

review
  .command('submit <file>')
  .description(
    'Record agent-produced plan-review verdicts into the gate evidence (agent-agnostic; pairs with `review plan --emit-prompts`) (#1329)',
  )
  .option('--dir <dir>', 'Project root (default: current directory)')
  .option('--tier <tier>', 'Review tier: XS, S, or Standard (default: from task state)')
  .requiredOption('--reviewer <id>', 'Identity of the agent/human that performed the review')
  .option(
    '--pass <N:VERDICT...>',
    'Per-pass verdict, e.g. --pass 1:PASS --pass 2:WARN (repeatable). VERDICT ∈ PASS|WARN|FAIL.',
    (val: string, acc: string[]) => [...acc, val],
    [] as string[],
  )
  .option('--manifest <path>', 'Emit manifest.json to cross-check the plan is unchanged')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (
      file: string,
      opts: {
        dir?: string
        tier?: string
        reviewer: string
        pass: string[]
        manifest?: string
        json: boolean
      },
    ) => {
      const tier: ReviewTier | undefined =
        opts.tier === 'XS' || opts.tier === 'S' || opts.tier === 'Standard' ? opts.tier : undefined
      if (opts.tier !== undefined && tier === undefined) {
        printCliError(`invalid --tier "${opts.tier}". Valid: XS, S, Standard.`)
        getLogger().error('invalid_tier', { value: opts.tier ?? null })
        process.exit(1)
      }
      const passes = parsePassSpecs(opts.pass)
      if (passes === null) {
        printCliError('invalid --pass spec. Use N:VERDICT, e.g. 1:PASS (VERDICT ∈ PASS|WARN|FAIL).')
        process.exit(2)
      }
      const result = runReviewSubmit({
        file,
        reviewer: opts.reviewer,
        passes,
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(tier !== undefined ? { tier } : {}),
        ...(opts.manifest !== undefined ? { manifestPath: opts.manifest } : {}),
        json: opts.json,
      })
      process.exit(result.exitCode)
    },
  )

review
  .command('code')
  .description('Multi-agent code review: dispatch N parallel reviewers based on tier (#236)')
  .option('--dir <dir>', 'Project root (default: current directory)')
  .option('--tier <tier>', 'Review tier: XS, S, or Standard (default: Standard)')
  .option('--diff <ref>', 'Git ref to diff against (default: origin/main)')
  .option(
    '--evidence-dir <path>',
    'Override evidence directory (default: .evidence/review-<timestamp>/)',
  )
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    async (opts: {
      dir?: string
      tier?: string
      diff?: string
      evidenceDir?: string
      json: boolean
    }) => {
      const tier: ReviewTier | undefined =
        opts.tier === 'XS' || opts.tier === 'S' || opts.tier === 'Standard' ? opts.tier : undefined
      if (opts.tier !== undefined && tier === undefined) {
        printCliError(`invalid --tier "${opts.tier}". Valid: XS, S, Standard.`)
        getLogger().error('invalid_tier', { value: opts.tier ?? null })
        process.exit(1)
      }
      const result = await runReviewCode({
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(tier !== undefined ? { tier } : {}),
        ...(opts.diff !== undefined ? { diffRef: opts.diff } : {}),
        ...(opts.evidenceDir !== undefined ? { evidenceDir: opts.evidenceDir } : {}),
        json: opts.json,
      })
      process.exit(result.exitCode)
    },
  )

program
  .command('gold-audit [repo]')
  .description('Deterministic gold-LEVEL band + missing-items report (#1414, wraps the engine)')
  .option('--stack <stack>', 'Per-stack registry selector (standards/gold-registry.<stack>.yml)')
  .option('--class <class>', 'Brownfield class for the level band: gold|light|medium|heavy')
  .option('--check', 'No-regress gate: bootstrap missing baseline (exit 0), fail on regress', false)
  .option('--require-baseline', 'With --check, a missing baseline is a HARD FAIL (#1419)', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--cockpit', 'Render the rich TTY-gated goldness console (#1475)', false)
  .option('--ascii', 'Force pure-ASCII cockpit output (no unicode glyphs/ANSI)', false)
  .action(
    (
      repo: string | undefined,
      opts: {
        stack?: string
        class?: string
        json: boolean
        check: boolean
        requireBaseline: boolean
        cockpit: boolean
        ascii: boolean
      },
    ) => {
      const cls =
        opts.class === 'gold' ||
        opts.class === 'light' ||
        opts.class === 'medium' ||
        opts.class === 'heavy'
          ? opts.class
          : undefined
      if (opts.class !== undefined && cls === undefined) {
        printCliError(`invalid --class "${opts.class}". Valid: gold, light, medium, heavy.`)
        process.exit(1)
      }
      const result = runGoldAudit({
        ...(repo !== undefined ? { repo } : {}),
        ...(opts.stack !== undefined ? { stack: opts.stack } : {}),
        ...(cls !== undefined ? { class: cls } : {}),
        check: opts.check,
        requireBaseline: opts.requireBaseline,
        json: opts.json,
        cockpit: opts.cockpit,
        ascii: opts.ascii,
      })
      process.exit(result.exitCode)
    },
  )

program
  .command('doc-set', { hidden: true })
  .description('Deterministic doc-set presence audit (#1428, thin wrapper over the engine)')
  .option('--check', 'Advisory mode for the downstream thin runner (exit 0 unless --strict)', false)
  .option('--strict', 'Exit 1 if any mandatory doc is missing (default: advisory)', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--generate', 'Scaffold stubs for missing mandatory+recommended .md docs', false)
  .action((opts: { check: boolean; strict: boolean; json: boolean; generate: boolean }) => {
    const args: string[] = []
    if (opts.strict) args.push('--strict')
    if (opts.json) args.push('--json')
    if (opts.generate) args.push('--generate')
    const result = runDocSet({ check: opts.check, args })
    process.exit(result.exitCode)
  })

program
  .command('anti-fake-green', { hidden: true })
  .description('Anti-fake-green guard aggregate (#1428, thin wrapper over the engine)')
  .option('--enforce', 'Promote advisory (gh-audit) findings to hard failures', false)
  .action((opts: { enforce: boolean }) => {
    const result = runAntiFakeGreen({ enforce: opts.enforce })
    process.exit(result.exitCode)
  })

program
  .command('close-gold-gap <gapId>', { hidden: true })
  .description('Emit the remediation recipe for one gold-audit gap (#1422, never fakes a close)')
  .option('--repo <repo>', 'Repo to audit (default: current directory)')
  .option('--stack <stack>', 'Per-stack registry selector (standards/gold-registry.<stack>.yml)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((gapId: string, opts: { repo?: string; stack?: string; json: boolean }) => {
    const result = runCloseGoldGap({
      gapId,
      ...(opts.repo !== undefined ? { repo: opts.repo } : {}),
      ...(opts.stack !== undefined ? { stack: opts.stack } : {}),
      json: opts.json,
    })
    process.exit(result.exitCode)
  })

const verify = program
  .command('validate')
  .alias('verify')
  .description('Probe toolchain compatibility for the detected stack')
  .option('--json', 'Emit JSON report', false)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { json: boolean; dir?: string }) => {
    runVerify({ json: opts.json, dir: opts.dir })
  })

verify
  .command('evidence')
  .description('Verify the .evidence/SUMMARY.json snapshot (SHA + freshness window).')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { json: boolean; dir?: string }) => {
    const result = runVerifyEvidence({ dir: opts.dir })
    if (opts.json) {
      jsonOutput(
        'verify evidence',
        result.status,
        {
          exitCode: result.exitCode,
          ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
        },
        result.status === 'error' && result.reason !== undefined ? [result.reason] : undefined,
      )
    } else {
      const label = result.status === 'ok' ? 'OK' : result.status.toUpperCase()
      const tail = result.reason ? ` — ${result.reason}` : ''
      process.stdout.write(`verify evidence: ${label}${tail}\n`)
    }
    process.exit(result.exitCode)
  })

verify
  .command('plan <file>')
  .description('Validate a PLAN.json against invariant rules and write REVIEW.json (#253)')
  .option('--dir <dir>', 'Project root (default: current directory)')
  .option('--reviewer <name>', 'Reviewer name in REVIEW.json')
  .option('--fail-on-warn', 'Treat WARN violations as REJECTED', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    async (
      file: string,
      opts: {
        dir?: string
        reviewer?: string
        failOnWarn: boolean
        json: boolean
      },
    ) => {
      const { resolve } = await import('node:path')
      const dir = resolve(opts.dir ?? '.')
      const stored = loadConfig(dir)
      const pluginNames: string[] =
        stored != null && Array.isArray(stored.plugins) ? stored.plugins : []
      const extraRules: import('./verify/rules/types.js').VerifyPlanRule[] = []
      for (const pkg of pluginNames) {
        try {
          const plugin = await loadPlugin(pkg, dir)
          if (Array.isArray(plugin.verifyPlanRules)) {
            extraRules.push(...plugin.verifyPlanRules)
          }
        } catch (err) {
          process.stderr.write(
            `[arbiter] verify plan: plugin "${pkg}" failed to load — its rules will not run: ${err instanceof Error ? err.message : String(err)}\n`,
          )
        }
      }
      const result = runVerifyPlan({
        file,
        dir,
        ...(opts.reviewer !== undefined ? { reviewer: opts.reviewer } : {}),
        failOnWarn: opts.failOnWarn,
        json: opts.json,
        extraRules,
      })
      process.exit(result.exitCode)
    },
  )

verify
  .command('graph')
  .description(
    'Verify the provenance graph (#259) — fails on orphan invariants (no enforces / no implements)',
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--input <path>', 'Override graph snapshot path (default: <dir>/.arbiter/graph.json)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; input?: string; json: boolean }) => {
    const verifyOpts: import('./commands/graph.js').VerifyGraphOptions = {}
    if (opts.dir !== undefined) verifyOpts.dir = opts.dir
    if (opts.input !== undefined) verifyOpts.input = opts.input
    const result = runVerifyGraph(verifyOpts)
    if (opts.json) {
      jsonOutput(
        'verify graph',
        result.status,
        {
          exitCode: result.exitCode,
          path: result.path,
          totalInv: result.totalInv,
          orphans: result.orphans,
        },
        result.reason !== undefined ? [result.reason] : undefined,
      )
    } else if (result.status === 'ok') {
      process.stdout.write(`verify graph: OK (${result.totalInv} invariant(s) checked, 0 orphan)\n`)
    } else {
      process.stderr.write(`verify graph: FAIL — ${result.reason ?? 'unknown error'}\n`)
      for (const orphan of result.orphans) {
        process.stderr.write(`  orphan: ${orphan.id} — ${orphan.reason}\n`)
      }
    }
    process.exit(result.exitCode)
  })

verify
  .command('tdd <task-id>')
  .description('Verify TDD red-phase evidence for a task — replayable audit (#553)')
  .option('--dir <dir>', 'Target directory / repo root (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((taskId: string, opts: { dir?: string; json: boolean }) => {
    const result = runVerifyTdd({
      taskId,
      json: opts.json,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    } else if (result.status === 'PASS') {
      process.stdout.write(`verify tdd: PASS (${result.checks?.length ?? 0} checks)\n`)
    } else {
      process.stderr.write(`verify tdd: FAIL — ${result.reason ?? 'unknown'}\n`)
    }
    process.exit(result.exitCode)
  })

const graph = program
  .command('graph', { hidden: true })
  .description('Manage the provenance graph (#259)')

graph
  .command('build')
  .description('Build the provenance graph from invariants and write .arbiter/graph.json')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--output <path>', 'Override output path (default: <dir>/.arbiter/graph.json)')
  .option('--format <fmt>', 'Output format: json | dot | mermaid (default: json)', 'json')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; output?: string; format: string; json: boolean }) => {
    const buildOpts: import('./commands/graph.js').GraphBuildOptions = {}
    if (opts.dir !== undefined) buildOpts.dir = opts.dir
    if (opts.output !== undefined) buildOpts.output = opts.output
    buildOpts.format = opts.format as GraphFormat
    const result = runGraphBuild(buildOpts)
    if (opts.json) {
      jsonOutput(
        'graph build',
        result.status,
        {
          exitCode: result.exitCode,
          path: result.path,
          nodes: result.nodes,
          edges: result.edges,
        },
        result.reason !== undefined ? [result.reason] : undefined,
      )
    } else if (result.status === 'ok') {
      process.stdout.write(
        `graph build: wrote ${result.path} (${result.nodes} nodes, ${result.edges} edges)\n`,
      )
    } else {
      process.stderr.write(`graph build: FAIL — ${result.reason ?? 'unknown error'}\n`)
    }
    process.exit(result.exitCode)
  })

program
  .command('trace', { hidden: true })
  .description(
    'Trace provenance from a graph node (#259) — render as json|dot|mermaid (default json)',
  )
  .requiredOption('--from <id>', 'Origin node id (e.g. INV-04)')
  .option('--depth <n>', 'Maximum BFS depth (default: unlimited)', (v: string) =>
    Number.parseInt(v, 10),
  )
  .option('--format <fmt>', 'Output format: json | dot | mermaid (default: json)', 'json')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--input <path>', 'Override graph snapshot path (default: <dir>/.arbiter/graph.json)')
  .action(
    (opts: { from: string; depth?: number; format: string; dir?: string; input?: string }) => {
      const traceOpts: import('./commands/trace.js').TraceOptions = {
        from: opts.from,
        format: opts.format as TraceFormat,
      }
      if (opts.depth !== undefined && !Number.isNaN(opts.depth)) traceOpts.depth = opts.depth
      if (opts.dir !== undefined) traceOpts.dir = opts.dir
      if (opts.input !== undefined) traceOpts.input = opts.input
      const result = runTrace(traceOpts)
      if (result.status === 'ok') {
        process.stdout.write(result.output + '\n')
      } else {
        process.stderr.write(`trace: FAIL — ${result.reason ?? 'unknown error'}\n`)
      }
      process.exit(result.exitCode)
    },
  )

program
  .command('blame', { hidden: true })
  .description(
    'Time-travel governance — show blame timeline for a graph node (#263). Renders as text|json|mermaid|markdown-audit (default text)',
  )
  .requiredOption('--from <id>', 'Node id to blame (e.g. INV-05, FILE:src/auth/service.ts)')
  .option(
    '--format <fmt>',
    'Output format: text | json | mermaid | markdown-audit (default: text)',
    'text',
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--input <path>', 'Override graph snapshot path (default: <dir>/.arbiter/graph.json)')
  .option('--git-dir <path>', 'Git repository directory for log harvesting (default: --dir)')
  .option('--since <duration>', 'Informational: time window for violation query (e.g. 90d)')
  .action(
    (opts: {
      from: string
      format: string
      dir?: string
      input?: string
      gitDir?: string
      since?: string
    }) => {
      const blameOpts: import('./commands/blame.js').BlameOptions = {
        from: opts.from,
        format: opts.format as BlameFormat,
      }
      if (opts.dir !== undefined) blameOpts.dir = opts.dir
      if (opts.input !== undefined) blameOpts.input = opts.input
      if (opts.gitDir !== undefined) blameOpts.gitDir = opts.gitDir
      if (opts.since !== undefined) blameOpts.since = opts.since
      const result = runBlame(blameOpts)
      if (result.status === 'ok') {
        process.stdout.write(result.output + '\n')
      } else {
        process.stderr.write(`blame: FAIL — ${result.reason ?? 'unknown error'}\n`)
      }
      process.exit(result.exitCode)
    },
  )

program
  .command('upgrade-level', { hidden: true })
  .description('Upgrade governance level with a grace period for new gates')
  .option('--target <level>', 'Target level (L2, L3, or L4)')
  .option('--extend', 'Extend an existing active grace period by --days (default: 30)', false)
  // #1607: keep the raw string here (validate in the action) so the error can
  // echo the actual typo; bare `parseInt` silently yielded NaN for `--days abc`.
  .option('--days <n>', 'Grace period length in days (default: 30)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--interactive', 'Guided level selection on a TTY (#1168)', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (opts: {
      target?: string
      extend: boolean
      days?: string
      dir?: string
      interactive: boolean
      json: boolean
    }) => {
      if (opts.interactive && !opts.json && process.stdin.isTTY) {
        void import('./commands/upgrade-level-interactive.js')
          .then(({ runInteractiveUpgradeLevel }) =>
            runInteractiveUpgradeLevel({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) }),
          )
          .catch((err: unknown) => {
            process.stderr.write(`  Error: ${err instanceof Error ? err.message : String(err)}\n`)
            process.exit(1)
          })
        return
      }
      const upgradeOpts: import('./commands/upgrade-level.js').UpgradeLevelOptions = {
        extend: opts.extend,
        json: opts.json,
      }
      if (opts.target) {
        if (opts.target !== 'L2' && opts.target !== 'L3' && opts.target !== 'L4') {
          printCliError(`invalid --target "${opts.target}". Valid values: L2, L3, L4.`)
          getLogger().error('invalid_target', { value: opts.target ?? null })
          process.exit(1)
        }
        upgradeOpts.target = opts.target
      }
      if (opts.days !== undefined) {
        const parsedDays = Number.parseInt(opts.days, 10)
        if (!Number.isInteger(parsedDays) || parsedDays < 1) {
          printCliError(`invalid --days "${opts.days}". Must be a positive integer (>= 1).`)
          getLogger().error('invalid_days', { value: opts.days })
          process.exit(1)
        }
        upgradeOpts.days = parsedDays
      }
      if (opts.dir !== undefined) upgradeOpts.dir = opts.dir
      runUpgradeLevel(upgradeOpts).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`  Error: ${msg}\n`)
        process.exit(1)
      })
    },
  )

const doctor = program
  .command('doctor')
  .description('Diagnose and repair arbiter state')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option(
    '--repair',
    'Auto-release stale .arbiter/.lock files detected by the health check (#824)',
    false,
  )
  .option('--interactive', 'Guided health check with one-key repair on a TTY (#1168)', false)
  .action((opts: { dir?: string; json: boolean; repair: boolean; interactive: boolean }) => {
    if (opts.interactive && !opts.json && process.stdin.isTTY) {
      void import('./commands/doctor-interactive.js')
        .then(({ runInteractiveDoctor }) =>
          runInteractiveDoctor({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) }),
        )
        .catch((err: unknown) => {
          process.stderr.write(`  Error: ${err instanceof Error ? err.message : String(err)}\n`)
          process.exit(1)
        })
      return
    }
    runDoctorHealth({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
      repair: opts.repair,
      ...(_channelFlag !== undefined ? { channelFlag: _channelFlag } : {}),
    })
      .then((result) => {
        if (result.exitCode !== 0) process.exit(result.exitCode)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`  Error: ${msg}\n`)
        process.exit(1)
      })
  })

doctor
  .command('repair-state')
  .description('Re-derive .arbiter-generated.json from arbiter.json (snapshot corruption recovery)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; json: boolean }) => {
    runDoctorRepairState({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    })
      .then((result) => {
        if (result.exitCode !== 0) process.exit(result.exitCode)
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`  Error: ${msg}\n`)
        process.exit(1)
      })
  })

doctor
  .command('recover-lock')
  .description('Force-release a stale .arbiter/.lock file left by a crashed process')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; json: boolean }) => {
    runDoctorRecoverLock({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    })
  })

doctor
  .command('clean')
  .description('Remove arbiter backup files (*.arbiter-backup, .arbiter-generated.json.bak.*)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--dry-run', 'List files without deleting', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; dryRun: boolean; json: boolean }) => {
    try {
      runDoctorClean({
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        dryRun: opts.dryRun,
        json: opts.json,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    }
  })

const integrations = program
  .command('integrations', { hidden: true })
  .description('Inspect agent-tool integrations (skills, plugins) detected for this project')

integrations
  .command('list')
  .description('List detected integrations and recommend missing ones (doctor advisory target)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; json: boolean }) => {
    runIntegrationsList({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    })
  })

const task = program.command('task').description('Manage task lifecycle state')

task
  .command('resume')
  .description('Print recovery instructions for the current task phase')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runTaskResume({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) })
  })

task
  .command('advance')
  .description('Advance (or reverse) the task lifecycle phase')
  .requiredOption(
    '--to <phase>',
    'Target phase (preflight|plan|red-team-review|red|green|refactor|verification|close|complete|red-team-rework)',
  )
  .option('--reverse', 'Allow backward phase transitions', false)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option(
    '--skip-plan-review',
    'Bypass the plan-review gate (writes audit record + WARNING)',
    false,
  )
  .option('--post-clear', 'Signal post-/clear re-entry (equivalent to ARBITER_POST_CLEAR=1)', false)
  .option(
    '--skip-budget',
    'Skip the token budget assertion on post-clear re-entry (writes warning)',
    false,
  )
  .action(
    (opts: {
      to: string
      reverse: boolean
      dir?: string
      skipPlanReview: boolean
      postClear: boolean
      skipBudget: boolean
    }) => {
      try {
        runTaskAdvance({
          to: opts.to as TaskPhase,
          reverse: opts.reverse,
          skipPlanReview: opts.skipPlanReview,
          postClear: opts.postClear,
          skipBudget: opts.skipBudget,
          ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        })
      } catch (err) {
        if (err instanceof HandoffRequiredError) {
          process.stderr.write(err.message + '\n')
          process.exit(78)
        }
        if (err instanceof BudgetBreachError) {
          process.stderr.write(err.message + '\n')
          process.exit(79)
        }
        throw err
      }
    },
  )

task
  .command('recover')
  .description('Print 3-layer recovery context for the current task (#694)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--task <id>', 'Task id (default: the active task)')
  .action((opts: { dir?: string; task?: string }) => {
    runTaskRecover({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      ...(opts.task !== undefined ? { taskId: opts.task } : {}),
    })
  })

task
  .command('record-red')
  .description('Record TDD red-phase evidence: run a failing test and capture evidence (#551)')
  .requiredOption('--test-path <path>', 'Repo-relative path to the failing test file')
  .option('--dir <dir>', 'Target directory / repo root (default: current directory)')
  .action((opts: { testPath: string; dir?: string }) => {
    const result = runTaskRecordRed({
      testPath: opts.testPath,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
    if (result.ok) {
      process.stdout.write(
        `record-red: OK (framework=${result.framework})\nevidence: ${result.evidencePath}\n`,
      )
    } else {
      process.stderr.write(`record-red: FAIL — ${result.reason}\n`)
      process.exit(1)
    }
  })

task
  .command('record-tech-debt')
  .description('File a tech-debt GitHub issue and persist evidence (#702)')
  .requiredOption('--description <text>', 'Short description of the tech-debt finding')
  .option(
    '--triggered-by <task-id>',
    'Task ID that triggered this debt filing (default: the active task)',
  )
  .option('--dir <dir>', 'Target directory / repo root (default: current directory)')
  .action((opts: { description: string; triggeredBy?: string; dir?: string }) => {
    const result = runTaskRecordTechDebt({
      description: opts.description,
      ...(opts.triggeredBy !== undefined ? { triggeredBy: opts.triggeredBy } : {}),
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
    if (result.ok) {
      process.stdout.write(`record-tech-debt: OK (issue #${result.issueNumber})\n`)
    } else {
      process.stderr.write(`record-tech-debt: FAIL — ${result.reason}\n`)
      process.exit(1)
    }
  })

task
  .command('init')
  .description('Initialise / update the unified task document (#1206)')
  .option('--id <id>', 'Task id, e.g. #1206')
  .option('--tier <tier>', 'Task tier (XS|S|Standard)')
  .option('--plan <path>', 'Repo-relative path to the plan file')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { id?: string; tier?: string; plan?: string; dir?: string }) => {
    runTaskInit({
      ...(opts.id !== undefined ? { id: opts.id } : {}),
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      ...(opts.plan !== undefined ? { plan: opts.plan } : {}),
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
  })

task
  .command('get')
  .description('Print a single task-state field for shell consumers (#1206)')
  .requiredOption('--field <field>', 'phase|taskId|tier|plan|tddPhase|lastAction|nextAction')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { field: string; dir?: string }) => {
    runTaskGet({ field: opts.field, ...(opts.dir !== undefined ? { dir: opts.dir } : {}) })
  })

program
  .command('mark', { hidden: true })
  .description('Pinpoint: snapshot the step-cursor so a mid-task /clear resumes exactly (#1206)')
  .option('--next <action>', 'The exact next sub-step to resume on')
  .option('--last <action>', 'The sub-step just completed')
  .option('--tdd <phase>', 'TDD sub-phase (RED|GREEN|REFACTOR)')
  .option('--task <id>', 'Set/override the active task id')
  .option('--digest <line>', 'One-line progress digest for log.md')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(
    (opts: {
      next?: string
      last?: string
      tdd?: string
      task?: string
      digest?: string
      dir?: string
    }) => {
      let tddPhase: 'RED' | 'GREEN' | 'REFACTOR' | undefined
      if (opts.tdd !== undefined) {
        const upper = opts.tdd.toUpperCase()
        if (!isTddPhase(upper)) {
          process.stderr.write(`Invalid --tdd value "${opts.tdd}". Valid: RED, GREEN, REFACTOR\n`)
          process.exit(2)
        }
        tddPhase = upper
      }
      runTaskMark({
        ...(opts.next !== undefined ? { next: opts.next } : {}),
        ...(opts.last !== undefined ? { last: opts.last } : {}),
        ...(tddPhase !== undefined ? { tddPhase } : {}),
        ...(opts.task !== undefined ? { taskId: opts.task } : {}),
        ...(opts.digest !== undefined ? { digest: opts.digest } : {}),
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      })
    },
  )

/**
 * #1263/#1291 — overnight multi-issue mode with the wave/batch autonomy gate:
 * wave-batch is an L3 behavior (ADR-093 §4), refused below it.
 */
function runShipBatchCommand(
  batch: string,
  dir: string | undefined,
  overrides: Record<string, string>,
): void {
  const root = dir ?? process.cwd()
  const profile = resolveShipProfile(root, Object.keys(overrides).length > 0 ? { overrides } : {})
  if (!autonomyAllows(profile.autonomy, 'wave-batch')) {
    process.stderr.write(
      `ship --batch refused: wave/batch requires automation.autonomy L3 (or --autonomy L3); resolved ${profile.autonomy}\n`,
    )
    process.exit(1)
  }
  const issueIds = parseIssueList(batch)
  const { lines } = runShipBatch(issueIds, { dir: root })
  process.stdout.write(lines.join('\n') + '\n')
}

program
  .command('ship [id]')
  .description('Orchestrate an issue → reviewed, merged PR over the existing engine (#1206)')
  .option('--tier <tier>', 'Task tier (XS|S|Standard)')
  .option(
    '--autonomy <level>',
    'Per-run autonomy override (L0|L1|L2|L3) — beats arbiter.json automation.autonomy (#1291)',
    (v: string) => {
      if (!['L0', 'L1', 'L2', 'L3'].includes(v)) {
        throw new Error('--autonomy must be one of L0|L1|L2|L3')
      }
      return v
    },
  )
  .option(
    '--set <path=value>',
    'Per-run override of an overridable config path (repeatable, ADR-094). ' +
      'Gated by OVERRIDABLE_PATHS; persists to the session layer so it survives /clear. ' +
      'e.g. --set automation.autonomy=L3',
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option('--advance', 'Advance to the next phase (runs that phase gate; fails if red)', false)
  .option('--skip-plan-review', 'Bypass the plan-review gate on advance', false)
  .option('--post-clear', 'Signal post-/clear re-entry on advance', false)
  .option('--skip-budget', 'Skip the budget assertion on advance', false)
  .option(
    '--units <n>',
    'Implementation unit count from the plan — drives the size-driven clear decision',
    (v: string) => {
      const n = parseInt(v, 10)
      if (isNaN(n) || n <= 0) throw new Error('--units must be a positive integer')
      return n
    },
  )
  .option(
    '--batch <issues>',
    'Overnight multi-issue mode (#1263): comma-separated issue numbers to ship ' +
      'unattended, one fresh clean-context sub-agent per issue, with per-issue STOP ' +
      'isolation; aggregates a batch-report-<date>.json',
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(
    (
      id: string | undefined,
      opts: {
        tier?: string
        autonomy?: string
        set: string[]
        advance: boolean
        skipPlanReview: boolean
        postClear: boolean
        skipBudget: boolean
        units?: number
        batch?: string
        dir?: string
      },
    ) => {
      try {
        // #1305 — desugar `--autonomy` + parse `--set` into ONE validated per-run overrides map,
        // gated by OVERRIDABLE_PATHS and persisted to the session layer (survives /clear).
        const overrides = buildShipOverrides(opts.dir ?? process.cwd(), {
          sets: opts.set,
          ...(opts.autonomy !== undefined ? { autonomy: opts.autonomy } : {}),
        })
        // #1263 — overnight multi-issue mode. When --batch is present, ship every
        // listed issue with per-issue STOP isolation (one issue's failure never
        // aborts the batch) and write a date-stamped batch report. The single-id
        // path below is left UNTOUCHED when --batch is absent (regression discipline).
        if (opts.batch !== undefined) {
          runShipBatchCommand(opts.batch, opts.dir, overrides)
          return
        }
        // #1260 — ALWAYS compute the ship SIZE (no flag). Size auto-selects the
        // review TIER (which drives the review-agent COUNT + the orthogonal VERTICAL
        // breadth) whenever `--tier` is absent; `--tier` stays a rare override.
        // Resolution is fail-safe (explicit > diff > units > widest-default) and
        // never throws, so it can never block the ship.
        const size = resolveShipTier({
          ...(opts.tier !== undefined ? { explicitTier: opts.tier } : {}),
          ...(opts.units !== undefined ? { units: opts.units } : {}),
          ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        })
        const effectiveTier = opts.tier ?? size.tier
        const result = runTaskShip({
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
          ...(id !== undefined ? { taskId: id } : {}),
          tier: effectiveTier,
          advance: opts.advance,
          advanceOpts: {
            skipPlanReview: opts.skipPlanReview,
            postClear: opts.postClear,
            skipBudget: opts.skipBudget,
            ...(opts.units !== undefined ? { units: opts.units } : {}),
          },
          ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        })
        const lines = buildShipStepLines(result, size)
        // #1259 — ALWAYS compute issue affinity (no flag); surface it + a
        // low-affinity warning in the step output. Never blocks.
        lines.push(...shipAffinityLines(id, opts.dir))
        process.stdout.write(lines.join('\n') + '\n')
      } catch (err) {
        if (err instanceof HandoffRequiredError) {
          process.stderr.write(err.message + '\n')
          process.exit(78)
        }
        if (err instanceof BudgetBreachError) {
          process.stderr.write(err.message + '\n')
          process.exit(79)
        }
        throw err
      }
    },
  )

program
  .command('ship-on-red', { hidden: true })
  .description(
    'Fix-on-red engine surface (#1289): compute the next action for a red gate — ' +
      'fix (with reproduce-before-push) on the first strike, escalate to needs-human on the second',
  )
  .requiredOption('--check <name>', 'The gate/check that went red (slug, e.g. unit-test)')
  .requiredOption('--log-file <path>', 'Path to the captured failed-gate log')
  .option('--id <id>', 'Task id (e.g. #1289); defaults to the active task')
  .option(
    '--autonomy <level>',
    'Per-run autonomy override (L0|L1|L2|L3) — gates the fix decision (#1291)',
    (v: string) => {
      if (!['L0', 'L1', 'L2', 'L3'].includes(v)) {
        throw new Error('--autonomy must be one of L0|L1|L2|L3')
      }
      return v
    },
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(
    (opts: { check: string; logFile: string; id?: string; autonomy?: string; dir?: string }) => {
      const result = runShipFixOnRed({
        check: opts.check,
        logFile: opts.logFile,
        ...(opts.id !== undefined ? { id: opts.id } : {}),
        ...(opts.autonomy !== undefined ? { autonomy: opts.autonomy } : {}),
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      })
      if (result.ok) {
        process.stdout.write(result.lines.join('\n') + '\n')
      } else {
        process.stderr.write(`ship-on-red: FAIL — ${result.reason}\n`)
        process.exit(1)
      }
    },
  )

const plugin = program
  .command('plugin', { hidden: true })
  .description('[BETA] Manage arbiter plugins (API not yet stable)')

plugin
  .command('add <pkg>')
  .description('Add a plugin to this project (validates it is resolvable first)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (pkg: string, opts: { dir?: string; json: boolean }) => {
    await runPluginAdd({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      pkg,
      json: opts.json,
    })
  })

plugin
  .command('remove <pkg>')
  .description('Remove a plugin from this project')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (pkg: string, opts: { dir?: string; json: boolean }) => {
    await runPluginRemove({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      pkg,
      json: opts.json,
    })
  })

plugin
  .command('list')
  .description('List plugins configured for this project')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (opts: { dir?: string; json: boolean }) => {
    await runPluginList({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    })
  })

plugin
  .command('init <name>')
  .description('Scaffold a new plugin package at ./arbiter-plugin-<name>/ (API v1.1)')
  .option('--dir <dir>', 'Parent directory for the new package (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (name: string, opts: { dir?: string; json: boolean }) => {
    await runPluginInit(name, {
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    })
  })

const work = program
  .command('work', { hidden: true })
  .description('Manage work units via decomposition backend')

work
  .command('list')
  .description('List work units')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--status <status>', 'Filter by status: open, in_progress, blocked, done')
  .action(async (opts: { dir?: string; status?: string }) => {
    await runWorkList({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      ...(opts.status ? { status: opts.status as WorkUnitStatus } : {}),
    })
  })

work
  .command('create')
  .description('Create a new work unit')
  .requiredOption('--title <title>', 'Work unit title')
  .option('--body <body>', 'Work unit body/description')
  .option('--label <labels>', 'Comma-separated labels')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(async (opts: { title: string; body?: string; label?: string; dir?: string }) => {
    await runWorkCreate({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      title: opts.title,
      ...(opts.body ? { body: opts.body } : {}),
      ...(opts.label ? { labels: opts.label.split(',').map((l) => l.trim()) } : {}),
    })
  })

work
  .command('show <id>')
  .description('Show details of a work unit')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(async (id: string, opts: { dir?: string }) => {
    await runWorkShow({
      id,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
  })

work
  .command('close <id>')
  .description('Mark a work unit as done')
  .option('--reason <reason>', 'Reason for closing')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(async (id: string, opts: { reason?: string; dir?: string }) => {
    await runWorkClose({
      id,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    })
  })

work
  .command('advance <id>')
  .description('Advance a work unit to a new lifecycle phase')
  .requiredOption(
    '--phase <phase>',
    'Target phase (preflight|plan|implementation|verification|complete)',
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(async (id: string, opts: { phase: string; dir?: string }) => {
    await runWorkAdvance({
      id,
      phase: opts.phase as WorkUnitPhase,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
  })

program
  .command('harness', { hidden: true })
  .description('Run the four SSOT gates (ssot-core, doc-links, knowledge-map, canonical-paths)')
  .option('--fast', 'Stop at first gate failure', false)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { fast: boolean; dir?: string }) => {
    const result = runHarness({
      fast: opts.fast,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
    process.exit(result.exitCode)
  })

program
  .command('knowledge-map', { hidden: true })
  .description('Regenerate KNOWLEDGE_MAP.md line counts from current doc sizes')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runKnowledgeMapUpdate({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
  })

// ── ci (#261) ─────────────────────────────────────────────────────────────────

const ci = program
  .command('ci', { hidden: true })
  .description('Governance-aware CI planning (#261)')

ci.command('plan')
  .description('Compute affected invariants and required gates from changed files')
  .option('--diff <ref>', 'Git ref to diff against (informational; use --files for testability)')
  .option('--files <paths>', 'Comma-separated list of changed file paths')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--format <fmt>', 'Output format: json | mermaid (default: json)', 'json')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (opts: { diff?: string; files?: string; dir?: string; format: string; json: boolean }) => {
      const changedFiles = opts.files
        ? opts.files
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
        : []
      const format = opts.format === 'mermaid' ? 'mermaid' : 'json'
      const result = runCiPlan({
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(opts.diff !== undefined ? { diff: opts.diff } : {}),
        changedFiles,
        format,
      })
      if (opts.json || format === 'json') {
        jsonOutput(
          'ci plan',
          result.status,
          {
            exitCode: result.exitCode,
            plan: result.plan,
            ...(result.mermaid !== undefined ? { mermaid: result.mermaid } : {}),
          },
          result.reason !== undefined ? [result.reason] : undefined,
        )
      } else if (result.mermaid !== undefined) {
        process.stdout.write(result.mermaid)
      }
      process.exit(result.exitCode)
    },
  )

const agentRules = program
  .command('agent-rules', { hidden: true })
  .description('Export or verify AI agent governance rules (#265)')

agentRules
  .command('export')
  .description('Export governance rules to a target AI agent format')
  .option('--target <target>', 'Target agent format: claude (others experimental)', 'claude')
  .option('--all', 'Emit all targets to their standard paths', false)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (opts: { target: string; all: boolean; dir?: string; json: boolean }) => {
    const result = runAgentRulesExport({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      target: opts.target,
      all: opts.all,
      json: opts.json,
    })
    if (opts.json) {
      const { jsonOutput } = await import('./utils/json-output.js')
      jsonOutput('agent-rules export', result.status, {
        exitCode: result.exitCode,
        target: opts.target,
        fallbackUsed: result.fallbackUsed ?? false,
        ...(result.filesWritten !== undefined ? { filesWritten: result.filesWritten } : {}),
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
      })
    } else if (result.status === 'ok') {
      if (result.filesWritten !== undefined) {
        for (const p of result.filesWritten) {
          process.stdout.write(`  wrote ${p}\n`)
        }
      } else {
        process.stdout.write(result.content)
      }
    } else {
      process.stderr.write(`agent-rules export: FAIL — ${result.reason ?? 'unknown error'}\n`)
    }
    process.exit(result.exitCode)
  })

agentRules
  .command('verify')
  .description('Verify that agent rule files match the current graph (drift detection)')
  .option('--target <target>', 'Target agent format: claude (others experimental)', 'claude')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (opts: { target: string; dir?: string; json: boolean }) => {
    const result = runAgentRulesVerify({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      target: opts.target,
      json: opts.json,
    })
    if (opts.json) {
      const { jsonOutput } = await import('./utils/json-output.js')
      jsonOutput('agent-rules verify', result.status, {
        exitCode: result.exitCode,
        target: result.target,
        drift: result.drift ?? false,
        missing: result.missing ?? false,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
      })
    } else if (result.status === 'ok') {
      const msg = result.missing === true ? 'OK (not yet exported)' : 'OK (no drift)'
      process.stdout.write(`agent-rules verify: ${msg}\n`)
    } else {
      process.stderr.write(`agent-rules verify: DRIFT — ${result.reason ?? 'unknown error'}\n`)
    }
    process.exit(result.exitCode)
  })

ci.command('verify-plan')
  .description('Verify that all required gates from a ci plan actually ran')
  .requiredOption('--plan <path>', 'Path to ci plan JSON file')
  .requiredOption('--ci-result <path>', 'Path to CI result JSON file ({"gates":[...]})')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (opts: { plan: string; ciResult: string; json: boolean }) => {
    const { readFileSync: rfs } = await import('node:fs')
    const plan = JSON.parse(rfs(opts.plan, 'utf-8')) as import('./commands/ci.js').CiPlan
    const ciResult = JSON.parse(rfs(opts.ciResult, 'utf-8')) as { gates: string[] }
    const result = runCiVerifyPlan({ plan, ciResult })
    if (opts.json) {
      jsonOutput(
        'ci verify-plan',
        result.status,
        { exitCode: result.exitCode, missingGates: result.missingGates },
        result.reason !== undefined ? [result.reason] : undefined,
      )
    } else if (result.status === 'ok') {
      process.stdout.write(`ci verify-plan: OK\n`)
    } else {
      process.stderr.write(`ci verify-plan: FAIL — ${result.reason ?? 'unknown error'}\n`)
    }
    process.exit(result.exitCode)
  })

// ── review diff (#262) ───────────────────────────────────────────────────────

review
  .command('diff')
  .description('Semantic diff between two graph snapshots (#262)')
  .option(
    '--base <path>',
    'Base graph snapshot path (default: reads from stdin or .arbiter/graph-base.json)',
  )
  .option('--head <path>', 'Head graph snapshot path (default: .arbiter/graph.json)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--post-pr <number>', 'Post result as GitHub PR comment')
  .action(
    async (opts: {
      base?: string
      head?: string
      dir?: string
      json: boolean
      postPr?: string
    }) => {
      const { existsSync: efs } = await import('node:fs')
      const { resolve: res, join: pjoin } = await import('node:path')
      const { loadGraphSnapshot: loadGraph } = await import('./graph/load.js')
      const dir = res(opts.dir ?? '.')

      const headPath =
        opts.head !== undefined ? res(opts.head) : pjoin(dir, '.arbiter', 'graph.json')
      const basePath =
        opts.base !== undefined ? res(opts.base) : pjoin(dir, '.arbiter', 'graph-base.json')

      if (!efs(headPath)) {
        process.stderr.write(`review diff: FAIL — head graph not found at ${headPath}\n`)
        process.exit(2)
      }
      if (!efs(basePath)) {
        // No base — use empty snapshot
        process.stderr.write(
          `review diff: WARN — base graph not found at ${basePath}, using empty base\n`,
        )
      }

      // Route both graphs through the SSOT loader (#1593): a valid-JSON-but-
      // malformed graph.json must yield the advertised `review diff: FAIL` /
      // exit 2, not an uncaught `snapshot.nodes is not iterable`.
      const headOutcome = loadGraph(headPath)
      if (!headOutcome.ok) {
        process.stderr.write(`review diff: FAIL — ${headOutcome.reason}\n`)
        process.exit(2)
      }
      let base: import('./graph/model.js').GraphSnapshot = { nodes: [], edges: [] }
      if (efs(basePath)) {
        const baseOutcome = loadGraph(basePath)
        if (!baseOutcome.ok) {
          process.stderr.write(`review diff: FAIL — ${baseOutcome.reason}\n`)
          process.exit(2)
        }
        base = baseOutcome.snapshot
      }

      const result = runReviewDiff({ base, head: headOutcome.snapshot })

      if (opts.json) {
        jsonOutput(
          'review diff',
          result.status,
          {
            exitCode: result.exitCode,
            recommendation: result.recommendation,
            risk_delta: result.risk_delta,
            changes: result.changes,
            summary: result.summary,
          },
          result.reason !== undefined ? [result.reason] : undefined,
        )
      } else {
        process.stdout.write(renderMarkdown(result) + '\n')
      }

      if (opts.postPr !== undefined) {
        const { runCli: rc } = await import('./utils/run-cli.js')
        const markdown = renderMarkdown(result)
        try {
          rc('gh', ['pr', 'comment', opts.postPr, '--body', markdown])
        } catch (err) {
          process.stderr.write(
            `review diff: failed to post PR comment: ${err instanceof Error ? err.message : String(err)}\n`,
          )
        }
      }

      process.exit(result.exitCode)
    },
  )

program
  .command('explain [code]', { hidden: true })
  .description('Show detailed explanation for an error code, INV-NN invariant, or CANON-NN rule')
  .option('--format <format>', 'Output format: text (default) or json')
  .option('--list', 'List all known codes grouped by category')
  .option(
    '--handoff <topic>',
    'Scaffold HANDOFF-<TOPIC>.md from the executable-handoff template (#1817 A7)',
  )
  .option('--out <dir>', 'Target directory for --handoff (default: cwd)')
  .action(
    (
      code: string | undefined,
      opts: { format?: string; list?: boolean; handoff?: string; out?: string },
    ) => {
      const result = runExplain(code ?? '', opts)
      if (result.output) process.stdout.write(result.output)
      if (result.error) process.stderr.write(result.error)
      if (result.exitCode !== 0) process.exit(result.exitCode)
    },
  )

// ── kit — read-only kit catalog commands (--experimental.kit) ─────────────────

function getActiveExperimentalFlags(): Record<string, boolean> {
  try {
    return JSON.parse(process.env['ARBITER_EXPERIMENTAL'] ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

const kit = program
  .command('kit', { hidden: true })
  .description('Cross-stack governance kit commands (requires --experimental.kit)')

kit.hook('preAction', () => {
  if (!isEnabled('kit', getActiveExperimentalFlags())) {
    process.stderr.write(
      'arbiter: "kit" requires --experimental.kit. Run `arbiter experiments list` to see available experiments.\n',
    )
    process.exit(1)
  }
  // #1151: fail-closed against real kit state, not just the feature flag.
  const severity = enforceKitGate()
  if (severity > 0) process.exit(severity)
})

kit
  .command('list')
  .description('List kit dimensions')
  .addOption(
    new Option('--format <fmt>', 'Output format')
      .choices(['table', 'json', 'csv'])
      .default('table'),
  )
  .addOption(
    new Option('--filter <filter>', 'Filter dimensions')
      .choices(['gaps', 'covered', 'partial', 'missing', 'all'])
      .default('all'),
  )
  .addOption(
    new Option('--stack <stack>', 'Filter by stack').choices([
      'java',
      'typescript',
      'python',
      'go',
      'rust',
    ]),
  )
  .addOption(new Option('--tml <tml>', 'Filter by TML level').choices(['L1', 'L2', 'L3', 'L4']))
  .action((opts: { format: string; filter: string; stack?: string; tml?: string }) => {
    runKitList({
      format: opts.format as KitListFormat,
      filter: opts.filter as KitListFilter,
      ...(opts.stack !== undefined && { stack: opts.stack as Stack }),
      ...(opts.tml !== undefined && { tml: opts.tml as 'L1' | 'L2' | 'L3' | 'L4' }),
    })
  })

kit
  .command('show <id>')
  .description('Show details for a kit dimension by ID (e.g. N01)')
  .action((id: string) => {
    runKitShow(id)
  })

kit
  .command('explain <id>')
  .description('Explain a kit dimension with per-stack projection')
  .action((id: string) => {
    runKitExplain(id)
  })

kit
  .command('validate')
  .description('Validate kit catalog: schema, parity, and redaction (requires --experimental.kit)')
  .action(() => {
    runKitValidate()
  })

kit
  .command('generate')
  .description('Generate per-dimension reference docs (requires --experimental.kit)')
  .option('--out <dir>', 'output directory', 'docs/REFERENCE')
  .option('--force', 'overwrite user-edited files')
  .option('--prune', 'remove orphan dim-*.md files not in current catalog')
  .action((opts: { out?: string; force?: boolean; prune?: boolean }) => {
    runKitGenerate(opts)
  })

kit
  .command('install')
  .description(
    'Run the 6-phase kit install lifecycle: DETECT → MEASURE → SCAFFOLD → ASSESS → PLAN → VERIFY',
  )
  .option('--target-dir <dir>', 'Target project directory', process.cwd())
  .option('--language <lang>', 'Project language (auto-detected from the repo if omitted)')
  .addOption(
    new Option('--brownfield-class <cls>', 'Brownfield class (auto-detected if omitted)')
      .choices(['gold', 'light', 'medium', 'heavy'])
      .default('gold'),
  )
  .option('--dry-run', 'Skip file writes (scaffold phase reports only)', false)
  .option('--emit-issues', 'Create GitHub issues for W1 dims via gh CLI', false)
  .option('--report-path <path>', 'Write audit report to this path (default: no report)')
  .action(
    async (opts: {
      targetDir: string
      language?: string
      brownfieldClass: string
      dryRun: boolean
      emitIssues: boolean
      reportPath?: string
    }) => {
      const result = await runKitInstall({
        targetDir: opts.targetDir,
        ...(opts.language !== undefined ? { language: opts.language } : {}),
        brownfieldClass: opts.brownfieldClass as BrownfieldClass,
        dryRun: opts.dryRun,
        emitIssues: opts.emitIssues,
        ...(opts.reportPath !== undefined ? { reportPath: opts.reportPath } : {}),
      })
      for (const phase of result.phases) {
        process.stdout.write(`[${phase.phase}] ${phase.output}\n`)
      }
      // #1643: a partial scaffold failure (some generators failed) must surface
      // its per-failure detail and exit non-zero — matching `arbiter update`'s
      // fail-closed semantics. Previously `generatorErrors` was dead output: the
      // caller never read it, so a half-installed kit exited 0 with no diagnostic.
      if (result.generatorErrors?.length) {
        process.stderr.write(
          `[kit install] SCAFFOLD failed — ${result.generatorErrors.length} generator(s):\n`,
        )
        for (const line of result.generatorErrors) {
          process.stderr.write(`  - ${line}\n`)
        }
        process.exit(2)
      }
      if (!result.ok) {
        process.stderr.write(`[kit install] ${result.error ?? 'unknown error'}\n`)
        process.exit(1)
      }
    },
  )

// ── feature-matrix — export Product-Truth RTM ─────────────────────────────────
const featureMatrix = program
  .command('feature-matrix', { hidden: true })
  .description('Feature/RTM matrix commands (INV-112)')

featureMatrix
  .command('export')
  .description('Export docs/PRODUCT/FEATURE_MATRIX.md to CSV or xlsx')
  .option('--format <fmt>', 'Output format: csv or xlsx', 'csv')
  .option('--out <path>', 'Output file path', 'feature-matrix.csv')
  .option('--matrix <path>', 'Path to FEATURE_MATRIX.md (default: docs/PRODUCT/FEATURE_MATRIX.md)')
  .action(async (opts: { format: string; out: string; matrix?: string }) => {
    const fmt = opts.format
    if (fmt !== 'csv' && fmt !== 'xlsx') {
      process.stderr.write(`Error: --format must be csv or xlsx (got "${fmt}")\n`)
      process.exit(2)
    }
    await runFeatureMatrixExport({
      format: fmt,
      out: opts.out,
      ...(opts.matrix !== undefined ? { matrixPath: opts.matrix } : {}),
    })
    process.stdout.write(`  feature-matrix: exported to ${opts.out}\n`)
  })

// ── conformance — gold-pattern adherence scorecard ────────────────────────────
/** Shared action for both `conformance` and its alias `adherence`. */
function conformanceAction(opts: {
  dir?: string
  failOn?: string
  json?: boolean
  strict?: boolean
  check?: boolean
  updateBaseline?: boolean
  markdown?: boolean
}): void {
  const failOn = opts.failOn === 'partial' ? 'partial' : 'fail'
  const result = runConformance({
    ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    failOn,
    strict: opts.strict ?? false,
    check: opts.check ?? false,
    updateBaseline: opts.updateBaseline ?? false,
  })

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } else if (opts.markdown) {
    process.stdout.write(renderConformanceMd(result, result.dimensions) + '\n')
  } else {
    const summary = computeSummary(result.dimensions)
    process.stdout.write(renderConformanceText(result.dimensions, summary) + '\n')
  }
  if (!opts.json && !opts.markdown) {
    process.stdout.write('See CONFORMANCE.md for full scorecard\n')
  }
  process.exit(result.exitCode)
}

const conformanceCmd = program
  .command('conformance', { hidden: true })
  .description('Score a project against the arbiter gold standard (#1369)')
  .option('--dir <dir>', 'Project root to evaluate (default: current directory)')
  .option('--fail-on <level>', 'Exit 1 on: fail (default) or partial (stricter)', 'fail')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--strict', 'Exit 1 if any NV (not-verified) dimensions exist', false)
  .option('--check', 'Ratchet check: exit 1 if score dropped vs baseline', false)
  .option('--update-baseline', 'Update baseline when score rises; no-op when equal', false)
  .option('--markdown', 'Emit GFM markdown table output', false)
  .action(conformanceAction)

// `adherence` is an alias for `conformance`
program
  .command('adherence', { hidden: true })
  .description('Alias for `conformance` — gold-pattern adherence scorecard (#1397)')
  .option('--dir <dir>', 'Project root to evaluate (default: current directory)')
  .option('--fail-on <level>', 'Exit 1 on: fail (default) or partial (stricter)', 'fail')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--strict', 'Exit 1 if any NV (not-verified) dimensions exist', false)
  .option('--check', 'Ratchet check: exit 1 if score dropped vs baseline', false)
  .option('--update-baseline', 'Update baseline when score rises; no-op when equal', false)
  .option('--markdown', 'Emit GFM markdown table output', false)
  .action(conformanceAction)

// Suppress unused variable lint warning (conformanceCmd is registered via side effects)
void conformanceCmd

// ── help (#1770 T5) ───────────────────────────────────────────────────────────
// Replaces the built-in help command (disabled above via program.helpCommand(false))
// so `arbiter help --all` can list experimental (hidden) commands. Registered hidden
// itself so the public surface stays at exactly 11 commands.
program
  .command('help [command]', { hidden: true })
  .description('Display help for a command')
  .option('--all', 'Also list experimental (hidden) commands', false)
  .action((commandName: string | undefined, opts: { all: boolean }) => {
    if (opts.all) {
      const helpRenderer = program.createHelp()
      const visibleNames = new Set(helpRenderer.visibleCommands(program).map((c) => c.name()))
      const hidden = program.commands.filter(
        (c) => !visibleNames.has(c.name()) && c.name() !== 'help',
      )
      process.stdout.write(program.helpInformation())
      process.stdout.write('\nExperimental commands:\n')
      const width = Math.max(...hidden.map((c) => c.name().length))
      for (const cmd of hidden.slice().sort((a, b) => a.name().localeCompare(b.name()))) {
        process.stdout.write(
          `  ${cmd.name().padEnd(width + 2)}${cmd.summary() || cmd.description()}\n`,
        )
      }
      return
    }
    if (commandName) {
      const sub = program.commands.find(
        (c) => c.name() === commandName || c.aliases().includes(commandName),
      )
      if (sub) sub.help()
      process.stderr.write(`error: unknown command '${commandName}'\n`)
      process.exit(1)
    }
    program.help()
  })

function _writeArbiterError(err: ArbiterError, prefix = 'Error'): void {
  process.stderr.write(`\n${prefix} [${err.code}]: ${err.message}\n`)
  if (err.hint) process.stderr.write(`  Hint: ${err.hint}\n`)
  if (err.docUrl) process.stderr.write(`  Docs: ${err.docUrl}\n`)
  process.stderr.write(`\nRun \`arbiter explain ${err.code}\` for more detail.\n`)
  if (_verbose && err.stack) process.stderr.write(`\n${err.stack}\n`)
}

function _writeStackIfVerbose(err: Error): void {
  if (_verbose && err.stack) process.stderr.write(`\n${err.stack}\n`)
}

function _handleTopLevelError(err: unknown): void {
  if (err instanceof FatalError) {
    if (err.recoverableContext?.length) {
      process.stderr.write(
        `\n  Recoverable errors before fatal:\n${err.recoverableContext.map((w) => `    - ${w}`).join('\n')}\n`,
      )
    }
    _writeArbiterError(err, 'Fatal error')
    process.exit(2)
  } else if (err instanceof ConfigError) {
    _writeArbiterError(err, 'Config error')
    process.exit(78)
  } else if (err instanceof RecoverableError) {
    _writeArbiterError(err)
    process.exit(1)
  } else if (err instanceof SnapshotChecksumError) {
    process.stderr.write(`\nChecksum error: ${err.message}\n`)
    process.stderr.write(
      '  The .arbiter-generated.json snapshot is corrupt. Delete it and re-run `arbiter update`.\n',
    )
    _writeStackIfVerbose(err)
    process.exit(2)
  } else if (err instanceof ArbiterError) {
    _writeArbiterError(err)
  } else if (err instanceof UserFacingError) {
    process.stderr.write(`Error: ${err.message}\n`)
    _writeStackIfVerbose(err)
  } else if (err instanceof Error) {
    process.stderr.write(`Unexpected error: ${err.message}\n`)
    if (_verbose) process.stderr.write(`${err.stack ?? ''}\n`)
  } else {
    process.stderr.write(`Unexpected error: ${String(err)}\n`)
  }
  process.exit(1)
}

async function _main(): Promise<void> {
  await _startProfileIfRequested()
  try {
    await program.parseAsync()
  } finally {
    if (_profilerHandle !== null) {
      try {
        const path = await _profilerHandle.stop()
        getLogger().info('profiler.written', { path })
      } catch (err) {
        getLogger().warn('profiler.stop_failed', undefined, String(err))
      }
    }
  }
}

_main().catch(_handleTopLevelError)
