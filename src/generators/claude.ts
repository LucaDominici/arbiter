// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, mergeSettingsJson, resolvedPath } from '../utils/fs.js'
import { DEFAULT_TASK_TIERS } from '../config/schema.js'
import { resolveCollaborationAxes } from '../config/collaboration-mode-defaults.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface ClaudeGeneratorResult {
  files: WriteResult[]
}

/**
 * Build the EJS render context for `.claude/*.ejs` templates.
 *
 * We inject SSOT-derived data here so templates never duplicate magic
 * numbers (#235, #236, #237):
 *   - `taskTiers`       → resolved from config or DEFAULT_TASK_TIERS
 *   - `collaborationMode`, `mergeMode`, `worktreeMode`, `branchingStrategy`,
 *     `pipelineStyle`   → from resolveCollaborationAxes (ADR-051 §#1119, wires
 *     the previously dead resolveDefaultMergeMode/resolveDefaultWorktreeMode)
 */
export function buildRenderContext(config: ProjectConfig): Record<string, unknown> {
  const taskTiers = config.taskTiers ?? DEFAULT_TASK_TIERS
  // Resolve the full axis bundle. Explicit spreads beat ...config so the resolved
  // values are always present even if config fields are absent (legacy projects).
  const axes = resolveCollaborationAxes(config)
  return {
    ...config,
    taskTiers,
    ...axes,
  }
}

