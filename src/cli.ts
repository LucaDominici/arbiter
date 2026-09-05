#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { runInit } from './commands/init.js'
import { resolvePresetOption } from './wizard/presets.js'
import { runUpdate } from './commands/update.js'
import { runDiff } from './commands/diff.js'
import { runObsidian } from './commands/obsidian.js'
import { runConfigure } from './commands/configure.js'
import { runSettings } from './commands/settings.js'
import { runMethodStatus } from './commands/method.js'
import {
  runWorktreeOpen,
  runWorktreeClose,
  runWorktreeList,
  runWorktreeRelink,
} from './commands/worktree.js'
import { runWorktreePrune } from './commands/worktree-prune.js'
import { runGateExec } from './commands/gate-exec.js'
import { runVerify, runVerifyEvidence } from './commands/verify.js'
import { formatProvenance, type Provenance } from './evidence/provenance.js'
import { runGoldAudit } from './commands/gold-audit.js'
import { runDocSet } from './commands/doc-set.js'
import { runDocSetPlanApply } from './generators/doc-set.js'
import type { DocSetSkeletonsResult } from './generators/doc-set.js'
import { runVerifyPlan } from './commands/verify-plan.js'
import { loadConfig } from './utils/config.js'
import { loadPlugin } from './utils/plugin-loader.js'
import {
  runDoctorRepairState,
  runDoctorHealth,
  runDoctorRecoverLock,
  runDoctorClean,
  runDoctorProveGates,
  runDoctorToolPins,
  runDoctorFailOpenCensus,
} from './commands/doctor.js'
import { jsonOutput } from './utils/json-output.js'
import { runUpgradeLevel } from './commands/upgrade-level.js'
import {
  runTaskAdvance,
  runTaskRecover,
  runTaskResume,
  runTaskInit,
  runTaskGet,
  HandoffRequiredError,
} from './commands/task.js'
import type { TaskPhase } from './commands/task.js'
import { runTaskShip, buildShipStepLines, shipStepFor } from './commands/task-ship.js'
import { runCrossModelReview, runShipCrossModelReview } from './commands/cross-model-review.js'
import { buildShipOverrides, resolveShipProfile } from './commands/ship-profile.js'
import { detectExternalModel } from './detectors/external-model.js'
import { runTaskRecordRed } from './commands/task-record-red.js'
import { runTaskRecordTechDebt } from './commands/task-record-tech-debt.js'
import { runTaskNote } from './commands/task-note.js'
import { runTaskMark } from './commands/task-mark.js'
import { isTddPhase, readUnifiedState } from './commands/task-state.js'
import { runVerifyTdd } from './commands/verify-tdd.js'
import { normTier } from './commands/ship-tier.js'
import { splitTrainIds } from './commands/ship-train.js'
import { runGraphBuild, runVerifyGraph } from './commands/graph.js'
import type { GraphFormat } from './commands/graph.js'
import { runReviewDiff, renderMarkdown } from './commands/review-diff.js'
import { confirmChannelDowngrade } from './utils/confirm-downgrade.js'
import type { ReleaseChannel } from './utils/channel.js'
import { appendEvidenceLine, evidenceLogTarget } from './utils/evidence-log.js'
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
import { parseExperimentalArgv } from './experimental/index.js'
import { applyDeprecatedFlagFilter } from './internal/deprecate.js'
import { CLI_DEPRECATED_FLAGS } from './internal/cli-deprecation-registry.js'
import { warnExperimental } from './internal/experimental-warn.js'
import { setRootLogger, getLogger, type LogLevel } from './utils/logger.js'
import { resolveFromProcess } from './utils/logger-config.js'
import { startReplay, rotateReplayLogs, type ReplayHandle } from './utils/replay.js'
import { startProfiler, type ProfilerHandle } from './utils/profiler.js'

registerCleanupHandlers()

// Mint run ID at CLI entry so all downstream code and subprocesses can read
// process.env.ARBITER_RUN_ID for log correlation.
getRunId()

function printCliError(msg: string): void {
  process.stderr.write(`  Error: ${msg}${formatRunIdFooter()}\n`)
}

/**
 * INV-144 / #2480 review: the arc42 engine hardcodes its manifest and ignores unknown argv, so
 * forwarding --manifest/--doc-profile silently audited the DEFAULT and reported PASS against a
 * file the operator had named. Merely not forwarding them is invisible — the operator still gets
 * a verdict about the wrong file. Refuse instead.
 */
function refuseUnsupportedArc42Flags(opts: {
  arc42: boolean
  manifest?: string
  docProfile?: string
}): void {
  if (!opts.arc42) return
  if (opts.manifest === undefined && opts.docProfile === undefined) return
  process.stderr.write(
    'arbiter doc-set: --manifest/--doc-profile are not supported with --arc42 — the arc42 ' +
      'engine reads standards/gold-doc-set.yml directly. Re-run without them.\n',
  )
  process.exit(2)
}

/**
 * T3 (gold-doc-tranches-t3-t5.md §1.2d): human report for `arbiter doc-set --plan/--apply` —
 * present · would-scaffold(+template id) · unbound · withheld. `--plan` writes nothing (dryRun);
 * the action label reflects the PROSPECTIVE action either way (writeFile's dryRun/real paths are
 * structurally incapable of drifting, src/utils/fs.ts `resolveWriteAction`).
 */
