#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { Command, Option } from 'commander'
import { runInit } from './commands/init.js'
import { runUpdate } from './commands/update.js'
import { runDiff } from './commands/diff.js'
import { runConfigure } from './commands/configure.js'
import { runWorktreeOpen, runWorktreeClose, runWorktreeList } from './commands/worktree.js'
import { runVerify, runVerifyEvidence } from './commands/verify.js'
import { runVerifyPlan } from './commands/verify-plan.js'
import { loadConfig } from './utils/config.js'
import { loadPlugin } from './utils/plugin-loader.js'
import { runDoctorRepairState, runDoctorHealth, runDoctorRecoverLock } from './commands/doctor.js'
import { runReviewCode, runReviewPlan } from './commands/review.js'
import { jsonOutput } from './utils/json-output.js'
import type { ReviewTier } from './review/tier-constants.js'
import { runUpgradeLevel } from './commands/upgrade-level.js'
import { runPluginAdd, runPluginRemove, runPluginList, runPluginInit } from './commands/plugin.js'
import {
  runTaskAdvance,
  runTaskRecover,
  runTaskResume,
  HandoffRequiredError,
  BudgetBreachError,
} from './commands/task.js'
import type { TaskPhase } from './commands/task.js'
import { runTaskRecordRed } from './commands/task-record-red.js'
import { runTaskRecordTechDebt } from './commands/task-record-tech-debt.js'
import { runVerifyTdd } from './commands/verify-tdd.js'
import { runHarness } from './commands/harness.js'
import { runKnowledgeMapUpdate } from './commands/knowledge-map.js'
import { runNotaryCheck, runNotaryTemplate } from './commands/notary.js'
import { runGraphBuild, runVerifyGraph } from './commands/graph.js'
import { runTrace, type TraceFormat } from './commands/trace.js'
import { runBlame, type BlameFormat } from './commands/blame.js'
import { runCompare } from './commands/compare.js'
import { runAgentRulesExport, runAgentRulesVerify } from './commands/agent-rules.js'
import { runGauntletGenerate, runGauntletVerify } from './commands/gauntlet.js'
import type { GauntletStack } from './commands/gauntlet.js'
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
import { parseBooleanEnv } from './utils/env.js'
import { runCli } from './utils/run-cli.js'
import { ArbiterError, UserFacingError } from './utils/errors.js'
import { registerCleanupHandlers } from './utils/fs.js'
import { runExplain } from './commands/explain.js'
import { runBenchmarkHooks } from './commands/benchmark.js'
import { getRunId, formatRunIdFooter } from './utils/run-id.js'
import { parseExperimentalArgv, listExperiments, isEnabled } from './experimental/index.js'
import { t } from './i18n/index.js'
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
} from './commands/kit.js'
import type { KitListFormat, KitListFilter } from './commands/kit.js'
import type { Stack } from './kit/schema.js'
import { runKitInstall } from './commands/kit-install.js'
import type { BrownfieldClass } from './kit/thresholds.js'

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
const _noEvidence =
  _noEvidenceIdx !== -1 || parseBooleanEnv(process.env['ARBITER_NO_EVIDENCE']) === true
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
  const nested: ReadonlySet<string> = new Set([
    'worktree',
    'wt',
    'task',
    'plugin',
    'work',
    'notary',
    'kit',
  ])
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

program.name('arbiter').description('AI development governance framework').version('0.1.0')

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
  .command('report')
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

