// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from '../utils/fs.js'
import { sanitizeTaskId } from '../review/dispatch.js'
import { runCli, CliError } from '../utils/run-cli.js'

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

/**
 * Append a new issue number to tech-debt.json for a task.
 * Contract: SINGLE-WRITER. Concurrent invocation may lose entries — callers must serialize.
 */
function appendTechDebtIssue(evidenceDir: string, issueNumber: number): void {
  const tdPath = join(evidenceDir, 'tech-debt.json')
  let issues: number[] = []
  if (existsSync(tdPath)) {
    try {
      const parsed = JSON.parse(readFileSync(tdPath, 'utf-8')) as { issues: number[] }
      issues = Array.isArray(parsed.issues) ? parsed.issues : []
    } catch {
      issues = []
    }
  }
  issues.push(issueNumber)
  writeFile(tdPath, JSON.stringify({ issues }, null, 2) + '\n')
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

function invokeGhCreate(
  dir: string,
  title: string,
  body: string,
): RecordTechDebtFailure | { stdout: string } {
  try {
    const result = runCli(
      'gh',
      [
        'issue',
        'create',
        '--title',
        title,
        '--body',
        body,
        '--label',
        'tech-debt',
        '--label',
        'follow-up',
        '--json',
        'number',
        '--jq',
        '.number',
      ],
      { cwd: dir, timeoutMs: 30_000 },
    )
    return { stdout: result.stdout }
  } catch (err: unknown) {
    if (err instanceof CliError) {
      if (err.notFound) return { ok: false, reason: 'gh not installed' }
      if (err.timedOut) return { ok: false, reason: 'gh timed out' }
      return { ok: false, reason: `gh exit ${err.exitCode}: ${err.stderr.slice(-200)}` }
    }
    throw err
  }
}

export function runTaskRecordTechDebt(
  opts: RecordTechDebtOptions,
): RecordTechDebtSuccess | RecordTechDebtFailure {
  const dir = opts.dir ?? process.cwd()
  const claudeDir = join(dir, '.claude')

  let taskId = opts.triggeredBy
  if (!taskId) {
    const taskIdFile = join(claudeDir, '.task-id')
    if (!existsSync(taskIdFile)) {
      return { ok: false, reason: 'no task-id: neither --triggered-by nor .claude/.task-id found' }
    }
    taskId = readFileSync(taskIdFile, 'utf-8').trim()
    if (!taskId) return { ok: false, reason: '.claude/.task-id is empty' }
  }

  const description = opts.description.trim()
  if (!description) return { ok: false, reason: '--description must not be empty' }

  const ghResult = invokeGhCreate(
    dir,
    `tech-debt: ${description}`,
    buildIssueBody(description, taskId),
  )
  if ('ok' in ghResult) return ghResult

  const issueNumber = Number.parseInt(ghResult.stdout.trim(), 10)
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return {
      ok: false,
      reason: `gh returned non-integer issue number: ${JSON.stringify(ghResult.stdout.trim())}`,
    }
  }

  const evidenceDir = join(dir, '.arbiter', 'evidence', sanitizeTaskId(taskId))
  mkdirSync(evidenceDir, { recursive: true })
  appendTechDebtIssue(evidenceDir, issueNumber)

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  appendFileSync(
    join(evidenceDir, 'log.md'),
    [
      `## ${timestamp} — tech-debt issue #${issueNumber}`,
      `- ${description}`,
      `- triggered-by: ${taskId}`,
      '',
    ].join('\n'),
    'utf-8',
  )

  return { ok: true, issueNumber }
}
