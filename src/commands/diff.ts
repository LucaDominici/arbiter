// SPDX-License-Identifier: Apache-2.0
//
// #1077: `diff` is `update` with the writes elided. It builds the SAME
// ProjectConfig (shared resolveProjectConfig) and runs the SAME generator
// registry with `{ dryRun: true }`, so it can never under- or over-report
// relative to `update` (F1/F7). It additionally enumerates the GitHub remote
// side effects `update --github` would perform — as a STATIC descriptor, never
// by calling `gh` (ADR-001; diff is strictly read-only).
import { resolve, basename, relative } from 'node:path'
import { loadConfig } from '../utils/config.js'
import { resolveProjectConfig, gitHubPermitted } from '../config/resolve-project-config.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { buildRegistry, runGeneratorsFromRegistry } from '../generators/registry.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { t } from '../i18n/index.js'
import type { WriteResult } from '../utils/fs.js'

export interface DiffOptions {
  dir: string | undefined
  json?: boolean | undefined
}

type DiffStatus = 'new' | 'changed' | 'unchanged'

interface DiffFile {
  key: string
  status: DiffStatus
  action: WriteResult['action']
  path: string
}

interface RemoteSideEffect {
  op: string
  target: string
}

/** Map a registry WriteResult action onto the diff's user-facing status. */
function actionToStatus(action: WriteResult['action']): DiffStatus {
  if (action === 'created') return 'new'
  if (action === 'skipped') return 'unchanged'
  // replaced | backed-up-and-replaced | dry-run → changed
  return 'changed'
}

/**
 * Static descriptor of the GitHub remote side effects `update --github` /
 * `init` would perform via runGithubSetup. Enumerated WITHOUT calling gh so
 * diff stays read-only (ADR-001). Empty unless GitHub is permitted AND the repo
 * has a resolvable owner/repo (the same gate runGithubSetup applies).
 */
function buildRemoteSideEffects(
  permitGitHub: boolean,
  githubOwner: string | null,
  githubRepo: string | null,
): RemoteSideEffect[] {
  if (!permitGitHub || !githubOwner || !githubRepo) return []
  const target = `${githubOwner}/${githubRepo}`
  return [
    { op: 'provision-labels', target },
    { op: 'apply-branch-protection', target },
    { op: 'create-project-board', target },
  ]
}

function buildDiffFiles(results: WriteResult[], targetDir: string): DiffFile[] {
  return results.map((r) => {
    const rel = relative(targetDir, r.path)
    return {
      key: rel,
      status: actionToStatus(r.action),
      action: r.action,
      path: rel,
    }
  })
}

function printHuman(files: DiffFile[], remote: RemoteSideEffect[], hasChanges: boolean): void {
  for (const f of files) {
    if (f.status === 'new') {
      process.stdout.write(`${t('cli.diff.new_file', { key: f.key })}\n`)
    } else if (f.status === 'changed') {
      process.stdout.write(`${t('cli.diff.changed_file', { key: f.key })}\n`)
    } else {
      process.stdout.write(`${t('cli.diff.unchanged_file', { key: f.key })}\n`)
    }
  }
  if (remote.length > 0) {
    process.stdout.write(`${t('cli.diff.remote_header')}\n`)
    for (const r of remote) {
      process.stdout.write(`${t('cli.diff.remote_effect', { op: r.op, target: r.target })}\n`)
    }
  }
  process.stdout.write(
    hasChanges ? `${t('cli.diff.run_update')}\n` : `${t('cli.diff.up_to_date')}\n`,
  )
}

export function runDiff(options: DiffOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd())
  const projectName = basename(targetDir)

  if (!options.json) {
    process.stdout.write(`${t('cli.diff.banner')}\n`)
  }

  const stored = loadConfig(targetDir)
  if (!stored) {
    if (options.json) {
      jsonOutput('diff', 'error', {}, ['No arbiter.json found. Run `arbiter init` first.'])
    } else {
      process.stdout.write(`${t('cli.diff.no_config')}\n`)
    }
    process.exit(statusToExitCode('error'))
    return
  }

  // Build the same config update would, then run the registry dry. `diff` never
  // touches GitHub, so useGitHubBackend is false (read-only): the registry file
  // set is identical regardless, and gh side effects are reported statically.
  const { config } = resolveProjectConfig(targetDir, projectName, stored)
  const claudeHome = process.env['HOME'] ? `${process.env['HOME']}/.claude` : ''
  const installedSkills = detectInstalledSkills({ targetDir, claudeHome })
  const specs = buildRegistry(config, installedSkills)
  const results = runGeneratorsFromRegistry(specs, [], { dryRun: true })

  const files = buildDiffFiles(results, targetDir)
  const remoteSideEffect = buildRemoteSideEffects(
    gitHubPermitted(stored),
    config.githubOwner,
    config.githubRepo,
  )
  const hasChanges = files.some((f) => f.status !== 'unchanged')

  if (options.json) {
    const status = hasChanges ? 'warning' : 'ok'
    jsonOutput('diff', status, { hasChanges, files, remoteSideEffect })
    const code = statusToExitCode(status)
    if (code !== 0) process.exit(code)
    return
  }

  printHuman(files, remoteSideEffect, hasChanges)
}