program
  .command('init')
  .description('Initialize AI governance in a project')
  .option('-y, --yes', 'Skip wizard — use auto-detected defaults', false)
  .option(
    '--tools <tools>',
    'Comma-separated list of AI tools (claude,codex,cursor,copilot,gemini,windsurf,aider)',
  )
  .option('--level <level>', 'Governance level: L1, L2, L3, or L4', 'L2')
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
    'Apply a meta-preset: industrial-grade (governance + compliance + observability + auth bundle)',
  )
  .option('--auth-provider <provider>', 'Override auth provider (used with --preset or standalone)')
  .option(
    '--observability-provider <provider>',
    'Override observability provider (used with --preset or standalone)',
  )
  .option('--recipe <path>', 'Path or https:// URL to a recipe JSON file for pre-configured init')
  .option('--recipe-sha256 <hash>', 'Expected SHA-256 hex digest of the recipe file')
  .action(
    async (opts: {
      yes: boolean
      tools?: string
      level?: string
      language?: string
      archetype?: string
      dir?: string
      dryRun: boolean
      brownfield: boolean
      verify: boolean
      acceptBetaTools: boolean
      backend?: string
      json: boolean
      quiet: boolean
      force: boolean
      preset?: string
      authProvider?: string
      observabilityProvider?: string
      recipe?: string
      recipeSha256?: string
    }) => {
      const backend =
        opts.backend === 'github' || opts.backend === 'markdown' ? opts.backend : undefined
      await runInit({
        yes: opts.yes,
        tools: opts.tools,
        level: opts.level,
        dir: opts.dir,
        dryRun: opts.dryRun,
        brownfield: opts.brownfield,
        noVerify: !opts.verify,
        acceptBetaTools: opts.acceptBetaTools,
        ...(backend !== undefined ? { backend } : {}),
        json: opts.json,
        quiet: opts.quiet,
        force: opts.force,
        ...(opts.preset === 'industrial-grade' ? { preset: 'industrial-grade' } : {}),
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
      })
    },
  )

program
  .command('update')
  .description('Re-generate governance files using stored config (arbiter.json)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--github', 'Force GitHub setup even if disabled in stored config', false)
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
  .description('Modify arbiter.json configuration (non-interactive: use --set)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option(
    '--set <path=value>',
    'Set a config path to a value (repeatable)',
    (v, acc: string[]) => [...acc, v],
    [] as string[],
  )
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string | undefined; set: string[]; json: boolean }) => {
    runConfigure({ dir: opts.dir, sets: opts.set, json: opts.json }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`  Error: ${msg}\n`)
      process.exit(1)
    })
  })

program
  .command('diff')
  .description('Show what arbiter update would change (dry run)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { dir?: string; json: boolean }) => {
    runDiff({ dir: opts.dir, json: opts.json })
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

const review = program
  .command('review')
  .description('Review artefacts (plans, code) against governance invariants')

review
  .command('plan <file>')
  .description('Review a plan markdown file via a Claude subagent (#235)')
  .option('--dir <dir>', 'Project root (default: current directory)')
  .option('--tier <tier>', 'Review tier: XS, S, or Standard (default: S)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((file: string, opts: { dir?: string; tier?: string; json: boolean }) => {
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
      json: opts.json,
    })
    process.exit(result.exitCode)
  })

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

const verify = program
  .command('verify')
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

const graph = program.command('graph').description('Manage the provenance graph (#259)')

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
    buildOpts.format = opts.format as import('./commands/graph.js').GraphFormat
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
  .command('trace')
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
  .command('blame')
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
  .command('upgrade-level')
  .description('Upgrade governance level with a grace period for new gates')
  .option('--target <level>', 'Target level (L2, L3, or L4)')
  .option('--extend', 'Extend an existing active grace period by --days (default: 30)', false)
  .option('--days <n>', 'Grace period length in days (default: 30)', parseInt)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (opts: { target?: string; extend: boolean; days?: number; dir?: string; json: boolean }) => {
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
      if (opts.days !== undefined) upgradeOpts.days = opts.days
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
  .action((opts: { dir?: string; json: boolean; repair: boolean }) => {
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
    'Target phase (preflight|plan|red-team-review|red|green|refactor|verification|complete|red-team-rework)',
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
  .option('--task <id>', 'Task id (default: from .claude/.task-id)')
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
    'Task ID that triggered this debt filing (default: reads .claude/.task-id)',
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

const plugin = program
  .command('plugin')
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

const work = program.command('work').description('Manage work units via decomposition backend')

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
  .command('harness')
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
  .command('knowledge-map')
  .description('Regenerate KNOWLEDGE_MAP.md line counts from current doc sizes')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runKnowledgeMapUpdate({
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
  })

const notary = program.command('notary').description('Notary system — track semantic doc changes')

notary
  .command('check')
  .description('Validate Notary footer for staged doc changes (fails if footer missing)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runNotaryCheck({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) })
  })

notary
  .command('template')
  .description('Print expected Notary footer for staged doc changes')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { dir?: string }) => {
    runNotaryTemplate({ ...(opts.dir !== undefined ? { dir: opts.dir } : {}) })
  })

