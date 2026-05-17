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
    const raw = readFileSync(tdPath, 'utf-8')
    try {
      const parsed = JSON.parse(raw) as { issues: unknown[] }
      issues = Array.isArray(parsed.issues)
        ? parsed.issues.filter((v): v is number => typeof v === 'number' && Number.isInteger(v))
        : []
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        issues = []
      } else {
        throw err
      }
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

function resolveTaskId(
  opts: RecordTechDebtOptions,
  claudeDir: string,
): string | RecordTechDebtFailure {
  if (opts.triggeredBy) return opts.triggeredBy
  const taskIdFile = join(claudeDir, '.task-id')
  if (!existsSync(taskIdFile)) {
    return { ok: false, reason: 'no task-id: neither --triggered-by nor .claude/.task-id found' }
  }
  const taskId = readFileSync(taskIdFile, 'utf-8').trim()
  return taskId || { ok: false, reason: '.claude/.task-id is empty' }
}

function parseIssueNumber(stdout: string): number | null {
  const urlLine = stdout.split('\n').find((l) => /\/issues\/\d+$/.test(l.trim()))
  const issueStr = urlLine?.trim().match(/\/issues\/(\d+)$/)?.[1]
  return issueStr !== undefined ? Number.parseInt(issueStr, 10) : null
}

export function runTaskRecordTechDebt(
  opts: RecordTechDebtOptions,
): RecordTechDebtSuccess | RecordTechDebtFailure {
  const dir = opts.dir ?? process.cwd()

  const taskIdResult = resolveTaskId(opts, join(dir, '.claude'))
  if (typeof taskIdResult === 'object') return taskIdResult
  const taskId = taskIdResult

  const description = opts.description.trim()
  if (!description) return { ok: false, reason: '--description must not be empty' }

  const ghResult = invokeGhCreate(
    dir,
    `tech-debt: ${description}`,
    buildIssueBody(description, taskId),
  )
  if ('ok' in ghResult) return ghResult

  // gh issue create outputs a URL like https://github.com/owner/repo/issues/42
  // Some gh versions emit extra lines; search all lines for the URL
  const issueNumber = parseIssueNumber(ghResult.stdout)
  if (issueNumber === null) {
    return {
      ok: false,
      reason: `gh returned non-integer issue number: ${JSON.stringify(ghResult.stdout.trim())}`,
    }
  }

  const evidenceDir = join(dir, '.arbiter', 'evidence', sanitizeTaskId(taskId))
  try {
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `evidence write failed: ${msg}` }
  }

  return { ok: true, issueNumber }
}
