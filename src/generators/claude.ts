// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, mergeSettingsJson, resolvedPath } from '../utils/fs.js'
import { DEFAULT_TASK_TIERS } from '../config/schema.js'
import { TIER_REVIEWER_COUNT, type ReviewTier } from '../review/tier-constants.js'
import { AGENT_PERSONAS } from '../review/multi-agent.js'
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
 *   - `taskTiers`     → resolved from config or DEFAULT_TASK_TIERS
 *   - `reviewerCount` → from TIER_REVIEWER_COUNT (review-code SSOT)
 *   - `personasForTier` → AGENT_PERSONAS filtered per tier, for prompt rendering
 */
function buildRenderContext(config: ProjectConfig): Record<string, unknown> {
  const taskTiers = config.taskTiers ?? DEFAULT_TASK_TIERS
  const personasForTier: Record<ReviewTier, readonly string[]> = {
    XS: AGENT_PERSONAS.filter((p) => p.tiers.includes('XS')).map((p) => p.name),
    S: AGENT_PERSONAS.filter((p) => p.tiers.includes('S')).map((p) => p.name),
    Standard: AGENT_PERSONAS.filter((p) => p.tiers.includes('Standard')).map((p) => p.name),
  }
  return {
    ...config,
    taskTiers,
    reviewerCount: TIER_REVIEWER_COUNT,
    personasForTier,
  }
}

