// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { sanitizeTaskId } from '../utils/task-id.js'
import { createGhIssue, appendTechDebtIssue } from '../utils/github-issue-helper.js'
import { readTaskId } from './task-state.js'
import { appendFileTranslated, ensureDir } from '../utils/fs.js'

export interface RecordTechDebtOptions {
  description: string
  triggeredBy?: string
  dir?: string
}

export interface RecordTechDebtSuccess {
  ok: true
  issueNumber: number
}

export interface RecordTechDebtFailure {
  ok: false
  reason: string
}

function buildIssueBody(description: string, taskId: string): string {
  return [
    '## Background',
    '',
    `This issue was filed automatically by \`arbiter task record-tech-debt\` (triggered by ${taskId}).`,
    '',
    '## Finding',
    '',
    description,
    '',
    '## Risk',
    '',
    'Unaddressed tech-debt may cause regressions or impede future feature work.',
    '',
    '## Remediation',
    '',
    'Review and address in a follow-up task.',
    '',
    '## Related',
    '',
    `- Triggered by: ${taskId}`,
  ].join('\n')
}

function resolveTaskId(opts: RecordTechDebtOptions, dir: string): string | RecordTechDebtFailure {
  if (opts.triggeredBy) return opts.triggeredBy
  const taskId = readTaskId(dir)
  return (
    taskId ?? { ok: false, reason: 'no task-id: neither --triggered-by nor an active task found' }
  )
}

export function runTaskRecordTechDebt(
  opts: RecordTechDebtOptions,
): RecordTechDebtSuccess | RecordTechDebtFailure {
  const dir = opts.dir ?? process.cwd()

  const taskIdResult = resolveTaskId(opts, dir)
  if (typeof taskIdResult === 'object') return taskIdResult
  const taskId = taskIdResult

  const description = opts.description.trim()
  if (!description) return { ok: false, reason: '--description must not be empty' }

  // Behavior pinned: record-tech-debt always files with exactly these two labels.
  const ghResult = createGhIssue(dir, {
    title: `tech-debt: ${description}`,
    body: buildIssueBody(description, taskId),
    labels: ['tech-debt', 'follow-up'],
  })
  if (!ghResult.ok) return ghResult
  const issueNumber = ghResult.issueNumber

  const evidenceDir = join(dir, '.arbiter', 'evidence', sanitizeTaskId(taskId))
  try {
    ensureDir(evidenceDir)
    appendTechDebtIssue(evidenceDir, issueNumber)
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    appendFileTranslated(
      join(evidenceDir, 'log.md'),
      [
        `## ${timestamp} — tech-debt issue #${issueNumber}`,
        `- ${description}`,
        `- triggered-by: ${taskId}`,
        '',
      ].join('\n'),
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `evidence write failed: ${msg}` }
  }

  return { ok: true, issueNumber }
}
