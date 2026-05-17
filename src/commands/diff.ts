// SPDX-License-Identifier: Apache-2.0
import { resolve, basename } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { detectLanguage } from '../detectors/language.js'
import { detectBuildCommands } from '../detectors/build.js'
import { detectFramework } from '../detectors/framework.js'
import { detectGitInfo } from '../detectors/git.js'
import { detectExisting } from '../detectors/existing.js'
import { getLanguageHooks } from '../detectors/language-hooks.js'
import { resolveAxisFields } from '../detectors/axis.js'
import { loadConfig } from '../utils/config.js'
import { renderTemplate } from '../utils/render.js'
import { resolvedPath } from '../utils/fs.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { t } from '../i18n/index.js'
import type { ProjectConfig } from '../wizard/types.js'
import {
  presetToTiers,
  defaultPresetForLevel,
  getFilteredInvariants,
  getInvariantsByTier,
} from '../invariants/filter.js'
import { TIER_LABELS } from '../invariants/tiers.js'

export interface DiffOptions {
  dir: string | undefined
  json?: boolean | undefined
}

interface DiffCheck {
  path: string
  templateKey: string
  content: () => string
}

export function runDiff(options: DiffOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd())
  const projectName = basename(targetDir)

  if (!options.json) {
    console.log(t('cli.diff.banner'))
  }

  const stored = loadConfig(targetDir)
  if (!stored) {
    if (options.json) {
      jsonOutput('diff', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
      process.exit(statusToExitCode('error'))
      return
    }
    console.log(t('cli.diff.no_config'))
    process.exit(statusToExitCode('error'))
  }

  const config = buildDiffConfig(targetDir, projectName, stored)
  const invariants = getFilteredInvariants({
    language: config.language,
    governanceLevel: config.governanceLevel,
    invariantTiers: config.invariantTiers,
  })
  const data = {
    ...config,
    invariants,
    invariantsByTier: getInvariantsByTier(invariants),
    tierLabels: TIER_LABELS,
  }
  const checks = buildDiffChecks(targetDir, config, data)

  const files: Array<{ key: string; status: 'new' | 'changed' | 'unchanged' }> = []
  let hasChanges = false

  for (const check of checks) {
    const incoming = check.content()
    if (!existsSync(check.path)) {
      files.push({ key: check.templateKey, status: 'new' })
      hasChanges = true
      if (!options.json) console.log(t('cli.diff.new_file', { key: check.templateKey }))
    } else {
      const current = readFileSync(check.path, 'utf-8')
      if (current !== incoming) {
        files.push({ key: check.templateKey, status: 'changed' })
        hasChanges = true
        if (!options.json) console.log(t('cli.diff.changed_file', { key: check.templateKey }))
      } else {
        files.push({ key: check.templateKey, status: 'unchanged' })
        if (!options.json) console.log(t('cli.diff.unchanged_file', { key: check.templateKey }))
      }
    }
  }

  if (options.json) {
    const status = hasChanges ? 'warning' : 'ok'
    jsonOutput('diff', status, { hasChanges, files })
    const code = statusToExitCode(status)
    if (code !== 0) process.exit(code)
    return
  }

  if (!hasChanges) {
    console.log(t('cli.diff.up_to_date'))
  } else {
    console.log(t('cli.diff.run_update'))
  }
}

function buildDiffConfig(
  targetDir: string,
  projectName: string,
  stored: ReturnType<typeof loadConfig> & object,
): ProjectConfig {
  const language = detectLanguage(targetDir)
  const framework = detectFramework(targetDir, language)
  const buildCmds = detectBuildCommands(targetDir, language)
  const gitInfo = detectGitInfo(targetDir)
  const existing = detectExisting(targetDir)
  const axis = resolveAxisFields(stored, targetDir, language, framework)

  return {
    targetDir,
    projectName,
    description: `${projectName} project`,
    language,
    framework,
    ...axis,
    buildTool: buildCmds.buildTool,
    buildCommand: buildCmds.buildCommand,
    testCommand: buildCmds.testCommand,
    lintCommand: buildCmds.lintCommand,
    formatCommand: buildCmds.formatCommand,
    tools: stored.tools,
    governanceLevel: stored.governanceLevel,
    useGitHub: stored.useGitHub,
    githubOwner: gitInfo.githubOwner,
    githubRepo: gitInfo.githubRepo,
    existing,
    languageHooks: getLanguageHooks(language),
    enableDebtGates: stored.features.debtGates,
    enableSuppressions: stored.features.suppressions,
    enableSecurityScanning: stored.features.securityScanning,
    invariantTiers:
      stored.invariantTiers ?? presetToTiers(defaultPresetForLevel(stored.governanceLevel)),
  }
}

function buildDiffChecks(
  targetDir: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
): DiffCheck[] {
  const OPTIONAL_TIERS = ['data', 'security', 'operational']
  const hasOptionalTiers = config.invariantTiers.some((t) => OPTIONAL_TIERS.includes(t))

  const checks: DiffCheck[] = [
    {
      path: resolvedPath(targetDir, 'AGENTS.md'),
      templateKey: 'AGENTS.md',
      content: () => renderTemplate('agents-md/AGENTS.md.ejs', data),
    },
  ]

  if (hasOptionalTiers) {
    checks.push({
      path: resolvedPath(targetDir, 'GLOBAL_INVARIANTS.md'),
      templateKey: 'GLOBAL_INVARIANTS.md',
      content: () => renderTemplate('global-invariants/GLOBAL_INVARIANTS.md.ejs', data),
    })
  }

  if (config.tools.includes('claude')) {
    checks.push({
      path: resolvedPath(targetDir, '.claude', 'CLAUDE.md'),
      templateKey: '.claude/CLAUDE.md',
      content: () => renderTemplate('claude/CLAUDE.md.ejs', data),
    })
  }
  if (config.tools.includes('codex')) {
    checks.push({
      path: resolvedPath(targetDir, '.agents', 'CODEX.md'),
      templateKey: '.agents/CODEX.md',
      content: () => renderTemplate('codex/CODEX.md.ejs', data),
    })
  }
  if (config.tools.includes('cursor')) {
    checks.push({
      path: resolvedPath(targetDir, '.cursorrules'),
      templateKey: '.cursorrules',
      content: () => renderTemplate('cursor/.cursorrules.ejs', data),
    })
  }
  if (config.tools.includes('copilot')) {
    checks.push({
      path: resolvedPath(targetDir, '.github', 'copilot-instructions.md'),
      templateKey: '.github/copilot-instructions.md',
      content: () => renderTemplate('copilot/copilot-instructions.md.ejs', data),
    })
  }
  if (config.tools.includes('gemini')) {
    checks.push({
      path: resolvedPath(targetDir, '.gemini', 'GEMINI.md'),
      templateKey: '.gemini/GEMINI.md',
      content: () => renderTemplate('gemini/GEMINI.md.ejs', data),
    })
  }
  if (config.tools.includes('windsurf')) {
    checks.push({
      path: resolvedPath(targetDir, 'windsurf-instructions.md'),
      templateKey: 'windsurf-instructions.md',
      content: () => renderTemplate('windsurf/windsurf-instructions.md.ejs', data),
    })
  }
  if (config.tools.includes('aider')) {
    checks.push({
      path: resolvedPath(targetDir, '.aider.conf.yml'),
      templateKey: '.aider.conf.yml',
      content: () => renderTemplate('aider/.aider.conf.yml.ejs', data),
    })
  }

  return checks
}