program
  .command('compare [paths...]')
  .description('Compare governance postures across multiple repos (#264)')
  .option('--workspace <file>', 'Path to workspace YAML spec (alternative to positional paths)')
  .option('--topic <topic>', 'Filter findings to those matching this topic')
  .option(
    '--fail-on <type>',
    'Exit non-zero when findings of type: contradiction | divergence | any',
  )
  .option('--format <path>', 'Write markdown report to this file path')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(
    (
      paths: string[],
      opts: {
        workspace?: string
        topic?: string
        failOn?: string
        format?: string
        json: boolean
      },
    ) => {
      const failOn =
        opts.failOn === 'contradiction' || opts.failOn === 'divergence' || opts.failOn === 'any'
          ? opts.failOn
          : undefined
      const result = runCompare({
        paths: paths.length > 0 ? paths : undefined,
        ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
        ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
        ...(failOn !== undefined ? { failOn } : {}),
        ...(opts.format !== undefined ? { format: opts.format } : {}),
        json: opts.json,
      })
      printCompareResult(result, opts.json)
      process.exit(result.exitCode)
    },
  )

// ── gauntlet (#260) ──────────────────────────────────────────────────────────

const gauntlet = program
  .command('gauntlet')
  .description('Pairwise/combinatorial test generation (#260)')