function printDocSetPlanApplyReport(result: DocSetSkeletonsResult, applied: boolean): void {
  const mode = applied ? 'apply' : 'plan'
  const tier = result.tierColumn ?? 'n/a (no manifest — SKIP)'
  process.stdout.write(`doc-set skeletons [tier: ${tier}] (${mode}):\n`)
  for (const s of result.scaffolded) {
    const verb =
      s.action === 'created'
        ? applied
          ? '+ created'
          : '+ would-scaffold'
        : s.action === 'replaced' || s.action === 'backed-up-and-replaced'
          ? applied
            ? '~ replaced (banner upgrade)'
            : '~ would-upgrade (banner)'
          : '. skipped (withheld — hand-edited)'
    process.stdout.write(`    ${verb}  ${s.path}  [${s.template}]\n`)
  }
  for (const p of result.unbound) {
    process.stdout.write(
      `    ? unbound (no skeleton bound — engine --generate banner only): ${p}\n`,
    )
  }
  if (applied && result.scaffolded.length === 0 && result.unbound.length > 0) {
    process.stdout.write(
      '    Remedy: run `node scripts/check-doc-set.mjs --generate` to create banner stubs for unbound rows.\n',
    )
  }
  if (result.scaffolded.length === 0 && result.unbound.length === 0) {
    process.stdout.write('    (nothing to scaffold — all applicable rows present)\n')
  }
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
// --channel is consumed early so doctor/update can read it without re-scanning argv
const _channelFlag = consumeFlagValue('--channel')
const _jsonRequested = process.argv.includes('--json')
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
  // #2218: informational commands write nothing, and the log lands in the current
  // PROJECT's root (or nowhere, outside a project) — never in an arbitrary cwd.
  const _evidenceDir = evidenceLogTarget(process.cwd(), _parsedCmd.cmd)
  if (_evidenceDir === null) return
  try {
    appendEvidenceLine(
      {
        ts: new Date().toISOString(),
        cmd: _parsedCmd.cmd,
        args: _parsedCmd.args,
        exit: code,
        durationMs: Date.now() - _startMs,
        headSha: _headSha,
      },
      { dir: _evidenceDir },
    )
  } catch {
    // evidence log write can fail during ENOSPC or signal-driven exit; log entry lost
    process.stderr.write('[arbiter] warning: evidence log write failed on exit — log entry lost\n')
  }
})

// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()

// #1837 (F1): read the version from package.json at runtime instead of a
// hardcoded literal that silently drifted from the real release (0.3.0 vs
// 0.4.0). createRequire resolves '../package.json' relative to this module's
// own location, which lands on the package root both from src/cli.ts (ts-node/
// vitest) and from the compiled dist/cli.js (one directory up from dist/) — the
// same layout npm always ships (package.json is included regardless of the
// "files" allowlist). Guarded because this runs at module load for every
// invocation, not just --version: a lookup failure must never crash the CLI's
// ability to run any command, so it degrades to 'unknown' rather than throwing.
function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    return (require('../package.json') as { version: string }).version
  } catch {
    return 'unknown'
  }
}
const packageVersion = readPackageVersion()

program.name('arbiter').description('AI development governance framework').version(packageVersion)

// #1770 (T5), superseded by T2 tier-3 (cathedral cut, 76→≤15 registrations):
// 14-command public surface (11 original + gate-exec/review/explain promoted).
// Remaining experimental commands are registered with
// `{ hidden: true }` — fully functional, omitted from default --help. The built-in
// help command is replaced by a hidden `help [command] [--all]` so `arbiter help --all`
// can list the hidden surface (see registration at the bottom of this file).
program.helpCommand(false)
program.addHelpText('after', '\nRun `arbiter help --all` for experimental commands.')

// Global flags. Declared so `--help` documents them; values are consumed pre-parse above.
function externalModelAccessForShip(
  root: string,
  overrides: Record<string, string>,
): ReturnType<typeof detectExternalModel> | undefined {
  const profile = resolveShipProfile(root, {
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  })
  const config = profile.crossModelReview
  if (config === undefined || !config.enabled || !config.diffEgressConsent) return undefined
  return detectExternalModel('codex')
}

function runConfiguredShipReview(
  root: string,
  result: ReturnType<typeof runTaskShip>,
  tier: string | undefined,
  access: ReturnType<typeof detectExternalModel> | undefined,
): ReturnType<typeof runShipCrossModelReview> | null {
  const config = result.profile.crossModelReview
  if (result.advanced || result.phase !== 'refactor' || !config?.enabled) return null
  const taskId = readUnifiedState(root)?.taskId
  if (taskId === undefined) {
    throw new Error('crossModelReview is enabled but the active ship task id is missing')
  }
  return runShipCrossModelReview({
    dir: root,
    taskId,
    tier: result.tier ?? normTier(tier),
    phase: result.phase,
    vertical: result.step.verticals.includes('security') ? 'security' : 'bugs',
    cfg: config,
    collaborationMode: result.profile.collaborationMode,
    ...(access !== undefined ? { access } : {}),
  })
}

function shipOutputAfterConfiguredReview(
  root: string,
  result: ReturnType<typeof runTaskShip>,
  tier: string | undefined,
  access: ReturnType<typeof detectExternalModel> | undefined,
): ReturnType<typeof runTaskShip> {
  const externalReview = runConfiguredShipReview(root, result, tier, access)
  return externalReview?.status === 'degraded'
    ? { ...result, step: shipStepFor(result.phase, result.tier, result.profile) }
    : result
}

