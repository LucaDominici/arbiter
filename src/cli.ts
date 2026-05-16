#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { Command } from 'commander'
import { runInit } from './commands/init.js'
import { runUpdate } from './commands/update.js'
import { runDiff } from './commands/diff.js'
import { runConfigure } from './commands/configure.js'
import { runWorktreeOpen, runWorktreeClose, runWorktreeList } from './commands/worktree.js'
import { runVerify, runVerifyEvidence } from './commands/verify.js'
import { runVerifyPlan } from './commands/verify-plan.js'
import { loadConfig } from './utils/config.js'
import { loadPlugin } from './utils/plugin-loader.js'
import { runReviewCode, runReviewPlan } from './commands/review.js'
import { jsonOutput } from './utils/json-output.js'
import type { ReviewTier } from './review/tier-constants.js'
import { runUpgradeLevel } from './commands/upgrade-level.js'
import { runPluginAdd, runPluginRemove, runPluginList, runPluginInit } from './commands/plugin.js'
import { runTaskAdvance, runTaskResume } from './commands/task.js'
import type { TaskPhase } from './commands/task.js'
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
import { UserFacingError } from './utils/errors.js'

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
  if (_evidenceLogged || _noEvidence) return
  _evidenceLogged = true
  appendEvidenceLine({
    ts: new Date().toISOString(),
    cmd: _parsedCmd.cmd,
    args: _parsedCmd.args,
    exit: code,
    durationMs: Date.now() - _startMs,
    headSha: _headSha,
  })
})

// ─────────────────────────────────────────────────────────────────────────────

const program = new Command()

program.name('arbiter').description('AI development governance framework').version('0.1.0')

program
  .command('init')
  .description('Initialize AI governance in a project')
  .option('-y, --yes', 'Skip wizard — use auto-detected defaults', false)
  .option(
    '--tools <tools>',
    'Comma-separated list of AI tools (claude,codex,cursor,copilot,gemini,windsurf,aider)',
  )
  .option('--level <level>', 'Governance level: L1, L2, or L3', 'L2')
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
  .action(
    async (opts: {
      yes: boolean
      tools?: string
      level?: string
      dir?: string
      dryRun: boolean
      brownfield: boolean
      verify: boolean
      acceptBetaTools: boolean
      backend?: string
      json: boolean
      quiet: boolean
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
      })
    },
  )

program
  .command('update')
  .description('Re-generate governance files using stored config (arbiter.json)')
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .option('--github', 'Force GitHub setup even if disabled in stored config', false)
  .option('--json', 'Emit machine-readable JSON output', false)
  .action(async (opts: { dir?: string; github: boolean; json: boolean }) => {
    await runUpdate({
      dir: opts.dir,
      github: opts.github,
      json: opts.json,
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
    runConfigure({ dir: opts.dir, sets: opts.set, json: opts.json })
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
  .option('--json', 'Emit machine-readable JSON output', false)
  .action((taskId: string, slug: string | undefined, opts: { base: string; json: boolean }) => {
    runWorktreeOpen({
      taskId,
      ...(slug !== undefined ? { slug } : {}),
      base: opts.base,
      json: opts.json,
    })
  })

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
      console.error(`  Error: invalid --tier "${opts.tier}". Valid: XS, S, Standard.`)
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
        console.error(`  Error: invalid --tier "${opts.tier}". Valid: XS, S, Standard.`)
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
  .option('--target <level>', 'Target level (L2 or L3)')
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
        if (opts.target !== 'L2' && opts.target !== 'L3') {
          console.error(`  Error: invalid --target "${opts.target}". Valid values: L2, L3.`)
          process.exit(1)
        }
        upgradeOpts.target = opts.target
      }
      if (opts.days !== undefined) upgradeOpts.days = opts.days
      if (opts.dir !== undefined) upgradeOpts.dir = opts.dir
      runUpgradeLevel(upgradeOpts)
    },
  )

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
    'Target phase (preflight|plan|implementation|verification|complete)',
  )
  .option('--reverse', 'Allow backward phase transitions', false)
  .option('--dir <dir>', 'Target directory (default: current directory)')
  .action((opts: { to: string; reverse: boolean; dir?: string }) => {
    runTaskAdvance({
      to: opts.to as TaskPhase,
      reverse: opts.reverse,
      ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    })
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
  .action((pkg: string, opts: { dir?: string; json: boolean }) => {
    runPluginRemove({
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

program.parseAsync().catch((err: unknown) => {
  if (err instanceof UserFacingError) {
    process.stderr.write(`Error: ${err.message}\n`)
  } else if (err instanceof Error) {
    process.stderr.write(`Unexpected error: ${err.message}\n${err.stack ?? ''}\n`)
  } else {
    process.stderr.write(`Unexpected error: ${String(err)}\n`)
  }
  process.exit(1)
})