export function generateClaude(config: ProjectConfig): ClaudeGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = buildRenderContext(config)

  // CLAUDE.md — always rewrite (thin pointer)
  results.push(
    writeFile(
      resolvedPath(base, '.claude', 'CLAUDE.md'),
      renderTemplate('claude/CLAUDE.md.ejs', data),
      { backup: true },
    ),
  )

  generateClaudeSettings(base, data, results)
  generateClaudeHooks(base, data, config, results)
  generateClaudeRules(base, data, config, results)
  generateClaudeCommands(base, data, results)

  // Machine-readable track routing map (#720)
  results.push(
    writeFile(
      resolvedPath(base, '.claude', 'knowledge-map.json'),
      renderTemplate('claude/knowledge-map.json.ejs', data),
      { skipIfExists: true },
    ),
  )

  return { files: results }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function parseExistingSettings(settingsPath: string): Record<string, unknown> {
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

function generateClaudeSettings(base: string, data: object, results: WriteResult[]): void {
  const settingsPath = resolvedPath(base, '.claude', 'settings.json')
  if (existsSync(settingsPath)) {
    const existing = parseExistingSettings(settingsPath)
    const incoming = JSON.parse(renderTemplate('claude/settings.json.ejs', data)) as Record<
      string,
      unknown
    >
    const merged = mergeSettingsJson(existing, incoming)
    // Always overwrite the backup with the current pre-merge state so users can undo
    // this specific merge. Long-term history lives in git, not in .arbiter-backup (#285).
    copyFileSync(settingsPath, `${settingsPath}.arbiter-backup`)
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
    results.push({ path: settingsPath, action: 'backed-up-and-replaced' })
  } else {
    results.push(writeFile(settingsPath, renderTemplate('claude/settings.json.ejs', data)))
  }
}

function generateClaudeHooks(
  base: string,
  data: object,
  config: ProjectConfig,
  results: WriteResult[],
): void {
  const hooksDir = resolvedPath(base, '.claude', 'hooks')
  mkdirSync(hooksDir, { recursive: true })

  // Dispatcher (#248) — single entry point for all events; config table is baked in
  results.push(
    writeFile(join(hooksDir, 'hooks.mjs'), renderTemplate('claude/hooks/hooks.mjs.ejs', data), {
      skipIfExists: true,
    }),
  )

  const staticHooks = [
    'stop-dangerous.mjs',
    'enforce-read-only.mjs',
    'pre-edit-ssot-guard.mjs',
    'check-no-orphan-todo.mjs',
    'check-no-placeholders.mjs',
  ]
  for (const hookFile of staticHooks) {
    results.push(
      writeFile(join(hooksDir, hookFile), renderTemplate(`claude/hooks/${hookFile}`, data), {
        skipIfExists: true,
      }),
    )
  }

  results.push(
    writeFile(join(hooksDir, 'lib.mjs'), renderTemplate('claude/hooks/lib.mjs.ejs', data), {
      skipIfExists: true,
    }),
  )
  results.push(
    writeFile(
      join(hooksDir, 'post-commit-check.mjs'),
      renderTemplate('claude/hooks/post-commit-check.mjs.ejs', data),
      { skipIfExists: true },
    ),
  )

  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        join(hooksDir, 'check-no-unused-exports.mjs'),
        renderTemplate('claude/hooks/check-no-unused-exports.mjs', data),
        { skipIfExists: true },
      ),
    )
  }

  if (config.enableNoSkippedTests !== false) {
    results.push(
      writeFile(
        join(hooksDir, 'check-no-skipped-tests.mjs'),
        renderTemplate('claude/hooks/check-no-skipped-tests.mjs', data),
        { skipIfExists: true },
      ),
    )
  }

  for (const hook of config.languageHooks) {
    if (hook.name !== 'check-no-orphan-todo.mjs') {
      results.push(writeFile(join(hooksDir, hook.name), hook.body, { skipIfExists: true }))
    }
  }

  // Track-detection hook — UserPromptSubmit (#720)
  results.push(
    writeFile(
      join(hooksDir, 'pre-task-track-detect.mjs'),
      renderTemplate('claude/hooks/pre-task-track-detect.mjs.ejs', data),
      { skipIfExists: true },
    ),
  )

  // Advanced hooks — generated for all governance levels
  for (const hookFile of ['pre-edit-plan-anchor.mjs', 'pre-compact.mjs']) {
    results.push(
      writeFile(join(hooksDir, hookFile), renderTemplate(`claude/hooks/${hookFile}.ejs`, data), {
        skipIfExists: true,
      }),
    )
  }

  // Advanced hooks — L2+ only
  if (config.governanceLevel !== 'L1') {
    const advancedHooks = [
      'post-edit-dispatch.mjs',
      'debug-state-on-failure.mjs',
      'skill-forced-eval.mjs',
      'guard-task-completion.mjs',
    ]
    // Evidence guard only when evidence harness is enabled (mirrors CLI/config emission)
    if (config.enableEvidenceHarness !== false) {
      advancedHooks.push('guard-done-evidence.mjs')
    }
    for (const hookFile of advancedHooks) {
      results.push(
        writeFile(join(hooksDir, hookFile), renderTemplate(`claude/hooks/${hookFile}.ejs`, data), {
          skipIfExists: true,
        }),
      )
    }
  }

  // TypeScript hooks — circular dep detection (INV-01)
  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        join(hooksDir, 'check-circular-deps.mjs'),
        renderTemplate('claude/hooks/check-circular-deps.mjs.ejs', data),
        { skipIfExists: true },
      ),
    )
  }
}

function generateClaudeRules(
  base: string,
  data: object,
  config: ProjectConfig,
  results: WriteResult[],
): void {
  const rulesDir = resolvedPath(base, '.claude', 'rules')
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
      file: '90-exec-protocol.md',
      template: 'claude/rules/90-exec-protocol.md.ejs',
    },
  ]
  for (const rule of rules) {
    results.push(
      writeFile(join(rulesDir, rule.file), renderTemplate(rule.template, data), {
        skipIfExists: true,
      }),
    )
  }
  if (config.enableMcpFallback) {
    results.push(
      writeFile(
        join(rulesDir, '45-mcp-fallback.md'),
        renderTemplate('claude/rules/45-mcp-fallback.md', data),
        { skipIfExists: true },
      ),
    )
  }
}

function generateClaudeCommands(base: string, data: object, results: WriteResult[]): void {
  const commandsDir = resolvedPath(base, '.claude', 'commands')
  const commands = [
    'task.md',
    'wt-open.md',
    'wt-close.md',
    'wt-list.md',
    'wt-prune.md',
    'review-plan.md',
    'review-code.md',
  ]
  for (const cmd of commands) {
    results.push(
      writeFile(join(commandsDir, cmd), renderTemplate(`claude/commands/${cmd}.ejs`, data), {
        skipIfExists: true,
      }),
    )
  }
}
