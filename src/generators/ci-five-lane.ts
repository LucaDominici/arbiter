// SPDX-License-Identifier: Apache-2.0
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CiFiveLaneGeneratorResult {
  files: WriteResult[]
}

const SCRIPT_MODE = 0o755

/**
 * A1+A6 (#1817): the tier-assignment rule, generator form.
 *
 * Rule (AGENTS.md INV-136): a check lives at the fastest tier where its red
 * would change the developer's immediate next action; a red tolerated more
 * than 48h must be fixed, demoted, or deleted. This generator emits the
 * collapsed 5-lane shape validated on a 100k-LOC project (10 workflows → 5,
 * see HANDOFF-VIAFERA-PATTERNS-2026-07.md §A1): pre-commit (local, via
 * `generateGithooks` — no workflow file needed) + 4 GitHub Actions workflows
 * covering the remaining 4 lanes (PR-blocking / nightly / weekly /
 * release-seal), each carrying its tier + time-budget in a header comment.
 *
 * Opt-in via `config.enableFiveLaneCi` (mutually exclusive with the
 * standard `github` + `ci-tier` generators — see registry.ts — so a fresh
 * repo choosing this mode gets exactly 4 workflow files, never a union of
 * both shapes). Scope boundary (deliberate, see handoff §C non-goals): this
 * mode does not emit issue templates / PR template / dependabot.yml — those
 * remain the standard `github` generator's concern for repos that don't opt
 * into the lean 5-lane shape.
 *
 * A6 sticky-failure-issue: `nightly.yml` and `weekly.yml` both source the
 * single shared script this generator emits at `.github/scripts/
 * sticky-failure-issue.sh` (parameterized by lane name) instead of each
 * hand-rolling its own issue-spam logic — the anti-pattern measured on
 * viafera (20 duplicate auto-filed issues, zero action taken).
 */
export function generateCiFiveLane(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CiFiveLaneGeneratorResult {
  if (!config.enableFiveLaneCi || !(config.permitGitHub ?? config.useGitHub)) {
    return { files: [] }
  }

  const data = config
  const githubDir = resolvedPath(config.targetDir, '.github')
  const workflowsDir = join(githubDir, 'workflows')
  const scriptsDir = join(githubDir, 'scripts')
  const scriptPath = join(scriptsDir, 'sticky-failure-issue.sh')

  const ciResult = writeFile(
    join(workflowsDir, 'ci.yml'),
    renderTemplate('github/workflows/five-lane/ci.yml.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )
  const nightlyResult = writeFile(
    join(workflowsDir, 'nightly.yml'),
    renderTemplate('github/workflows/five-lane/nightly.yml.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )
  const weeklyResult = writeFile(
    join(workflowsDir, 'weekly.yml'),
    renderTemplate('github/workflows/five-lane/weekly.yml.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )
  const releaseResult = writeFile(
    join(workflowsDir, 'release.yml'),
    renderTemplate('github/workflows/five-lane/release.yml.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )
  const scriptResult = writeFile(
    scriptPath,
    renderTemplate('github/scripts/sticky-failure-issue.sh.ejs', data),
    { skipIfExists: true, dryRun: opts.dryRun },
  )

  if (!opts.dryRun && scriptResult.action !== 'skipped') {
    chmodSync(scriptPath, SCRIPT_MODE)
  }

  const files: WriteResult[] = [ciResult, nightlyResult, weeklyResult, releaseResult, scriptResult]

  return { files }
}
