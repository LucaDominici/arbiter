// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GithubGeneratorResult {
  files: WriteResult[]
}

export function generateGithub(config: ProjectConfig): GithubGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir
  const data = config
  const githubDir = resolvedPath(base, '.github')

  // CI workflow — always regenerate so soloDevMode toggles apply immediately
  const workflowsDir = join(githubDir, 'workflows')
  results.push(
    writeFile(
      join(workflowsDir, '01-pr-fast.yml'),
      renderTemplate('github/workflows/01-pr-fast.yml.ejs', data),
    ),
  )

  // T2 PR-extended workflow — always regenerate
  results.push(
    writeFile(
      join(workflowsDir, '02-pr-extended.yml'),
      renderTemplate('github/workflows/02-pr-extended.yml.ejs', data),
    ),
  )

  // Drift shadow — only when solo-dev mode is active (#470)
  if (config.enableSoloDevMode) {
    results.push(
      writeFile(
        join(workflowsDir, 'drift-shadow.yml'),
        renderTemplate('github/workflows/drift-shadow.yml.ejs', data),
      ),
    )
  }

  // PR template — skip if exists
  results.push(
    writeFile(
      join(githubDir, 'PULL_REQUEST_TEMPLATE.md'),
      renderTemplate('github/PULL_REQUEST_TEMPLATE.md', data),
      { skipIfExists: true },
    ),
  )

  // Issue templates — skip if exists
  const issueTemplatesDir = join(githubDir, 'ISSUE_TEMPLATE')

  // task-brief is EJS (governance-gated sections) — rendered separately
  results.push(
    writeFile(
      join(issueTemplatesDir, 'task-brief.yml'),
      renderTemplate('github/issue-templates/task-brief.yml.ejs', data),
      { skipIfExists: true },
    ),
  )

  const issueTemplates = ['bug-report.yml', 'feature-request.yml', 'epic.yml', 'config.yml']
  for (const tpl of issueTemplates) {
    results.push(
      writeFile(
        join(issueTemplatesDir, tpl),
        renderTemplate(`github/issue-templates/${tpl}`, data),
        { skipIfExists: true },
      ),
    )
  }

  if (config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        join(issueTemplatesDir, 'compliance-item.yml'),
        renderTemplate('github/issue-templates/compliance-item.yml.ejs', data),
        { skipIfExists: true },
      ),
    )
  }

  // Issue state automation — skip if exists
  results.push(
    writeFile(
      join(workflowsDir, 'issue-state.yml'),
      renderTemplate('github/workflows/issue-state.yml.ejs', data),
      { skipIfExists: true },
    ),
  )

  // Dependabot — skip if exists
  results.push(
    writeFile(
      join(githubDir, 'dependabot.yml'),
      renderTemplate('github/dependabot.yml.ejs', data),
      { skipIfExists: true },
    ),
  )

  return { files: results }
}
