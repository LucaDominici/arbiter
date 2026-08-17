// SPDX-License-Identifier: Apache-2.0
//
// #1077: `diff` is `update` with the writes elided. It builds the SAME
// ProjectConfig (shared resolveProjectConfig) and runs the SAME generator
// registry with `{ dryRun: true }`, so it can never under- or over-report
// relative to `update` (F1/F7). It additionally enumerates the GitHub remote
// side effects `update --github` would perform — as a STATIC descriptor, never
// by calling `gh` (ADR-001; diff is strictly read-only).
import { resolve, relative, join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig } from '../utils/config.js'
import { slugifyProjectName } from './init.js'
import { buildAdoptPredicate } from './update.js'
import { resolveProjectName } from '../config/resolve-project-name.js'
import { resolveProjectConfig, gitHubPermitted } from '../config/resolve-project-config.js'
import { detectInstalledSkills } from '../integrations/skill-detector.js'
import { buildRegistry, runGeneratorsFromRegistry } from '../generators/registry.js'
import { jsonOutput, statusToExitCode } from '../utils/json-output.js'
import { t } from '../i18n/index.js'
import { beginGenerationSession, endGenerationSession, type WriteResult, readFileTranslated } from '../utils/fs.js'
import { loadGeneratedManifest } from '../state/generated-manifest.js'
import { renderAgentsMd } from '../generators/agents-md.js'
import {
  buildRenderContext as buildClaudeRenderContext,
  parseExistingSettings,
} from '../generators/claude.js'
import { renderTemplate } from '../utils/render.js'
import type { ProjectConfig } from '../wizard/types.js'

export interface DiffOptions {
  dir: string | undefined
  json?: boolean | undefined
  /** #1344: filter the report to only withheld template fixes (focused reconciliation view). */
  withheld?: boolean | undefined
  /**
   * #2040: audit high-authority governance sections (Iron Laws in AGENTS.md, the
   * permission deny list in .claude/settings.json) for staleness against the
   * CURRENT template, section-scoped rather than whole-file. Fail-closed: any
   * stale section exits 1.
   */
  governance?: boolean | undefined
}

export interface GovernanceSectionStatus {
  file: string
  section: string
  stale: boolean
  detail: string
}

/**
 * Extract the `## Iron Laws` block (header through the line before the next
 * `## ` heading) from AGENTS.md content. Returns null if the section is absent.
 */
const IRON_LAWS_HEADING = /^## Iron Laws[ \t]*$/m