export function generateClaude(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): ClaudeGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = buildRenderContext(config)

  // CLAUDE.md is hand-customizable and routes through the adopt policy. A pristine
  // file still refreshes through the #1328 provenance path; a user-modified one is
  // withheld unless explicitly adopted.
  results.push(
    writeFile(
      resolvedPath(base, '.claude', 'CLAUDE.md'),
      renderTemplate('claude/CLAUDE.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  generateClaudeSettings(base, data, results, opts.dryRun)
  generateClaudeHooks(base, data, config, results, opts.dryRun)
  generateClaudeRules(base, data, config, results, opts.dryRun)
  generateClaudeCommands(base, data, results, opts.dryRun)

  // Machine-readable track routing map (#720)
  results.push(
    writeFile(
      resolvedPath(base, '.claude', 'knowledge-map.json'),
      renderTemplate('claude/knowledge-map.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  )

  return { files: results }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function parseExistingSettings(settingsPath: string): Record<string, unknown> {
  const raw = readFileSync(settingsPath, 'utf-8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Failed to parse existing .claude/settings.json: ${msg}. Fix or delete and re-run.`,
      { cause: err },
    )
  }
  if (!isPlainObject(parsed)) {
    const kind = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed
    throw new Error(
      `Failed to parse existing .claude/settings.json: expected JSON object, got ${kind}. Fix or delete and re-run.`,
    )
  }
  return parsed
}

function generateClaudeSettings(
  base: string,
  data: object,
  results: WriteResult[],
  dryRun: boolean,
): void {
  const settingsPath = resolvedPath(base, '.claude', 'settings.json')
  if (!existsSync(settingsPath)) {
    results.push(
      writeFile(settingsPath, renderTemplate('claude/settings.json.ejs', data), { dryRun }),
    )
    return
  }

  // Existing settings.json: merge incoming defaults into the user's file. Only
  // the MERGE is bespoke — the write is not. #2120: this generator used to
  // compare, `copyFileSync` the backup and `writeFileSync` the result itself,
  // which made `.claude/settings.json` the one emitted file no protection
  // mechanism reached: not the generated manifest, not `arbiter:preserve`
  // (#1980), not the adopt/plan machinery. Hand the merged text to `writeFile`
  // instead and every one of them applies. The three outcomes are unchanged —
  // byte-identical → `skipped`, otherwise `backed-up-and-replaced` writing
  // `<path>.arbiter-backup` first (#285), nothing at all under dryRun — with
  // an atomic temp+rename replacing the bare writeFileSync.
  const existing = parseExistingSettings(settingsPath)
  const incoming = JSON.parse(renderTemplate('claude/settings.json.ejs', data)) as Record<
    string,
    unknown
  >
  const merged = mergeSettingsJson(existing, incoming)
  const mergedText = JSON.stringify(merged, null, 2) + '\n'

  results.push(writeFile(settingsPath, mergedText, { backup: true, dryRun }))
}

// L2+ advanced hooks emitted for every target (guard-done-evidence is added
// conditionally on enableEvidenceHarness). stop-evidence-guard is the #1212
// fail-closed Stop completion backstop (INV-114).
const L2_ADVANCED_HOOKS = [
  'post-edit-dispatch.mjs',
  'debug-state-on-failure.mjs',
  'skill-forced-eval.mjs',
  'guard-task-completion.mjs',
  'stop-evidence-guard.mjs',
  // #A11 — CLOSER mode enforcement (PreToolUse:Bash), active only in the `close` phase.
  'closer-mode-guard.mjs',
  // #1331: registered in hooks.mjs HANDLERS at L2+ (ExitPlanMode banner, #1210)
  // but historically never emitted — dead config (same ghost class as #1318.5).
  'exitplanmode-banner.mjs',
  // E6b (#1948): finding-loss Stop hook — activated in the dispatcher Stop chain.
  // Emitted at L2+ (design doc §E6b tier: advisory solo/team, hard gated-review).
  'stop-finding-loss.mjs',
] as const

/** One planned .claude/hooks/ emission: either a template render or a literal body. */
export interface ClaudeHookPlanEntry {
  file: string
  template?: string
  body?: string
}

/**
 * The declarative plan of every hook generateClaudeHooks emits for `config`,
 * in emission order (ADR-106, #1966). Single source shared by the emitter
 * below and by the generated CODEX.md Known Limitations inventory
 * (src/generators/codex-known-limitations.ts) so the two can never drift:
 * the table is derived from the same plan the writer executes.
 */
export function planClaudeHooks(config: ProjectConfig): ClaudeHookPlanEntry[] {
  const isTs = config.language === 'typescript' || config.language === 'multi'
  const entries: ClaudeHookPlanEntry[] = []
  const tpl = (file: string, template: string): void => {
    entries.push({ file, template })
  }

  // Dispatcher (#248) — single entry point for all events; config table is baked in
  tpl('hooks.mjs', 'claude/hooks/hooks.mjs.ejs')
  for (const f of [
    'stop-dangerous.mjs',
    'enforce-read-only.mjs',
    'pre-edit-ssot-guard.mjs',
    'check-no-orphan-todo.mjs',
    'check-no-placeholders.mjs',
    'enforce-gate-before-pr.mjs',
    // E5 (#1947): emitted at ALL levels (M9 never scales down, design doc §E5)
    // and wired through PreToolUse:Task|Agent.
    'pre-spawn-worktree-guard.mjs',
  ]) {
    const renderedForLanguage =
      f === 'check-no-orphan-todo.mjs' || f === 'check-no-placeholders.mjs'
    tpl(f, `claude/hooks/${f}${renderedForLanguage ? '.ejs' : ''}`)
  }
  for (const f of ['lib.mjs', 'post-commit-check.mjs']) {
    tpl(f, `claude/hooks/${f}.ejs`)
  }
  if (isTs) tpl('check-no-unused-exports.mjs', 'claude/hooks/check-no-unused-exports.mjs')
  if (config.enableNoSkippedTests !== false) {
    tpl('check-no-skipped-tests.mjs', 'claude/hooks/check-no-skipped-tests.mjs')
  }
  for (const hook of config.languageHooks) {
    if (hook.name !== 'check-no-orphan-todo.mjs') {
      entries.push({ file: hook.name, body: hook.body })
    }
  }
  // Advanced hooks — generated for all governance levels
  tpl('pre-edit-plan-anchor.mjs', 'claude/hooks/pre-edit-plan-anchor.mjs.ejs')
  tpl('pre-compact.mjs', 'claude/hooks/pre-compact.mjs.ejs')
  // Advanced hooks — L2+ only (post-edit/debug/skill/completion/evidence guards
  // plus the brainstorm terminal-state guardrail, #1265)
  if (config.governanceLevel !== 'L1') {
    for (const f of L2_ADVANCED_HOOKS) tpl(f, `claude/hooks/${f}.ejs`)
    // Evidence guard only when evidence harness is enabled (mirrors CLI/config emission)
    if (config.enableEvidenceHarness !== false) {
      tpl('guard-done-evidence.mjs', 'claude/hooks/guard-done-evidence.mjs.ejs')
    }
    tpl('post-brainstorm-stop.mjs', 'claude/hooks/post-brainstorm-stop.mjs')
  }
  // TypeScript hooks — circular dep detection (INV-01)
  if (isTs) tpl('check-circular-deps.mjs', 'claude/hooks/check-circular-deps.mjs.ejs')

  return entries
}

function generateClaudeHooks(
  base: string,
  data: object,
  config: ProjectConfig,
  results: WriteResult[],
  dryRun: boolean,
): void {
  const hooksDir = resolvedPath(base, '.claude', 'hooks')
  if (!dryRun) mkdirSync(hooksDir, { recursive: true })

  for (const entry of planClaudeHooks(config)) {
    // Plan invariant: every entry carries exactly one of template|body
    // (planClaudeHooks constructs them), so no runtime fallback exists here.
    const content = entry.body ?? renderTemplate(entry.template as string, data)
    results.push(
      writeFile(join(hooksDir, entry.file), content, {
        skipIfExists: true,
        dryRun,
      }),
    )
  }
}

/**
 * The declarative plan of every .claude/rules/ emission for `config`, in
 * emission order. Shared with codex-known-limitations.ts (ADR-106) so the
 * Claude-only rule delta in CODEX.md is derived, never hand-maintained.
 */
export function planClaudeRules(config: ProjectConfig): { file: string; template: string }[] {
  const rules = [
    {
      file: '05-agent-lifecycle.md',
      template: 'claude/rules/05-agent-lifecycle.md',
    },
    {
      file: '25-todo-folder-policy.md',
      template: 'claude/rules/25-todo-folder-policy.md',
    },
    {
      file: '40-context-economy.md',
      template: 'claude/rules/40-context-economy.md',
    },
    {
      file: '50-batch-execution.md',
      template: 'claude/rules/50-batch-execution.md',
    },
    {
      file: '55-brainstorm-terminal-state.md',
      template: 'claude/rules/55-brainstorm-terminal-state.md',
    },
    {
      file: '60-incidental-capture.md',
      template: 'claude/rules/60-incidental-capture.md',
    },
    {
      // #1448: read the impact-map (blast radius) before editing a shared/core module.
      file: '75-impact-vault-reading.md',
      template: 'claude/rules/75-impact-vault-reading.md',
    },
    {
      file: '90-exec-protocol.md',
      template: 'claude/rules/90-exec-protocol.md.ejs',
    },
    {
      // #A11 (handoff §A11) — CLOSER mode: last-mile rule for the task lifecycle's `close`
      // phase (post-implementation, pre-merge). Always installed like the other core rules.
      file: '95-closer-mode.md',
      template: 'claude/rules/95-closer-mode.md',
    },
  ]
  if (config.enableMcpFallback) {
    rules.push({ file: '45-mcp-fallback.md', template: 'claude/rules/45-mcp-fallback.md' })
  }
  return rules
}

function generateClaudeRules(
  base: string,
  data: object,
  config: ProjectConfig,
  results: WriteResult[],
  dryRun: boolean,
): void {
  const rulesDir = resolvedPath(base, '.claude', 'rules')
  for (const rule of planClaudeRules(config)) {
    results.push(
      writeFile(join(rulesDir, rule.file), renderTemplate(rule.template, data), {
        skipIfExists: true,
        dryRun,
      }),
    )
  }
}

/**
 * Every .claude/commands/ emission, in emission order. Shared with
 * codex-known-limitations.ts (ADR-106): the Claude-only command inventory in
 * CODEX.md is derived from this list, never hand-maintained.
 */
export const CLAUDE_COMMANDS: readonly string[] = [
  'task.md',
  'ship.md',
  'drain.md',
  'impact.md',
  'gold-audit.md',
  'wt-open.md',
  'wt-close.md',
  'wt-list.md',
  'wt-prune.md',
  'close-gold-gap.md',
  'levelup.md',
]

function generateClaudeCommands(
  base: string,
  data: object,
  results: WriteResult[],
  dryRun: boolean,
): void {
  const commandsDir = resolvedPath(base, '.claude', 'commands')
  for (const cmd of CLAUDE_COMMANDS) {
    results.push(
      writeFile(join(commandsDir, cmd), renderTemplate(`claude/commands/${cmd}.ejs`, data), {
        skipIfExists: true,
        dryRun,
      }),
    )
  }
}
