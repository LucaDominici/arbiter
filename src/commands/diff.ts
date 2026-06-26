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
import { slugifyProjectName } from './init.js'
import { resolveProjectConfig, gitHubPermitted } from '../config/resolve-project-config.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { buildRegistry, runGeneratorsFromRegistry } from '../generators/registry.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { t } from '../i18n/index.js'
import { beginGenerationSession, endGenerationSession, type WriteResult } from '../utils/fs.js'
import { loadGeneratedManifest } from '../state/generated-manifest.js'

export interface DiffOptions {
  dir: string | undefined
  json?: boolean | undefined
  /** #1344: filter the report to only withheld template fixes (focused reconciliation view). */
  withheld?: boolean | undefined
}

type DiffStatus = 'new' | 'changed' | 'unchanged' | 'withheld'

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
    // #1344: a withheld fix is a `skipped` action that would otherwise read as
    // `unchanged` — surface it as its own status so the drift is visible.
    const status: DiffStatus = r.withheld ? 'withheld' : actionToStatus(r.action)
    return {
      key: rel,
      status,
      action: r.action,
      path: rel,
    }
  })
}

function printFileLine(f: DiffFile): void {
  if (f.status === 'new') {
    process.stdout.write(`${t('cli.diff.new_file', { key: f.key })}\n`)
  } else if (f.status === 'changed') {
    process.stdout.write(`${t('cli.diff.changed_file', { key: f.key })}\n`)
  } else if (f.status === 'withheld') {
    process.stdout.write(`${t('cli.diff.withheld_file', { key: f.key })}\n`)
  } else {
    process.stdout.write(`${t('cli.diff.unchanged_file', { key: f.key })}\n`)
  }
}

/**
 * #1344: a dedicated trailing section for withheld template fixes so a
 * gate/security fix preserved on a user-modified file is reviewable, not buried
 * among "unchanged" lines.
 */
function printWithheldSection(withheld: DiffFile[]): void {
  if (withheld.length === 0) return
  process.stdout.write(`${t('cli.diff.withheld_header', { count: withheld.length })}\n`)
  for (const f of withheld) {
    process.stdout.write(`${t('cli.diff.withheld_file', { key: f.key })}\n`)
  }
  process.stdout.write(`${t('cli.diff.withheld_hint')}\n`)
}

function printHuman(
  files: DiffFile[],
  remote: RemoteSideEffect[],
  hasChanges: boolean,
  withheldOnly: boolean,
): void {
  const withheld = files.filter((f) => f.status === 'withheld')
  // --withheld: focused view — only the withheld section, nothing else.
  if (withheldOnly) {
    printWithheldSection(withheld)
    return
  }
  for (const f of files) printFileLine(f)
  if (remote.length > 0) {
    process.stdout.write(`${t('cli.diff.remote_header')}\n`)
    for (const r of remote) {
      process.stdout.write(`${t('cli.diff.remote_effect', { op: r.op, target: r.target })}\n`)
    }
  }
  printWithheldSection(withheld)
  // Footer: only claim "all up to date" when there is genuinely nothing to act on
  // — neither pending writes nor withheld fixes (the latter print their own hint).
  if (hasChanges) {
    process.stdout.write(`${t('cli.diff.run_update')}\n`)
  } else if (withheld.length === 0) {
    process.stdout.write(`${t('cli.diff.up_to_date')}\n`)
  }
}

export function runDiff(options: DiffOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd())
  const projectName = slugifyProjectName(basename(targetDir))

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
  // #1328: load the same manifest `update` consults so the dryRun resolves the
  // SAME action `update` would (a pristine-stale skipIfExists file → 'changed',
  // no longer reported as a lying '(unchanged)'). diff is read-only: it never
  // persists the session.
  const prevManifest = loadGeneratedManifest(targetDir)
  // #1344: pass a no-op onWithheld — diff lists withheld files explicitly via the
  // returned `withheld` flag + dedicated section, so the default per-file
  // logger.warn would only double-emit noise here.
  beginGenerationSession({ targetDir, prevHashes: prevManifest, onWithheld: () => {} })
  let results: WriteResult[]
  try {
    results = runGeneratorsFromRegistry(specs, [], { dryRun: true })
  } finally {
    endGenerationSession()
  }

  const allFiles = buildDiffFiles(results, targetDir)
  const withheldCount = allFiles.filter((f) => f.status === 'withheld').length
  // --withheld: focused reconciliation view — report only withheld entries.
  const files = options.withheld ? allFiles.filter((f) => f.status === 'withheld') : allFiles
  const remoteSideEffect = buildRemoteSideEffects(
    gitHubPermitted(stored),
    config.githubOwner,
    config.githubRepo,
  )
  // `hasChanges` means "`arbiter update` would WRITE something" (drives the
  // run-update hint + exit code). A withheld fix is explicitly NOT written — it is
  // preserved — so it does not count here (and update→diff stays idempotent: F7).
  // Withheld drift is surfaced separately via the dedicated section + withheldCount.
  const hasChanges = allFiles.some((f) => f.status !== 'unchanged' && f.status !== 'withheld')

  if (options.json) {
    // Pending writes OR withheld drift → `warning` (exit 1) so CI can flag both;
    // `hasChanges` stays write-only (idempotence contract) — withheld is reported
    // via `withheldCount`, not by claiming update would write the file.
    const status = hasChanges || withheldCount > 0 ? 'warning' : 'ok'
    jsonOutput('diff', status, { hasChanges, files, remoteSideEffect, withheldCount })
    const code = statusToExitCode(status)
    if (code !== 0) process.exit(code)
    return
  }

  printHuman(files, remoteSideEffect, hasChanges, options.withheld === true)
}