function extractIronLawsBlock(content: string): string | null {
  // Anchored to a whole heading LINE (start-of-line, exact text) — an unanchored
  // substring search would also match a `### Iron Laws` h3, or prose that merely
  // quotes the heading name, defeating the section-scoped design entirely.
  const match = IRON_LAWS_HEADING.exec(content)
  if (!match) return null
  const rest = content.slice(match.index)
  const nextHeader = rest.indexOf('\n## ', 1)
  return (nextHeader === -1 ? rest : rest.slice(0, nextHeader)).trim()
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * #2040: section-scoped governance drift check — deliberately NOT a whole-file
 * diff. AGENTS.md is regenerated wholesale on every `arbiter update` (backup:true,
 * no skipIfExists) so a whole-file compare would flag ANY unrelated customization
 * as "stale", not just an out-of-date Iron Laws section. Reused from the same
 * render paths the generators use (renderAgentsMd, buildRenderContext) so this
 * check can never disagree with what `arbiter update` would actually produce.
 */
export function checkGovernanceSections(
  config: ProjectConfig,
  targetDir: string,
): GovernanceSectionStatus[] {
  const results: GovernanceSectionStatus[] = []

  const agentsPath = join(targetDir, 'AGENTS.md')
  const currentIronLaws = extractIronLawsBlock(renderAgentsMd(config))
  if (!existsSync(agentsPath)) {
    results.push({ file: 'AGENTS.md', section: 'Iron Laws', stale: true, detail: 'file missing' })
  } else {
    const materializedIronLaws = extractIronLawsBlock(readFileTranslated(agentsPath, 'utf-8'))
    const stale =
      materializedIronLaws === null ||
      normalizeWhitespace(materializedIronLaws) !== normalizeWhitespace(currentIronLaws ?? '')
    results.push({
      file: 'AGENTS.md',
      section: 'Iron Laws',
      stale,
      detail:
        materializedIronLaws === null ? 'section missing' : 'content differs from current template',
    })
  }

  const settingsPath = join(targetDir, '.claude', 'settings.json')
  const incomingSettings = JSON.parse(
    renderTemplate('claude/settings.json.ejs', buildClaudeRenderContext(config)),
  ) as { permissions: { deny: string[] } }
  const currentDeny = incomingSettings.permissions.deny
  if (!existsSync(settingsPath)) {
    results.push({
      file: '.claude/settings.json',
      section: 'deny list',
      stale: true,
      detail: 'file missing',
    })
  } else {
    // #2040 red-team: reuse the existing safe parser (CANON-22 — avoid re-implementing
    // the same JSON.parse+shape-check claude.ts already has) instead of a raw JSON.parse
    // that would crash on a hand-edited or merge-conflicted file and break the --json
    // contract. Any parse failure or non-array deny shape degrades to "stale", never a throw.
    let materializedDeny: string[] = []
    let malformed = false
    try {
      const materialized = parseExistingSettings(settingsPath)
      const deny = (materialized['permissions'] as { deny?: unknown } | undefined)?.deny
      if (Array.isArray(deny)) {
        materializedDeny = deny as string[]
      } else {
        malformed = true
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[diff] .claude/settings.json: ${msg}\n`)
      malformed = true
    }
    if (malformed) {
      results.push({
        file: '.claude/settings.json',
        section: 'deny list',
        stale: true,
        detail: 'malformed settings.json',
      })
      return results
    }
    const missing = currentDeny.filter((d) => !materializedDeny.includes(d))
    results.push({
      file: '.claude/settings.json',
      section: 'deny list',
      stale: missing.length > 0,
      detail: missing.length > 0 ? `missing entries: ${missing.join(', ')}` : '',
    })
  }

  return results
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
    // #2120: …but a file the adopt policy WOULD take is not withheld, it is
    // changed. `withheld && adopted` means "diverged and re-adopted" (see
    // WriteResult.adopted), and reporting that as a preserved fix told the
    // operator the opposite of what the next `update` does.
    const status: DiffStatus =
      r.withheld === true && r.adopted !== true ? 'withheld' : actionToStatus(r.action)
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

/** #2040: print/exit for the `--governance` short-circuit, extracted to keep runDiff's own complexity under the ceiling. */
function printGovernanceReport(config: ProjectConfig, targetDir: string, json: boolean): void {
  const sections = checkGovernanceSections(config, targetDir)
  const stale = sections.filter((s) => s.stale)
  if (json) {
    jsonOutput('diff', stale.length > 0 ? 'warning' : 'ok', { sections })
    if (stale.length > 0) process.exit(statusToExitCode('warning'))
    return
  }
  for (const s of sections) {
    if (s.stale) {
      process.stdout.write(
        `${t('cli.diff.governance_stale_section', { file: s.file, section: s.section, detail: s.detail })}\n`,
      )
    }
  }
  if (stale.length > 0) {
    process.stdout.write(`${t('cli.diff.governance_stale_footer')}\n`)
    process.exit(1)
  }
  process.stdout.write(`${t('cli.diff.governance_up_to_date')}\n`)
}

export function runDiff(options: DiffOptions): void {
  const targetDir = resolve(options.dir ?? process.cwd())

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
  // #1978: resolve via the durable-source precedence chain — see update.ts's
  // identical comment for the full rationale (worktree dirs must never leak
  // into the resolved project name).
  const projectName = slugifyProjectName(resolveProjectName(targetDir, stored))

  // Build the same config update would, then run the registry dry. `diff` never
  // touches GitHub, so useGitHubBackend is false (read-only): the registry file
  // set is identical regardless, and gh side effects are reported statically.
  const { config } = resolveProjectConfig(targetDir, projectName, stored)

  // #2040: --governance short-circuits before the generic whole-file dry-run —
  // it needs only the resolved config to re-render the current template's
  // governance sections, not the full generator registry.
  if (options.governance) {
    printGovernanceReport(config, targetDir, options.json === true)
    return
  }

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
  // #2120: model the SAME adopt policy a default `arbiter update` applies.
  // Without the predicate, every file `update` force-adopts (safety class,
  // gate spine, governance pair) resolved here as a preserved "withheld
  // template fix" with a reconcile hint — the exact opposite of what the next
  // update does to it. No `onAdopt`: diff stays read-only, it only needs the
  // classification.
  beginGenerationSession({
    targetDir,
    prevHashes: prevManifest,
    onWithheld: () => {},
    adoptPredicate: buildAdoptPredicate({}),
  })
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
