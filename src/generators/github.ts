// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GithubGeneratorResult {
  files: WriteResult[]
}

function generateCiWorkflows(workflowsDir: string, config: ProjectConfig): WriteResult[] {
  const data = config
  const mode = config.ciTierMode ?? 'full'

  const files: WriteResult[] = [
    writeFile(
      join(workflowsDir, '01-pr-fast.yml'),
      renderTemplate('github/workflows/01-pr-fast.yml.ejs', data),
    ),
    writeFile(
      join(workflowsDir, '02-pr-extended.yml'),
      renderTemplate('github/workflows/02-pr-extended.yml.ejs', data),
    ),
    writeFile(
      join(workflowsDir, '03-human-approval.yml'),
      renderTemplate('github/workflows/03-human-approval.yml.ejs', data),
    ),
  ]

  if (mode !== 'baseline') {
    files.push(
      writeFile(
        join(workflowsDir, '05-release.yml'),
        renderTemplate('github/workflows/05-release.yml.ejs', data),
      ),
      writeFile(
        join(workflowsDir, '06-nightly.yml'),
        renderTemplate('github/workflows/06-nightly.yml.ejs', data),
      ),
      writeFile(
        join(workflowsDir, '07-weekly.yml'),
        renderTemplate('github/workflows/07-weekly.yml.ejs', data),
      ),
      writeFile(
        join(workflowsDir, '08-monthly.yml'),
        renderTemplate('github/workflows/08-monthly.yml.ejs', data),
      ),
    )
  }

  files.push(
    writeFile(
      join(workflowsDir, '09-heartbeat.yml'),
      renderTemplate('github/workflows/09-heartbeat.yml.ejs', data),
    ),
  )

  if (config.enableSoloDevMode) {
    files.push(
      writeFile(
        join(workflowsDir, 'drift-shadow.yml'),
        renderTemplate('github/workflows/drift-shadow.yml.ejs', data),
      ),
    )
  }

  return files
}

function generateIssueTemplates(issueTemplatesDir: string, config: ProjectConfig): WriteResult[] {
  const data = config
  const files: WriteResult[] = [
    writeFile(
      join(issueTemplatesDir, 'task-brief.yml'),
      renderTemplate('github/issue-templates/task-brief.yml.ejs', data),
      { skipIfExists: true },
    ),
  ]
  for (const tpl of ['bug-report.yml', 'feature-request.yml', 'epic.yml', 'config.yml']) {
    files.push(
      writeFile(
        join(issueTemplatesDir, tpl),
        renderTemplate(`github/issue-templates/${tpl}`, data),
        { skipIfExists: true },
      ),
    )
  }
  if (config.governanceLevel !== 'L1') {
    files.push(
      writeFile(
        join(issueTemplatesDir, 'compliance-item.yml'),
        renderTemplate('github/issue-templates/compliance-item.yml.ejs', data),
        { skipIfExists: true },
      ),
    )
  }
  return files
}

export function generateGithub(config: ProjectConfig): GithubGeneratorResult {
  const data = config
  const githubDir = resolvedPath(config.targetDir, '.github')
  const workflowsDir = join(githubDir, 'workflows')
  const issueTemplatesDir = join(githubDir, 'ISSUE_TEMPLATE')
  const actionsDir = join(githubDir, 'actions')

  const files: WriteResult[] = [
    ...generateCiWorkflows(workflowsDir, config),
    writeFile(
      join(githubDir, 'PULL_REQUEST_TEMPLATE.md'),
      renderTemplate('github/PULL_REQUEST_TEMPLATE.md', data),
      { skipIfExists: true },
    ),
    ...generateIssueTemplates(issueTemplatesDir, config),
    writeFile(
      join(workflowsDir, 'issue-state.yml'),
      renderTemplate('github/workflows/issue-state.yml.ejs', data),
      { skipIfExists: true },
    ),
    writeFile(
      join(githubDir, 'dependabot.yml'),
      renderTemplate('github/dependabot.yml.ejs', data),
      { skipIfExists: true },
    ),
    writeFile(
      join(actionsDir, 'sign-and-attest', 'action.yml'),
      renderTemplate('github/actions/sign-and-attest/action.yml.ejs', data),
    ),
  ]

  return { files }
}