program
  .option('--log-level <level>', 'Log level: error|warn|info|debug|trace (default: info)')
  .option('--log-format <format>', 'Log format: text|json (default: text)')
  .option('--debug', 'Enable debug-level logging (implies --log-level=debug)')
  .option('--no-replay', 'Disable replay log capture for this invocation')
  .option('--profile', 'Capture a V8 CPU profile to ~/.arbiter/profiles/<runId>.cpuprofile')
  // #662 — channel flag: overrides channel field in arbiter.json for this invocation.
  // No subcommand defines its own --channel, so no collision risk.
  .option(
    '--channel <name>',
    'Channel for this invocation: latest|beta|canary — gates downgrade warnings and shown in `doctor health` (default: arbiter.json channel or latest)',
  )

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
    'Set collaborationMode=trunk-solo (direct-merge, full local gate ≡ CI, CI as verification mirror). Shorthand for ADR-051 trunk-solo mode.',
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
  .option(
    '--adopt',
    'Force-adopt ALL currently-withheld files (not just safety-class), recording a ' +
      'reversible local-override for each. Safety-class files adopt by default already.',
    false,
  )
  .option(
    '--no-adopt-safety',
    'Opt OUT of the default-on safety-class adoption (.claude/hooks/*.mjs). Leaves a ' +
      'user-modified safety hook frozen even if the shipped template fixed it — dangerous.',
  )
  .option(
    '--adopt-gate-spine',
    'Opt IN to force-adopting the gate spine (scripts/check-all.mjs, scripts/lib/*.mjs) over a ' +
      'user-modified copy. DESTRUCTIVE: checks wired into that file by the project are replaced by ' +
      'the template render — preview with --adopt-plan first (#2119).',
    false,
  )
  .option(
    '--adopt-governance',
    'Opt IN to force-adopting governance files (AGENTS.md, .claude/settings.json) over a user-modified ' +
      'copy. DESTRUCTIVE: the template render is not a superset of governed consumer content — preview ' +
      'with --adopt-plan first (#2141).',
    false,
  )
  .option(
    '--no-adopt-gate-spine',
    'Accepted no-op: withholding a customized gate spine is the default since #2119.',
  )
  .option(
    '--no-adopt-governance',
    'Accepted no-op: withholding a diverged governance file is the default since #2141.',
    (_value, previous) => previous,
  )
  .option(
    '--adopt-plan',
    'Two-phase preview: print what --adopt/the default safety adoption WOULD change ' +
      '(file list + line diff), without writing anything.',
    false,
  )
  .option(
    '--refresh-derived',
    'Force-refresh the codex-track derived file set (.agents/rules/*, .claude/hooks/* ' +
      'when codex-only, .codex/codex-adapter.mjs) even though these are skipIfExists by ' +
      'default. Combine with --adopt-plan to preview first. A file marked arbiter:preserve ' +
      'is never overwritten (#1983).',
    false,
  )
  .action(
    async (opts: {
      dir?: string
      github: boolean
      json: boolean
      force: boolean
      adopt: boolean
      adoptSafety: boolean
      adoptGateSpine: boolean
      adoptGovernance: boolean
      adoptPlan: boolean
      refreshDerived: boolean
    }) => {
      if (_channelFlag !== undefined) {
        const config = loadConfig(opts.dir ?? '.')
        await confirmChannelDowngrade(_channelFlag as ReleaseChannel, config?.channel)
      }
      await runUpdate({
        dir: opts.dir,
        github: opts.github,
        json: opts.json,
        force: opts.force,
        adopt: opts.adopt,
        noAdoptSafety: !opts.adoptSafety,
        adoptGateSpine: opts.adoptGateSpine,
        adoptGovernance: opts.adoptGovernance,
        adoptPlan: opts.adoptPlan,
        refreshDerived: opts.refreshDerived,
      })
    },
  )

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

// #2039: the FEATURE lens over `configure`'s FIELD surface. `method status` is pure read;
// the bare `method` on a TTY opens the cluster lens, whose every write is delegated back to
// `configure` (there is no second config engine). Same TTY/lazy-import split as `configure`.
// hidden: the public surface is capped at 15 commands (T2 tier-3 cut, asserted by
// __tests__/behavioral/help-surface.test.ts), and #2039's own design §0 says "no new public
// CLI commands". `settings` — the FIELD view over the same paths — is hidden for the same
// reason, so the FEATURE view over them belongs in the same tier. `arbiter help --all` and
// the generated CLI reference both still document it.
const method = program
  .command('method', { hidden: true })
  .description('Methodology lens: per-feature Config+Emit wiring status over `configure` (#2039)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string | undefined; json: boolean }) => {
    const handler = async (): Promise<void> => {
      // --json is a report request, never an interactive session, so it takes the read path
      // even on a TTY. Without a write path in the MVP there is no --yes to require yet.
      if (!opts.json && process.stdin.isTTY) {
        const { runInteractiveMethod } = await import('./commands/method-interactive.js')
        return runInteractiveMethod(opts.dir)
      }
      // runMethodStatus is sync and returns void — `return` it and
      // @typescript-eslint/no-confusing-void-expression rightly objects.
      runMethodStatus({
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        json: opts.json,
      })
    }
    handler().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    })
  })