gauntlet
  .command('generate')
  .description('Read YAML spec, run IPOG, write test files')
  .requiredOption('--spec <path>', 'Path to gauntlet.yaml spec file')
  .requiredOption('--out <dir>', 'Output directory for generated test files')
  .option(
    '--stack <stack>',
    'Target stack: typescript | java | rust (default: typescript)',
    'typescript',
  )
  .option('--dir <dir>', 'Project root (default: current directory)')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { spec: string; out: string; stack: string; dir?: string; json: boolean }) => {
    const stackRaw = opts.stack
    const stack: GauntletStack =
      stackRaw === 'typescript' || stackRaw === 'java' || stackRaw === 'rust'
        ? stackRaw
        : 'typescript'
    const result = runGauntletGenerate({
      spec: opts.spec,
      out: opts.out,
      stack,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
    if (opts.json) {
      jsonOutput(
        'gauntlet generate',
        result.status,
        {
          exitCode: result.exitCode,
          files: result.files,
          rows: result.rows,
          graphEdges: result.graphEdges,
        },
        result.reason !== undefined ? [result.reason] : undefined,
      )
    } else if (result.status === 'ok') {
      process.stdout.write(
        `gauntlet generate: OK (${result.rows} test cases → ${result.files.length} file(s))\n`,
      )
      for (const f of result.files) process.stdout.write(`  ${f}\n`)
    } else {
      process.stderr.write(`gauntlet generate: FAIL — ${result.reason ?? 'unknown error'}\n`)
    }
    process.exit(result.exitCode)
  })

gauntlet
  .command('verify')
  .description('Check generated tests are in sync with spec hash')
  .requiredOption('--spec <path>', 'Path to gauntlet.yaml spec file')
  .requiredOption('--out <dir>', 'Directory of generated test files')
  .option('--coverage <mode>', 'Coverage mode: pairwise | 3-way (default: pairwise)', 'pairwise')
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((opts: { spec: string; out: string; coverage: string; json: boolean }) => {
    const coverage = opts.coverage === '3-way' ? '3-way' : 'pairwise'
    const result = runGauntletVerify({ spec: opts.spec, out: opts.out, coverage })
    if (opts.json) {
      jsonOutput(
        'gauntlet verify',
        result.status,
        { exitCode: result.exitCode },
        result.reason !== undefined ? [result.reason] : undefined,
      )
    } else if (result.status === 'ok') {
      process.stdout.write(`gauntlet verify: OK\n`)
    } else {
      process.stderr.write(`gauntlet verify: FAIL — ${result.reason ?? 'unknown error'}\n`)
    }
    process.exit(result.exitCode)
  })

// ── ci (#261) ─────────────────────────────────────────────────────────────────

const ci = program.command('ci').description('Governance-aware CI planning (#261)')

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
  .command('agent-rules')
  .description('Export or verify AI agent governance rules (#265)')

agentRules
  .command('export')
  .description('Export governance rules to a target AI agent format')
  .option('--target <target>', 'Target: claude | cursor | copilot | aider | windsurf', 'claude')
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
  .option('--target <target>', 'Target: claude | cursor | copilot | aider | windsurf', 'claude')
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
      const { readFileSync: rfs, existsSync: efs } = await import('node:fs')
      const { resolve: res, join: pjoin } = await import('node:path')
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

      const head = JSON.parse(rfs(headPath, 'utf-8')) as import('./graph/model.js').GraphSnapshot
      const base = efs(basePath)
        ? (JSON.parse(rfs(basePath, 'utf-8')) as import('./graph/model.js').GraphSnapshot)
        : { nodes: [], edges: [] }

      const result = runReviewDiff({ base, head })

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

function printCompareResult(
  result: import('./commands/compare.js').CompareResult,
  json: boolean,
): void {
  if (json) {
    jsonOutput('compare', result.status, {
      reposLoaded: result.reposLoaded,
      findings: result.findings,
      warnings: result.warnings,
      ...(result.reportPath !== undefined ? { reportPath: result.reportPath } : {}),
    })
    return
  }
  for (const w of result.warnings) {
    process.stderr.write(`  warning: ${w}\n`)
  }
  if (result.findings.length === 0) {
    process.stdout.write(`compare: ${result.reposLoaded} repo(s) checked — no findings\n`)
  } else {
    process.stdout.write(
      `compare: ${result.reposLoaded} repo(s) checked — ${result.findings.length} finding(s)\n`,
    )
    for (const f of result.findings) {
      process.stdout.write(`  [${f.type}] ${f.invId}: ${f.summary}\n`)
    }
  }
  if (result.reportPath !== undefined) {
    process.stdout.write(`  report written to ${result.reportPath}\n`)
  }
}

program
  .command('explain [code]')
  .description('Show detailed explanation for an error code, INV-NN invariant, or CANON-NN rule')
  .option('--format <format>', 'Output format: text (default) or json')
  .option('--list', 'List all known codes grouped by category')
  .action((code: string | undefined, opts: { format?: string; list?: boolean }) => {
    const result = runExplain(code ?? '', opts)
    if (result.output) process.stdout.write(result.output)
    if (result.error) process.stderr.write(result.error)
    if (result.exitCode !== 0) process.exit(result.exitCode)
  })

const benchmark = program.command('benchmark').description('Performance benchmarks for arbiter')

benchmark
  .command('hooks')
  .description('Measure hook latency (p50/p95/p99 per hook)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--iterations <n>', 'Iterations per hook (default: 20)', '20')
  .option('--json', 'Emit machine-readable JSON output', false)
  .option('--baseline <file>', 'Path to baseline JSON file')
  .action((opts: { dir?: string; iterations?: string; json?: boolean; baseline?: string }) => {
    const benchOpts: import('./commands/benchmark.js').BenchmarkHooksOptions = {}
    if (opts.dir !== undefined) benchOpts.dir = opts.dir
    if (opts.iterations !== undefined) benchOpts.iterations = parseInt(opts.iterations, 10)
    if (opts.json !== undefined) benchOpts.json = opts.json
    if (opts.baseline !== undefined) benchOpts.baselineFile = opts.baseline
    const result = runBenchmarkHooks(benchOpts)
    if (result.regressions.length > 0 && !opts.json) process.exit(1)
  })

// ── experiments — list and inspect registered experiments (#601) ─────────────

const experiments = program
  .command('experiments')
  .description('Inspect registered experimental features')

experiments
  .command('list')
  .description('List all registered experiments and their status')
  .action(() => {
    const all = listExperiments()
    if (all.length === 0) {
      process.stdout.write(`${t('cli.experiments.none')}\n`)
      return
    }
    const activeFlags: Record<string, boolean> = (() => {
      try {
        return JSON.parse(process.env['ARBITER_EXPERIMENTAL'] ?? '{}') as Record<string, boolean>
      } catch {
        return {}
      }
    })()
    for (const exp of all) {
      const active = isEnabled(exp.name, activeFlags)
      const status = active ? '[active]' : '[inactive]'
      process.stdout.write(
        `  ${status} --experimental.${exp.name}  (${exp.stabilityTarget}, added ${exp.addedIn})\n`,
      )
      process.stdout.write(
        `${t('cli.experiments.criteria', { criteria: exp.promotionCriteria })}\n`,
      )
    }
  })

// ── kit — read-only kit catalog commands (--experimental.kit) ─────────────────

const kit = program
  .command('kit')
  .description('Cross-stack governance kit commands (requires --experimental.kit)')

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
  .option('--language <lang>', 'Project language (e.g. java, typescript)', 'java')
  .addOption(
    new Option('--brownfield-class <cls>', 'Brownfield class (auto-detected if omitted)')
      .choices(['gold', 'light', 'medium', 'heavy'])
      .default('gold'),
  )
  .option('--dry-run', 'Skip file writes (scaffold phase reports only)', false)
  .action(
    (opts: { targetDir: string; language: string; brownfieldClass: string; dryRun: boolean }) => {
      const result = runKitInstall({
        targetDir: opts.targetDir,
        language: opts.language,
        brownfieldClass: opts.brownfieldClass as BrownfieldClass,
        dryRun: opts.dryRun,
      })
      for (const phase of result.phases) {
        process.stdout.write(`[${phase.phase}] ${phase.output}\n`)
      }
      if (!result.ok) {
        process.stderr.write(`[kit install] ${result.error ?? 'unknown error'}\n`)
        process.exit(1)
      }
    },
  )

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

_main().catch((err: unknown) => {
  if (err instanceof ArbiterError) {
    process.stderr.write(`\nError [${err.code}]: ${err.message}\n`)
    if (err.hint) process.stderr.write(`  Hint: ${err.hint}\n`)
    if (err.docUrl) process.stderr.write(`  Docs: ${err.docUrl}\n`)
    process.stderr.write(`\nRun \`arbiter explain ${err.code}\` for more detail.\n`)
    if (_verbose && err.stack) process.stderr.write(`\n${err.stack}\n`)
  } else if (err instanceof UserFacingError) {
    process.stderr.write(`Error: ${err.message}\n`)
    if (_verbose && err.stack) process.stderr.write(`\n${err.stack}\n`)
  } else if (err instanceof Error) {
    process.stderr.write(`Unexpected error: ${err.message}\n`)
    if (_verbose) {
      process.stderr.write(`${err.stack ?? ''}\n`)
    }
  } else {
    process.stderr.write(`Unexpected error: ${String(err)}\n`)
  }
  process.exit(1)
})
