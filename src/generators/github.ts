// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { levelAtLeast } from '../config/levels.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import {
  resolvePipelineStyle,
  collaborationModeFromAnswers,
  resolveCollaborationMode,
  resolveDefaultBranchingStrategy,
} from '../config/collaboration-mode-defaults.js'
import type { BranchingStrategy } from '../wizard/types.js'
import { isSubtreeFrontendLane } from '../detectors/lanes.js'

export interface GithubGeneratorResult {
  files: WriteResult[]
}

/**
 * Resolver precedence (ADR-051):
 * 1. explicit pipelineStyle → wins (escape hatch for advanced users)
 * 2. collaborationMode set → table lookup (mode × governanceLevel)
 * 3. enableSoloDevMode: true → alias to trunk-solo → table lookup
 * 4. ciTierMode: 'baseline' → 'starter' (deprecated backward-compat)
 * 5. default → 'standard'
 */
export function resolveStyle(config: ProjectConfig): 'starter' | 'standard' | 'industrial' {
  if (config.pipelineStyle) return config.pipelineStyle
  if (config.collaborationMode) {
    return resolvePipelineStyle(config.collaborationMode, config.governanceLevel)
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (config.enableSoloDevMode) {
    const mode = collaborationModeFromAnswers({ soloDevMode: true })
    return resolvePipelineStyle(mode, config.governanceLevel)
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (config.ciTierMode === 'baseline') return 'starter'
  return 'standard'
}

/**
 * #1543 — the release workflow (05-release.yml) is emitted, and its mutation-blocking
 * job enforces mutation as BLOCKING (#1505), exactly when the resolved pipeline style is
 * non-starter. Mutation tool configs must therefore be generated wherever this returns
 * true, so the fail-on-empty fallback run has a real config instead of yielding zero
 * mutants and failing the release. This is the SINGLE predicate both the release emission
 * (here) and the mutation-config generator (`generateMutation`) consume — they cannot drift.
 */
export function releaseEnforcesMutation(config: ProjectConfig): boolean {
  return resolveStyle(config) !== 'starter'
}

function generateIndustrialWorkflows(
  workflowsDir: string,
  data: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  return [
    writeFile(
      join(workflowsDir, '12-mutation-scheduled.yml'),
      renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '13-archunit-extended.yml'),
      renderTemplate('github/workflows/13-archunit-extended.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '14-license-scan.yml'),
      renderTemplate('github/workflows/14-license-scan.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

import type { Archetype } from '../wizard/types.js'

const WEB_ARCHETYPES = new Set<Archetype>(['frontend-spa'])

// #1330 — collaboration-mode literals, hoisted to constants to keep the gating
// predicates duplication-free (sonarjs no-duplicate-string).
const PEER_REVIEW = 'peer-review'
const GATED_REVIEW = 'gated-review'

// CodeQL: peer-review L2+ or gated-review (any level); Rust excluded (no native CodeQL support)
function needsCodeql(
  cm: string | undefined,
  isL2Plus: boolean,
  language: string | undefined,
): boolean {
  return ((cm === PEER_REVIEW && isL2Plus) || cm === GATED_REVIEW) && language !== 'rust'
}

// #1330 — review-based collaboration modes that receive path-scoped FE CI workflows
// (peer-review / gated-review; trunk-solo gates the FE lane via check-all instead).
// Extracted as a single predicate so the FE-quality and FE-lane gating share one
// source for the review-mode condition (CANON-22, sonarjs no-duplicate-string).
function isReviewMode(cm: string | undefined): boolean {
  return cm === PEER_REVIEW || cm === GATED_REVIEW
}

// Frontend quality: review modes (peer/gated), web archetype, L2+
function needsFrontendQuality(
  cm: string | undefined,
  isL2Plus: boolean,
  archetype: Archetype | undefined,
): boolean {
  return isReviewMode(cm) && isL2Plus && archetype !== undefined && WEB_ARCHETYPES.has(archetype)
}

// #1330 — per-lane frontend gate workflow: review modes (peer/gated), L2+, and a
// SUBTREE frontend lane (a `frontend` lane on a non-frontend-spa archetype — the FE
// app lives in `frontend/` beside the primary language). Distinct from
// needsFrontendQuality, which targets the root-level frontend-spa app. Trunk-solo
// repos still gate the FE lane via check-all.mjs (gate-full CI job) — this dedicated
// path-scoped workflow is the peer/gated-review complement.
function needsFrontendLane(
  config: ProjectConfig,
  cm: string | undefined,
  isL2Plus: boolean,
): boolean {
  return isReviewMode(cm) && isL2Plus && isSubtreeFrontendLane(config)
}

function generateCiGapWorkflows(
  workflowsDir: string,
  config: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  const files: WriteResult[] = []
  // ADR-051: resolve via the single derivation site — raw config.collaborationMode
  // is undefined for the enableSoloDevMode alias, which would skip the lite nightly.
  const cm = resolveCollaborationMode(config)
  const gl = config.governanceLevel
  const isL2Plus = new Set(['L2', 'L3', 'L4']).has(gl)
  const isL3Plus = new Set(['L3', 'L4']).has(gl)

  // trunk-solo L2+: lightweight nightly (integration only, no mutation/SLSA)
  if (cm === 'trunk-solo' && isL2Plus)
    files.push(
      writeFile(
        join(workflowsDir, '06-nightly-lite.yml'),
        renderTemplate('github/workflows/06-nightly-lite.yml.ejs', config),
        { skipIfExists: true, dryRun },
      ),
    )

  // PORT A2 (#1502): trunk-solo L3+ gets a lite weekly sweep. A solo prod service
  // runs 06-nightly-lite + 09-heartbeat but is excluded from the full 07-weekly /
  // 08-monthly suite, so it would otherwise get no deep weekly security pass. The
  // lite weekly adds dependency freshness, a stale action-pin audit, and a
  // deep-security subset (Semgrep SAST + secret history). Mirrors the nightly-lite shape.
  if (cm === 'trunk-solo' && isL3Plus)
    files.push(
      writeFile(
        join(workflowsDir, '07-weekly-lite.yml'),
        renderTemplate('github/workflows/07-weekly-lite.yml.ejs', config),
        { skipIfExists: true, dryRun },
      ),
    )

  if (needsCodeql(cm, isL2Plus, config.language))
    files.push(
      writeFile(
        join(workflowsDir, '15-codeql.yml'),
        renderTemplate('github/workflows/15-codeql.yml.ejs', config),
        { skipIfExists: true, dryRun },
      ),
    )

  if (needsFrontendQuality(cm, isL2Plus, config.archetype))
    files.push(
      writeFile(
        join(workflowsDir, '16-frontend-quality.yml'),
        renderTemplate('github/workflows/16-frontend-quality.yml.ejs', config),
        { skipIfExists: true, dryRun },
      ),
    )

  // #1330 — per-lane frontend gate for a `frontend/` subtree lane (non-frontend-spa).
  if (needsFrontendLane(config, cm, isL2Plus))
    files.push(
      writeFile(
        join(workflowsDir, '18-frontend-lane.yml'),
        renderTemplate('github/workflows/18-frontend-lane.yml.ejs', config),
        { skipIfExists: true, dryRun },
      ),
    )

  // OSSF Scorecard: gated-review L3+
  if (cm === GATED_REVIEW && isL3Plus)
    files.push(
      writeFile(
        join(workflowsDir, '17-ossf-scorecard.yml'),
        renderTemplate('github/workflows/17-ossf-scorecard.yml.ejs', config),
        { skipIfExists: true, dryRun },
      ),
    )

  return files
}

/**
 * #1691: Emit the reusable partials (_nightly/_weekly/_monthly) + their thin-dispatcher callers.
 * Extracted from generateCiWorkflows to keep that function under the 100-line lint ceiling.
 */
function generateScheduledWorkflows(
  workflowsDir: string,
  data: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  return [
    writeFile(
      join(workflowsDir, '_nightly.yml'),
      renderTemplate('github/workflows/_nightly.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '_shared-security.yml'),
      renderTemplate('github/workflows/_shared-security.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '_weekly.yml'),
      renderTemplate('github/workflows/_weekly.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '_monthly.yml'),
      renderTemplate('github/workflows/_monthly.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '06-nightly.yml'),
      renderTemplate('github/workflows/06-nightly.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '07-weekly.yml'),
      renderTemplate('github/workflows/07-weekly.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '08-monthly.yml'),
      renderTemplate('github/workflows/08-monthly.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function generateCiWorkflows(
  workflowsDir: string,
  config: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  const data = config
  const style = resolveStyle(config)
  const cm = resolveCollaborationMode(config)

  const files: WriteResult[] = [
    writeFile(
      join(workflowsDir, '01-pr-fast.yml'),
      renderTemplate('github/workflows/01-pr-fast.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '02-pr-extended.yml'),
      renderTemplate('github/workflows/02-pr-extended.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '03-human-approval.yml'),
      renderTemplate('github/workflows/03-human-approval.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]

  if (style !== 'starter') {
    files.push(
      writeFile(
        join(workflowsDir, '05-release.yml'),
        renderTemplate('github/workflows/05-release.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
      writeFile(
        join(workflowsDir, '_sigstore-retry-sign.yml'),
        renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  // ADR-050 §54-58: nightly/weekly/monthly/heartbeat are L3+ only
  const isL3Plus = levelAtLeast(config.governanceLevel, 'L3')

  // #1131: trunk-solo gets the lightweight 06-nightly-lite (emitted in
  // generateCiGapWorkflows) INSTEAD of the full nightly/weekly/monthly suite.
  // #1691: reusable partials (_nightly/_weekly/_monthly) are emitted alongside callers.
  if (style !== 'starter' && isL3Plus && cm !== 'trunk-solo')
    files.push(...generateScheduledWorkflows(workflowsDir, data, dryRun))

  if (isL3Plus) {
    files.push(
      writeFile(
        join(workflowsDir, '09-heartbeat.yml'),
        renderTemplate('github/workflows/09-heartbeat.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  if (style === 'industrial') files.push(...generateIndustrialWorkflows(workflowsDir, data, dryRun))

  files.push(...generateCiGapWorkflows(workflowsDir, config, dryRun))

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (config.enableSoloDevMode)
    files.push(
      writeFile(
        join(workflowsDir, 'drift-shadow.yml'),
        renderTemplate('github/workflows/drift-shadow.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )

  if ((config.deployTarget ?? 'none') !== 'none') {
    files.push(
      writeFile(
        join(workflowsDir, '04-deploy-test.yml'),
        renderTemplate('github/workflows/04-deploy-test.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
      writeFile(
        join(workflowsDir, '10-deploy-prod.yml'),
        renderTemplate('github/workflows/10-deploy-prod.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  return files
}

function generateAgentGovernanceWorkflows(
  workflowsDir: string,
  config: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  const data = config
  return [
    writeFile(
      join(workflowsDir, '_label-on-approve.yml'),
      renderTemplate('github/workflows/_label-on-approve.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '_ai-draft-check.yml'),
      renderTemplate('github/workflows/_ai-draft-check.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
    writeFile(
      join(workflowsDir, '_pr-staleness.yml'),
      renderTemplate('github/workflows/_pr-staleness.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
}

function generateIssueTemplates(
  issueTemplatesDir: string,
  config: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  const data = config
  const files: WriteResult[] = [
    writeFile(
      join(issueTemplatesDir, 'task-brief.yml'),
      renderTemplate('github/issue-templates/task-brief.yml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]
  for (const tpl of ['bug-report.yml', 'feature-request.yml', 'epic.yml', 'config.yml']) {
    files.push(
      writeFile(
        join(issueTemplatesDir, tpl),
        renderTemplate(`github/issue-templates/${tpl}`, data),
        { skipIfExists: true, dryRun },
      ),
    )
  }
  if (config.governanceLevel !== 'L1') {
    files.push(
      writeFile(
        join(issueTemplatesDir, 'compliance-item.yml'),
        renderTemplate('github/issue-templates/compliance-item.yml.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }
  return files
}

/**
 * Resolves the effective branchingStrategy for template rendering.
 * EJS throws ReferenceError for keys absent from data; always provide a defined value.
 * Precedence: explicit branchingStrategy → derived from collaborationMode → 'github-flow'.
 */
function resolveBranchingStrategy(config: ProjectConfig): BranchingStrategy {
  if (config.branchingStrategy) return config.branchingStrategy
  if (config.collaborationMode) return resolveDefaultBranchingStrategy(config.collaborationMode)
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (config.enableSoloDevMode) return 'trunk-direct'
  return 'github-flow'
}

export function generateGithub(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): GithubGeneratorResult {
  const data = { ...config, branchingStrategy: resolveBranchingStrategy(config) }
  const githubDir = resolvedPath(config.targetDir, '.github')
  const workflowsDir = join(githubDir, 'workflows')
  const issueTemplatesDir = join(githubDir, 'ISSUE_TEMPLATE')
  const actionsDir = join(githubDir, 'actions')

  const files: WriteResult[] = [
    ...generateCiWorkflows(workflowsDir, data, opts.dryRun),
    ...generateAgentGovernanceWorkflows(workflowsDir, data, opts.dryRun),
    writeFile(
      join(githubDir, 'PULL_REQUEST_TEMPLATE.md'),
      renderTemplate('github/PULL_REQUEST_TEMPLATE.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    // C2: version-controlled sensitive-path SSOT consumed by the 02-pr-extended
    // check-trigger gate (grep -E -f). skipIfExists so re-init preserves edits.
    writeFile(
      join(githubDir, 'extended-ci-paths.txt'),
      renderTemplate('github/extended-ci-paths.txt.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    ...generateIssueTemplates(issueTemplatesDir, data, opts.dryRun),
    writeFile(
      join(workflowsDir, 'issue-state.yml'),
      renderTemplate('github/workflows/issue-state.yml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      join(githubDir, 'dependabot.yml'),
      renderTemplate('github/dependabot.yml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      join(actionsDir, 'sign-and-attest', 'action.yml'),
      renderTemplate('github/actions/sign-and-attest/action.yml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  return { files }
}