method
  .command('status')
  .description('Read-only per-feature methodology report (Config + Emit facets)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((_opts: unknown, cmd: { optsWithGlobals: () => { dir?: string; json: boolean } }) => {
    // #2162: parent and subcommand both declare --dir/--json, so read the merged view.
    const merged = cmd.optsWithGlobals()
    try {
      runMethodStatus({
        ...(merged.dir !== undefined ? { dir: merged.dir } : {}),
        json: merged.json,
      })
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
  .option(
    '--governance',
    'Audit Iron Laws (AGENTS.md) and the permission deny list (.claude/settings.json) for staleness vs the current template; fail-closed (#2040)',
    false,
  )
  .action((opts: { dir?: string; json: boolean; withheld: boolean; governance: boolean }) => {
    runDiff({
      dir: opts.dir,
      json: opts.json,
      withheld: opts.withheld,
      governance: opts.governance,
    })
  })

program
  .command('obsidian')
  .description('Sync/validate the Obsidian vault via the repo-owned wiki scripts (#1979)')
  .option('--repo <dir>', 'Target repo directory (default: current directory)')
  .option('--vault-path <dir>', 'Vault directory relative to the repo root', 'wiki')
  .option('--sync', 'Regenerate the vault then re-validate (fail-closed)', false)
  .option('--validate-only', 'Validate the existing vault without writing', false)
  .option('--write', 'Reserved for a future writer; v1 is read-only (ADR-001)', false)
  .option('--dry-run', 'Report only — writes nothing (default)', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (opts: {
      repo?: string
      vaultPath: string
      sync: boolean
      validateOnly: boolean
      write: boolean
      dryRun: boolean
      json: boolean
    }) => {
      const result = runObsidian({
        ...(opts.repo !== undefined ? { dir: opts.repo } : {}),
        vaultPath: opts.vaultPath,
        sync: opts.sync,
        validateOnly: opts.validateOnly,
        write: opts.write,
        dryRun: opts.dryRun,
        json: opts.json,
      })
      if (opts.json) {
        jsonOutput('obsidian', result.status, { ...result })
      } else if (result.reason) {
        process.stdout.write(`obsidian: ${result.reason}\n`)
      } else {
        process.stdout.write(
          `obsidian: ${result.mode} — ${result.status} (vault: ${result.vaultDir})\n`,
        )
      }
      process.exit(result.exitCode)
    },
  )

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

worktree
  .command('relink <task-id>')
  .description('Re-materialize configured links for an existing task worktree')
  .option('--with-build-links', 'Also materialize buildLinks from config', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((taskId: string, opts: { withBuildLinks: boolean; json: boolean }) => {
    try {
      runWorktreeRelink({ taskId, withBuildLinks: opts.withBuildLinks, json: opts.json })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    }
  })

worktree
  .command('prune')
  .description(
    'Reap zombie worktrees (#1873, ADR-103): clean trees that are merged or inactive ' +
      'beyond --stale hours. Dry-run by default; dirty trees are never touched (INV-96); ' +
      'inactive-unmerged candidates keep their branch.',
  )
  .option(
    '--stale <hours>',
    'Inactivity threshold in hours for unmerged worktrees',
    (v: string) => {
      const n = parseInt(v, 10)
      if (isNaN(n) || n <= 0) throw new Error('--stale must be a positive integer (hours)')
      return n
    },
  )
  .option('--execute', 'Close the candidates (default: dry-run report)', false)
  .option('--no-fetch', 'Skip git fetch before the merge check', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { stale?: number; execute: boolean; fetch: boolean; json: boolean }) => {
    try {
      runWorktreePrune({
        ...(opts.stale !== undefined ? { staleHours: opts.stale } : {}),
        execute: opts.execute,
        noFetch: !opts.fetch,
        json: opts.json,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    }
  })

program
  // Promoted to public (T2 tier-3, #1770 T5 supersession): gate-exec is a
  // load-bearing primitive (J5) invoked by the wave-drain skill — worth
  // surfacing directly rather than hiding behind `help --all`.
  .command('gate-exec <cmd...>')
  .description(
    'Run a command under the per-repo gate mutex (#1873, ADR-103): every worktree of ' +
      'the same repo converges on ONE flock(1) lock, the wait is kernel-side (blocking), ' +
      'and flock closes the lock fd before the command and its descendants run. Usage: ' +
      'arbiter gate-exec [--key K] -- <cmd> [args...]. Exit code: passthrough of the ' +
      'command; 2 on gate-exec errors (e.g. flock missing — fail-closed).',
  )
  .option('--key <key>', 'Explicit mutex key (overrides per-repo derivation)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(async (cmdArgs: string[], opts: { key?: string; dir?: string }) => {
    try {
      const code = await runGateExec({
        cmdArgs,
        ...(opts.key !== undefined ? { key: opts.key } : {}),
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      })
      process.exit(code)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(2)
    }
  })

const review = program.command('review').description('Semantic diff between graph snapshots (#262)')

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

review
  .command('cross-model')
  .description('Run the configured Codex review seat against a diff from stdin (#2357)')
  .requiredOption('--task <id>', 'Task issue id, for example #2357')
  .requiredOption('--prompt <text>', 'Review prompt; the code diff is read from stdin')
  .option('--tier <tier>', 'Ship tier (XS|S|Standard; default: Standard)')
  .option('--phase <phase>', 'Task phase (default: refactor)')
  .option('--vertical <vertical>', 'Review vertical (default: bugs)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(
    (opts: {
      task: string
      prompt: string
      tier?: string
      phase?: TaskPhase
      vertical?: string
      dir?: string
    }) => {
      const result = runCrossModelReview({
        taskId: opts.task,
        prompt: opts.prompt,
        ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
        ...(opts.phase !== undefined ? { phase: opts.phase } : {}),
        ...(opts.vertical !== undefined ? { vertical: opts.vertical } : {}),
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
    },
  )

program
  // Hidden (like settings/upgrade-level, line ~662/1068): fully functional but omitted from the
  // curated public 14-command --help surface (#1770 T5 / T2 tier-3). The generated governed-repo
  // thin-runner invokes it directly (`npx arbiter doc-set`) — visibility in `--help` is not part
  // of H1's fix, only registration. Discoverable via `arbiter help --all`.
  .command('doc-set [repo]', { hidden: true })
  .description(
    'Deterministic gold doc-set presence audit (H1, gold-doc-capability: wraps ' +
      'scripts/check-doc-set.mjs). Required-set is tier-parameterized by collaborationMode ' +
      '(solo/small/enterprise) — see standards/gold-doc-set.yml `tiers{}`.',
  )
  .option('--strict', 'Exit 1 if any mandatory doc is missing (default: advisory, exit 0)', false)
  .option(
    '--check',
    'Run the default advisory presence audit (backward-compat alias for the no-flag default; ' +
      'emitted governed-repo runners pass it)',
    false,
  )
  .option('--json', 'Emit the audit as JSON', false)
  .option('--generate', 'Scaffold stub files for missing mandatory+recommended .md docs', false)
  .option(
    '--refresh-stubs',
    '(with --generate) re-render a doc in place only if it is byte-equal to the stub template',
    false,
  )
  .option('--manifest <path>', 'Manifest path override (default standards/gold-doc-set.yml)')
  .option(
    // NOT named `--profile`: that flag name is globally reserved (consumeFlag('--profile'),
    // cli.ts:164, the V8 CPU-profiler switch) and is spliced out of argv BEFORE Commander ever
    // parses subcommand options — a same-named local option would silently lose its value.
    '--doc-profile <path>',
    'Overlay profile path override (default standards/doc-profile)',
  )
  .option(
    '--plan',
    'T3: dry-run the skeleton generator — report would-scaffold/unbound, write nothing',
    false,
  )
  .option(
    '--apply',
    'T3: scaffold real per-doc-type skeletons for missing bound rows (skipIfExists; never ' +
      'overwrites a hand-edited doc; upgrades a byte-equal banner stub)',
    false,
  )
  .option(
    '--freshness',
    'T4: run the per-doc freshness audit (scripts/check-doc-freshness.mjs) instead of presence',
    false,
  )
  .option(
    '--arc42',
    'INV-144: run the arc42 slot-completeness audit (scripts/check-arc42-slots.mjs) instead of ' +
      "presence — every slot the tier's arc42 skeleton provides must be present and filled",
    false,
  )
  .option(
    '--update-baseline',
    '(with --arc42) re-record the hollow-slot ratchet; refused when a counter rose',
    false,
  )
  .action(
    (
      repo: string | undefined,
      opts: {
        strict: boolean
        json: boolean
        generate: boolean
        refreshStubs: boolean
        manifest?: string
        docProfile?: string
        plan: boolean
        apply: boolean
        freshness: boolean
        arc42: boolean
        updateBaseline: boolean
      },
    ) => {
      refuseUnsupportedArc42Flags(opts)
      if (opts.plan || opts.apply) {
        const result = runDocSetPlanApply({
          ...(repo !== undefined ? { repo } : {}),
          apply: opts.apply,
          ...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
          ...(opts.docProfile !== undefined ? { profile: opts.docProfile } : {}),
        })
        printDocSetPlanApplyReport(result, opts.apply)
        process.exit(
          opts.apply && result.scaffolded.length === 0 && result.unbound.length > 0 ? 1 : 0,
        )
      }
      const result = runDocSet({
        ...(repo !== undefined ? { repo } : {}),
        strict: opts.strict,
        json: opts.json,
        generate: opts.generate,
        refreshStubs: opts.refreshStubs,
        freshness: opts.freshness,
        arc42: opts.arc42,
        updateBaseline: opts.updateBaseline,
        ...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
        ...(opts.docProfile !== undefined ? { profile: opts.docProfile } : {}),
      })
      process.exit(result.exitCode)
    },
  )

/** #2164: print formatProvenance() lines when a provenance block is present; no-op otherwise. */
function printProvenanceLines(provenance: Provenance | undefined): void {
  if (provenance === undefined) return
  for (const line of formatProvenance(provenance)) {
    process.stdout.write(`${line}\n`)
  }
}

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
  .action((opts: { json: boolean; dir?: string }, cmd: Command) => {
    // #1994: same parent/child --json shadowing #1992 fixed for `verify tdd` —
    // `verify`/`validate` declares its own --json, so opts.json here reads the
    // parent's default. optsWithGlobals() reflects the flag actually passed.
    const json = Boolean(cmd.optsWithGlobals().json)
    const result = runVerifyEvidence({ dir: opts.dir })
    if (json) {
      jsonOutput(
        'verify evidence',
        result.status,
        {
          exitCode: result.exitCode,
          ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
          // #2164: present only when SUMMARY.json carries a valid provenance block —
          // never a hard failure from `verify evidence` on missing provenance.
          ...(result.provenance !== undefined ? { provenance: result.provenance } : {}),
        },
        result.status === 'error' && result.reason !== undefined ? [result.reason] : undefined,
      )
    } else {
      const label = result.status === 'ok' ? 'OK' : result.status.toUpperCase()
      const tail = result.reason ? ` — ${result.reason}` : ''
      process.stdout.write(`verify evidence: ${label}${tail}\n`)
      printProvenanceLines(result.provenance)
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
      cmd: Command,
    ) => {
      // #1994: same parent/child --json shadowing #1992 fixed for `verify tdd` —
      // opts.json reads the verify/validate parent's default; optsWithGlobals()
      // reflects the flag actually passed.
      const json = Boolean(cmd.optsWithGlobals().json)
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
        json,
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
  .action((opts: { dir?: string; input?: string; json: boolean }, cmd: Command) => {
    // #1994: same parent/child --json shadowing #1992 fixed for `verify tdd` —
    // opts.json reads the verify/validate parent's default; optsWithGlobals()
    // reflects the flag actually passed.
    const commandOpts = cmd.optsWithGlobals<{ dir?: string; json?: boolean }>()
    const json = Boolean(commandOpts.json)
    const verifyOpts: import('./commands/graph.js').VerifyGraphOptions = {}
    if (commandOpts.dir !== undefined) verifyOpts.dir = commandOpts.dir
    if (opts.input !== undefined) verifyOpts.input = opts.input
    const result = runVerifyGraph(verifyOpts)
    if (json) {
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
  .action((taskId: string, opts: { dir?: string; json: boolean }, cmd: Command) => {
    // #1992: `verify`/`validate` (the parent command) also declares --json,
    // which shadows this subcommand's own parsed value in `opts` — Commander
    // resolves the name collision to the parent's default. optsWithGlobals()
    // merges local + inherited options and reflects the flag actually passed.
    const json = Boolean(cmd.optsWithGlobals().json)
    const result = runVerifyTdd({
      taskId,
      json,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
    if (json) {
      jsonOutput(
        'verify tdd',
        result.status === 'PASS' ? 'ok' : 'error',
        {
          exitCode: result.exitCode,
          taskId: result.taskId,
          checks: result.checks ?? [],
        },
        result.reason !== undefined ? [result.reason] : undefined,
      )
    } else if (result.status === 'PASS') {
      process.stdout.write(`verify tdd: PASS (${result.checks?.length ?? 0} checks)\n`)
    } else if (result.status === 'DEGRADED') {
      process.stderr.write(`verify tdd: DEGRADED — ${result.reason ?? 'unknown'}\n`)
    } else {
      process.stderr.write(`verify tdd: FAIL — ${result.reason ?? 'unknown'}\n`)
    }
    process.exit(result.exitCode)
  })

program
  .command('upgrade-level', { hidden: true })
  .description('Upgrade governance level with a grace period for new gates')
  .option('--target <level>', 'Target level (L2 or L3)')
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
        if (opts.target !== 'L2' && opts.target !== 'L3') {
          printCliError(`invalid --target "${opts.target}". Valid values: L2, L3.`)
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

function runDoctorHealthAction(
  _opts: {
    dir?: string
    json: boolean
    repair: boolean
    interactive: boolean
    proveGates: boolean
  },
  cmd: Command,
): void {
  const opts = cmd.optsWithGlobals<{
    dir?: string
    json: boolean
    repair: boolean
    interactive: boolean
    proveGates: boolean
  }>()
  if (opts.proveGates) {
    const result = runDoctorProveGates({ json: opts.json })
    if (result.exitCode !== 0) process.exit(result.exitCode)
    return
  }
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
}

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
  .option(
    '--prove-gates',
    'Run negative proofs for every tier-1 conformance gate; report any gate that does not bite (#1817, A5)',
    false,
  )
  .action(runDoctorHealthAction)

doctor
  .command('health')
  .description('Run arbiter health checks')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option(
    '--repair',
    'Auto-release stale .arbiter/.lock files detected by the health check (#824)',
    false,
  )
  .option('--interactive', 'Guided health check with one-key repair on a TTY (#1168)', false)
  .option(
    '--prove-gates',
    'Run negative proofs for every tier-1 conformance gate; report any gate that does not bite (#1817, A5)',
    false,
  )
  .action(runDoctorHealthAction)

doctor
  .command('repair-state')
  .description('Re-derive .arbiter-generated.json from arbiter.json (snapshot corruption recovery)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((_opts: { dir?: string; json: boolean }, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ dir?: string; json: boolean }>()
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
  .option('--force', 'Release a live or unconfirmed lock deliberately', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((_opts: { dir?: string; force: boolean; json: boolean }, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ dir?: string; force: boolean; json: boolean }>()
    runDoctorRecoverLock({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      force: opts.force,
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
  .action((_opts: { dir?: string; dryRun: boolean; json: boolean }, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ dir?: string; dryRun: boolean; json: boolean }>()
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

doctor
  .command('tool-pins')
  .description(
    'Compare local tool versions against CI workflow pins (see `check-ci-tool-parity.mjs` ' +
      'for CI-internal manifest parity — a different, non-overlapping check)',
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((_opts: { dir?: string; json: boolean }, cmd: Command) => {
    // #2162: `doctor` (parent) declares --dir/--json too, and commander only
    // binds a same-named flag to whichever command it's first defined on when
    // the two collide — `cmd.opts()` silently drops what was typed here.
    // `optsWithGlobals()` is the documented escape hatch (merges this
    // command's own values with every ancestor's). Systemic collision on the
    // sibling doctor subcommands (repair-state/recover-lock/clean) tracked
    // separately — not this issue's blocking scope.
    const opts = cmd.optsWithGlobals<{ dir?: string; json: boolean }>()
    const result = runDoctorToolPins({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  })

doctor
  .command('fail-open-census')
  .description(
    'Census `command -v X || <fail-open>` and positive `if command -v X; then ... fi` gate-script presence-gates (see ' +
      '`check-fail-closed-audit.mjs` for a different pattern class — `|| true` / swallowed ' +
      "catch — self-scoped to arbiter's own repo)",
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option(
    '--allowlist <path>',
    'Override allowlist path (default: .arbiter/fail-open-allowlist.json)',
  )
  .action((_opts: { dir?: string; json: boolean; allowlist?: string }, cmd: Command) => {
    // #2162: see the tool-pins action above for why optsWithGlobals() (not the
    // first `opts` param) is required here — --dir/--json collide with the
    // parent `doctor` command's own same-named options.
    const opts = cmd.optsWithGlobals<{ dir?: string; json: boolean; allowlist?: string }>()
    const result = runDoctorFailOpenCensus({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      json: opts.json,
      ...(opts.allowlist !== undefined ? { allowlistPath: opts.allowlist } : {}),
    })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  })

const task = program.command('task').description('Manage task lifecycle state')

task
  .command('resume')
  .description('Print recovery instructions for the current task phase')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runTaskResume({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) })
  })

/**
 * #2402 — commander folds `--no-pr` and `--pr <n>` onto one key: absent, `false` (the negation
 * flag), or the number. Split them back apart here so the engine sees two explicit options and
 * never has to know that encoding.
 */
function advanceLandingFlags(opts: { pr?: number | false }): { noPr?: true; pr?: number } {
  if (opts.pr === false) return { noPr: true }
  return typeof opts.pr === 'number' ? { pr: opts.pr } : {}
}

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
  .option('--no-pr', 'Complete without a merged PR — this repo lands by direct push (logged)')
  .option(
    '--pr <n>',
    'Verify this PR number when the branch carries more than one',
    (v: string) => {
      const n = parseInt(v, 10)
      if (isNaN(n) || n <= 0) throw new Error('--pr must be a positive integer')
      return n
    },
  )
  .action(
    (opts: {
      to: string
      reverse: boolean
      dir?: string
      skipPlanReview: boolean
      postClear: boolean
      pr?: number | false
    }) => {
      try {
        runTaskAdvance({
          to: opts.to as TaskPhase,
          reverse: opts.reverse,
          skipPlanReview: opts.skipPlanReview,
          postClear: opts.postClear,
          ...advanceLandingFlags(opts),
          ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        })
      } catch (err) {
        if (err instanceof HandoffRequiredError) {
          process.stderr.write(err.message + '\n')
          process.exit(78)
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
  .option('--task <id>', 'Task id; use for a declared secondary issue on a train (#2336)')
  .option(
    '--test-command <cmd>',
    'Override the test runner binary (e.g. go, pytest, npx). Overrides language-based auto-selection. The command is passed verbatim to the runner (no shell interpolation).',
  )
  .option(
    '--test-arg <arg>',
    'Argument to the test command (repeatable). Combined with --test-command in the order given.',
    (val: string, acc: string[]) => acc.concat(val),
    [] as string[],
  )
  .option('--timeout-ms <ms>', 'Test-run timeout in ms (default 60000, clamped to 1..600000)')
  .option('--force', 'Skip the dirty-__tests__ and test-path-in-HEAD refusals (#1988)', false)
  .action(
    (opts: {
      testPath: string
      dir?: string
      task?: string
      testCommand?: string
      testArg?: string[]
      timeoutMs?: string
      force: boolean
    }) => {
      const testCmd =
        opts.testCommand !== undefined ? [opts.testCommand, ...(opts.testArg ?? [])] : undefined
      const timeoutMs =
        opts.timeoutMs !== undefined ? Number.parseInt(opts.timeoutMs, 10) : undefined
      const result = runTaskRecordRed({
        testPath: opts.testPath,
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
        ...(opts.task !== undefined ? { taskId: opts.task } : {}),
        ...(testCmd !== undefined ? { testCmd } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        force: opts.force,
      })
      if (result.ok) {
        process.stdout.write(
          `record-red: OK (framework=${result.framework})\nevidence: ${result.evidencePath}\n`,
        )
      } else {
        process.stderr.write(`record-red: FAIL — ${result.reason}\n`)
        process.exit(1)
      }
    },
  )

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
  .command('init [ids...]')
  .description('Initialise / update the unified task document (#1206)')
  .option('--id <id>', 'Task id, e.g. #1206')
  .option('--tier <tier>', 'Task tier (XS|S|Standard)')
  .option('--plan <path>', 'Repo-relative path to the plan file')
  .option(
    '--chain <id>',
    'Other issue id batched into this task worktree/gate/PR (repeatable, #2102)',
    (v: string, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(
    (
      ids: string[],
      opts: { id?: string; tier?: string; plan?: string; chain: string[]; dir?: string },
    ) => {
      // #2401 — `arbiter task init #A #B #C` is the same train sugar `arbiter ship` takes.
      const train = splitTrainIds(ids, opts.id, opts.chain)
      runTaskInit({
        ...(train.taskId !== undefined ? { id: train.taskId } : {}),
        ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
        ...(opts.plan !== undefined ? { plan: opts.plan } : {}),
        ...(train.chainIds.length > 0 ? { chainIds: train.chainIds } : {}),
        ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
      })
    },
  )

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
 * #2400 — the review-round flags, forwarded only when actually supplied so an absent flag can
 * never open a round or forgive the cap by accident. A named helper, not two inline spreads:
 * the ship action is already at its complexity ceiling.
 */
function shipReviewFlags(opts: { reviewRound: boolean; forceReview: boolean }): {
  reviewRound?: true
  forceReview?: true
} {
  return {
    ...(opts.reviewRound ? { reviewRound: true as const } : {}),
    ...(opts.forceReview ? { forceReview: true as const } : {}),
  }
}

program
  // #2401 — variadic: `arbiter ship #A #B #C` declares a train, sugar for repeated `--chain`.
  .command('ship [ids...]')
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
    '--chain <id>',
    'Other issue id batched into this ship worktree/gate/PR (repeatable, #2102)',
    (v: string, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option(
    '--chain-add <id>',
    'Append an issue to the open train, or refuse if it must seal first (repeatable, #2331)',
    (v: string, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option('--seal', 'Seal the open train now — land it before starting another (#2331)', false)
  .option('--no-pr', 'Complete without a merged PR — this repo lands by direct push (logged)')
  .option(
    '--pr <n>',
    'Verify this PR number when the branch carries more than one',
    (v: string) => {
      const n = parseInt(v, 10)
      if (isNaN(n) || n <= 0) throw new Error('--pr must be a positive integer')
      return n
    },
  )
  .option(
    '--review-round',
    'Record another code-review round on this task (entering refactor records the first)',
    false,
  )
  .option(
    '--force-review',
    'Take a review round past ship.review.maxRounds, and record that it was forced',
    false,
  )
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action(
    (
      ids: string[],
      opts: {
        tier?: string
        autonomy?: string
        set: string[]
        chain: string[]
        chainAdd: string[]
        seal: boolean
        reviewRound: boolean
        forceReview: boolean
        pr?: number | false
        advance: boolean
        skipPlanReview: boolean
        postClear: boolean
        units?: number
        dir?: string
      },
    ) => {
      try {
        // #1305 — desugar `--autonomy` + parse `--set` into ONE validated per-run overrides map,
        // gated by OVERRIDABLE_PATHS and persisted to the session layer (survives /clear).
        const shipRoot = opts.dir ?? process.cwd()
        const overrides = buildShipOverrides(shipRoot, {
          sets: opts.set,
          ...(opts.autonomy !== undefined ? { autonomy: opts.autonomy } : {}),
        })
        const externalModelAccess = externalModelAccessForShip(shipRoot, overrides)
        // #1260 — the review TIER drives BOTH the review-agent COUNT and the orthogonal
        // VERTICAL breadth (see A8: guidance, not auto-detected machinery). Without `--tier`,
        // respect the persisted tier; when none is persisted, normTier falls back to widest
        // ('Standard') fail-safe.
        // #2401 — `#A #B #C` positional sugar folds into the same chain the flags declare.
        const train = splitTrainIds(ids, undefined, opts.chain)
        const result = runTaskShip({
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
          ...(train.taskId !== undefined ? { taskId: train.taskId } : {}),
          ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
          // #2102 — only pass chainIds when the user actually supplied --chain (or the #2401
          // positional sugar): an absent flag must never clobber a chain declared earlier
          // (e.g. at `task init`) with an empty array.
          ...(train.chainIds.length > 0 ? { chainIds: train.chainIds } : {}),
          // #2331 — same shape as --chain: only pass when actually supplied, so an absent flag
          // is never mistaken for "append nothing" and can never seal or clear a live train.
          ...(opts.chainAdd.length > 0 ? { chainAddIds: opts.chainAdd } : {}),
          ...(opts.seal ? { seal: true } : {}),
          ...shipReviewFlags(opts),
          advance: opts.advance,
          advanceOpts: {
            skipPlanReview: opts.skipPlanReview,
            postClear: opts.postClear,
            ...(opts.units !== undefined ? { units: opts.units } : {}),
            // #2402 — the landing gate fires on `--advance` into `complete`; without these the
            // ship path would have no escape hatch the `task advance` path has.
            ...advanceLandingFlags(opts),
          },
          ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
          ...(externalModelAccess !== undefined ? { externalModelAccess } : {}),
        })
        const outputResult = shipOutputAfterConfiguredReview(
          shipRoot,
          result,
          opts.tier,
          externalModelAccess,
        )
        const lines = buildShipStepLines(outputResult)
        process.stdout.write(lines.join('\n') + '\n')
      } catch (err) {
        if (err instanceof HandoffRequiredError) {
          process.stderr.write(err.message + '\n')
          process.exit(78)
        }
        throw err
      }
    },
  )

// ── review diff (#262) ───────────────────────────────────────────────────────

/** Emit a review-diff failure in the selected output format, then terminate. */
function exitReviewDiffFailure(
  json: boolean,
  exitCode: number,
  data: Record<string, string>,
  message: string,
): never {
  if (json) jsonOutput('review diff', 'error', data, [message])
  else process.stderr.write(message + '\n')
  process.exit(exitCode)
}

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
        const message = `review diff: FAIL — head graph not found at ${headPath}`
        exitReviewDiffFailure(opts.json, 2, { headPath }, message)
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
        const message = `review diff: FAIL — ${headOutcome.reason}`
        exitReviewDiffFailure(opts.json, 2, { headPath }, message)
      }
      let base: import('./graph/model.js').GraphSnapshot = { nodes: [], edges: [] }
      if (efs(basePath)) {
        const baseOutcome = loadGraph(basePath)
        if (!baseOutcome.ok) {
          const message = `review diff: FAIL — ${baseOutcome.reason}`
          exitReviewDiffFailure(opts.json, 2, { basePath }, message)
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
  .command('explain [code]')
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

// ── help (#1770 T5) ───────────────────────────────────────────────────────────
// Replaces the built-in help command (disabled above via program.helpCommand(false))
// so `arbiter help --all` can list experimental (hidden) commands. Registered hidden
// itself so it does not inflate the public surface count.
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
  if (_jsonRequested) {
    jsonOutput('arbiter', 'error', {}, [err.message], {
      code: err.code,
      ...(err instanceof FatalError
        ? { errorClass: 'fatal' as const }
        : err instanceof ConfigError
          ? { errorClass: 'config' as const }
          : err instanceof RecoverableError
            ? { errorClass: 'recoverable' as const }
            : {}),
    })
    return
  }
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
    if (!_jsonRequested && err.recoverableContext?.length) {
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
