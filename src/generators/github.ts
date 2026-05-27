// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'
import {
  resolvePipelineStyle,
  collaborationModeFromAnswers,
  resolveDefaultBranchingStrategy,
} from '../config/collaboration-mode-defaults.js'
import type { BranchingStrategy } from '../wizard/types.js'

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
function resolveStyle(config: ProjectConfig): 'starter' | 'standard' | 'industrial' {
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

function generateIndustrialWorkflows(
  workflowsDir: string,
  data: ProjectConfig,
  dryRun: boolean,
): WriteResult[] {
  return [
    writeFile(
      join(workflowsDir, '12-mutation-scheduled.yml'),
      renderTemplate('github/workflows/12-mutation-scheduled.yml.ejs', data),
      { dryRun },
    ),
    writeFile(
      join(workflowsDir, '13-archunit-extended.yml'),
      renderTemplate('github/workflows/13-archunit-extended.yml.ejs', data),
      { dryRun },
    ),
    writeFile(
      join(workflowsDir, '14-license-scan.yml'),
      renderTemplate('github/workflows/14-license-scan.yml.ejs', data),
      { dryRun },
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

  const files: WriteResult[] = [
    writeFile(
      join(workflowsDir, '01-pr-fast.yml'),
      renderTemplate('github/workflows/01-pr-fast.yml.ejs', data),
      { dryRun },
    ),
    writeFile(
      join(workflowsDir, '02-pr-extended.yml'),
      renderTemplate('github/workflows/02-pr-extended.yml.ejs', data),
      { dryRun },
    ),
    writeFile(
      join(workflowsDir, '03-human-approval.yml'),
      renderTemplate('github/workflows/03-human-approval.yml.ejs', data),
      { dryRun },
    ),
  ]

  if (style !== 'starter') {
    files.push(
      writeFile(
        join(workflowsDir, '05-release.yml'),
        renderTemplate('github/workflows/05-release.yml.ejs', data),
        { dryRun },
      ),
      writeFile(
        join(workflowsDir, '_sigstore-retry-sign.yml'),
        renderTemplate('github/workflows/_sigstore-retry-sign.yml.ejs', data),
        { dryRun },
      ),
    )
  }

  // ADR-050 §54-58: nightly/weekly/monthly/heartbeat are L3+ only
  const isL3Plus = config.governanceLevel === 'L3' || config.governanceLevel === 'L4'

  if (style !== 'starter' && isL3Plus) {
    files.push(
      writeFile(
        join(workflowsDir, '06-nightly.yml'),
        renderTemplate('github/workflows/06-nightly.yml.ejs', data),
        { dryRun },
      ),
      writeFile(
        join(workflowsDir, '07-weekly.yml'),
        renderTemplate('github/workflows/07-weekly.yml.ejs', data),
        { dryRun },
      ),
      writeFile(
        join(workflowsDir, '08-monthly.yml'),
        renderTemplate('github/workflows/08-monthly.yml.ejs', data),
        { dryRun },
      ),
    )
  }

  if (isL3Plus) {
    files.push(
      writeFile(
        join(workflowsDir, '09-heartbeat.yml'),
        renderTemplate('github/workflows/09-heartbeat.yml.ejs', data),
        { dryRun },
      ),
    )
  }

  if (style === 'industrial') files.push(...generateIndustrialWorkflows(workflowsDir, data, dryRun))

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if (config.enableSoloDevMode)
    files.push(
      writeFile(
        join(workflowsDir, 'drift-shadow.yml'),
        renderTemplate('github/workflows/drift-shadow.yml.ejs', data),
        { dryRun },
      ),
    )

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  if ((config.deployTarget ?? 'none') !== 'none' || config.enableDeployWorkflows) {
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
      { dryRun: opts.dryRun },
    ),
  ]

  return { files }
}
