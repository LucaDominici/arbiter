// SPDX-License-Identifier: Apache-2.0
//
// #1839 (F3 friction cut): extracted from init.ts — GitHub backend setup (labels,
// branch protection, project board provisioning). Pure extraction, no behavior change.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FatalError, ConfigError } from '../../utils/errors.js'
import { provisionLabels } from '../../github/labels.js'
import { applyBranchProtection } from '../../github/branch-protection.js'
import { createProjectBoard } from '../../github/project-board.js'
import type { GhErrorKind } from '../../github/classify-gh-error.js'
import { resolveCollaborationMode } from '../../config/collaboration-mode-defaults.js'
import type { ProjectConfig, CollaborationMode } from '../../wizard/types.js'

interface BackendResult {
  warnings: string[]
}

function throwOnFatalOrConfig(kind: GhErrorKind, msg: string, warnings: string[]): void {
  if (kind === 'fatal') throw new FatalError('E_GH_FATAL', msg, { recoverableContext: warnings })
  if (kind === 'config') throw new ConfigError('E_GH_NOT_INSTALLED', msg)
}

function setupLabels(
  owner: string,
  repo: string,
  warnings: string[],
  log: (msg: string) => void,
): void {
  const labelResult = provisionLabels(owner, repo)
  if (labelResult.created.length > 0) log(`  │   Created: ${labelResult.created.join(', ')}`)
  if (labelResult.updated.length > 0) log(`  │   Updated: ${labelResult.updated.join(', ')}`)
  for (const e of labelResult.classifiedErrors) {
    log(`  │   Error: ${e.message}`)
    throwOnFatalOrConfig(e.kind, e.message, warnings)
    warnings.push(e.message)
  }
}

function setupBranchProtection(
  owner: string,
  repo: string,
  collaborationMode: CollaborationMode,
  warnings: string[],
  log: (msg: string) => void,
): void {
  const bp = applyBranchProtection(owner, repo, collaborationMode)
  if (bp.applied) {
    log('  │   Branch protection applied.')
  } else if (bp.error) {
    if (bp.errorKind) throwOnFatalOrConfig(bp.errorKind, `branch protection: ${bp.error}`, warnings)
    log(`  │   Skipped (requires admin access): ${bp.error}`)
    warnings.push(`branch protection skipped: ${bp.error}`)
  } else {
    log('  │   Skipped (requires admin access).')
  }
  if (bp.repoSettingsError) {
    log(`  │   Repo merge settings FAILED (INV-101): ${bp.repoSettingsError}`)
    warnings.push(`repo merge settings failed (INV-101): ${bp.repoSettingsError}`)
  }
}

function setupProjectBoard(
  owner: string,
  repo: string,
  projectName: string,
  warnings: string[],
  log: (msg: string) => void,
): void {
  const pb = createProjectBoard(owner, repo, projectName)
  if (pb.created) {
    log(`      Project board created: ${pb.projectUrl}`)
  } else if (pb.error) {
    log(`      Skipped: ${pb.error}`)
  } else {
    log(`      Already exists: ${pb.projectUrl ?? 'unknown'}`)
  }
  for (const e of pb.classifiedErrors) {
    throwOnFatalOrConfig(e.kind, e.message, warnings)
    log(`      Warning: ${e.message}`)
    warnings.push(`project board: ${e.message}`)
  }
}

export function runBackendSetup(config: ProjectConfig, log: (msg: string) => void): BackendResult {
  const backend = config.decompositionBackend ?? (config.useGitHub ? 'github' : 'markdown')
  if (backend === 'github') {
    return runGithubSetup(config, log)
  }
  const workDir = join(config.targetDir, '.arbiter', 'work')
  mkdirSync(workDir, { recursive: true })
  log('\n  Markdown backend: scaffolded .arbiter/work/')
  return { warnings: [] }
}

export function runGithubSetup(
  config: ProjectConfig,
  log: (msg: string) => void = (msg: string): void => {
    process.stdout.write(`${msg}\n`)
  },
): BackendResult {
  if (!config.useGitHub || !config.githubOwner || !config.githubRepo) return { warnings: [] }

  const warnings: string[] = []

  log('\n  GitHub setup...')
  log('  ├── Provisioning labels...')
  setupLabels(config.githubOwner, config.githubRepo, warnings, log)
  log('  ├── Applying branch protection to main...')
  setupBranchProtection(
    config.githubOwner,
    config.githubRepo,
    // ADR-051 (#1119): use canonical resolver — removes third inline derivation copy.
    resolveCollaborationMode(config),
    warnings,
    log,
  )
  log('  └── Creating project board...')
  setupProjectBoard(config.githubOwner, config.githubRepo, config.projectName, warnings, log)

  return { warnings }
}
