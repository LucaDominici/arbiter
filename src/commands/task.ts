// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export type TaskPhase = 'preflight' | 'plan' | 'implementation' | 'verification' | 'complete'

export interface TaskStatusExtras {
  task?: string
  branch?: string
  [key: string]: unknown
}

export interface TaskStatus {
  phase: TaskPhase
  timestamps: Record<string, string>
  runId: string
  gateDecisions: string[]
  [key: string]: unknown
}

export interface WriteTaskStatusOptions {
  taskDir: string
  phase: TaskPhase
  extras?: TaskStatusExtras
}

/**
 * Atomically write status.json to taskDir via temp-file + rename.
 * Same-dir temp ensures both files are on the same filesystem (no cross-device rename).
 * Merges timestamps from any existing status.json before writing.
 */
export function writeTaskStatus({ taskDir, phase, extras }: WriteTaskStatusOptions): void {
  const target = join(taskDir, 'status.json')
  const tmp = `${target}.tmp.${process.pid}`

  // Merge timestamps from existing status if present
  let existingTimestamps: Record<string, string> = {}
  try {
    const existing = JSON.parse(readFileSync(target, 'utf-8')) as Partial<TaskStatus>
    existingTimestamps = existing.timestamps ?? {}
  } catch {
    // No existing status — start fresh
  }

  const now = new Date().toISOString()
  const status: TaskStatus = {
    phase,
    timestamps: { ...existingTimestamps, [phase]: now },
    runId: `${process.pid}-${Date.now()}`,
    gateDecisions: [],
    ...extras,
  }

  writeFileSync(tmp, JSON.stringify(status, null, 2) + '\n', 'utf-8')
  renameSync(tmp, target)
}

const PHASE_ORDER: TaskPhase[] = ['preflight', 'plan', 'implementation', 'verification', 'complete']

export interface TaskAdvanceOptions {
  to: TaskPhase
  dir?: string
  reverse?: boolean
}

function isValidPhase(s: string): s is TaskPhase {
  return (PHASE_ORDER as readonly string[]).includes(s)
}

function readPhase(claudeDir: string): TaskPhase {
  const p = join(claudeDir, '.task-phase')
  try {
    const raw = readFileSync(p, 'utf-8').trim()
    if (!raw) return 'preflight'
    if (!isValidPhase(raw)) {
      throw new Error(
        `Corrupted phase file at ${p}: unexpected value "${raw}". ` +
          `Valid phases: ${PHASE_ORDER.join(', ')}. ` +
          `Remove the file and re-run with --to preflight to reset.`,
      )
    }
    return raw
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'preflight'
    throw err
  }
}

export interface TaskResumeOptions {
  dir?: string
}

const RECOVERY_TABLE: Record<TaskPhase, string> = {
  preflight:
    'Phase: preflight\nAction: Run /task #NNN to initialize the task branch and plan.\nCommand: node scripts/check-all.mjs L1',
  plan: 'Phase: plan\nAction: Plan is being written. Review .claude/plans/ for existing plan draft.\nNext: Await user GO before editing files.',
  implementation:
    'Phase: implementation\nAction: Implementation in progress. Check git status and .claude/.task-plan.\nNext: Resume TDD cycle (red → green → refactor), then run node scripts/check-all.mjs L1.',
  verification:
    'Phase: verification\nAction: Gate running. Re-run: node scripts/check-all.mjs L2\nNext: Fix any failures, then commit and push.',
  complete:
    'Phase: complete\nAction: Task is complete. Check if PR was created: gh pr list --head $(git branch --show-current)\nNext: Verify PR merged and issue closed.',
}

export function runTaskResume({ dir }: TaskResumeOptions = {}): void {
  const root = dir ?? process.cwd()
  const claudeDir = join(root, '.claude')
  const phase = readPhase(claudeDir)

  // Try to load status.json for richer context
  let taskId: string | undefined
  try {
    const taskIdRaw = readFileSync(join(claudeDir, '.task-id'), 'utf-8').trim()
    if (taskIdRaw) taskId = taskIdRaw
  } catch {
    // No task id — ok
  }

  const header = taskId ? `Task: ${taskId}\n` : ''
  const recovery = RECOVERY_TABLE[phase]
  process.stdout.write(`${header}${recovery}\n`)
}

export function runTaskAdvance(opts: TaskAdvanceOptions): void {
  const dir = opts.dir ?? process.cwd()
  const claudeDir = join(dir, '.claude')
  const { to, reverse = false } = opts

  if (!PHASE_ORDER.includes(to)) {
    throw new Error(`Invalid --to value: "${to}". Valid phases: ${PHASE_ORDER.join(', ')}`)
  }

  const current = readPhase(claudeDir)
  const currentIdx = PHASE_ORDER.indexOf(current)
  const targetIdx = PHASE_ORDER.indexOf(to)

  if (currentIdx === targetIdx) return

  if (targetIdx < currentIdx && !reverse) {
    throw new Error(
      `Backward transition "${current}" → "${to}" blocked. Use --reverse to allow backward transitions.`,
    )
  }

  if (targetIdx > currentIdx + 1) {
    throw new Error(
      `Illegal skip: cannot advance from "${current}" to "${to}" (missing intermediate phases). Advance one phase at a time.`,
    )
  }

  mkdirSync(claudeDir, { recursive: true })
  const timestamp = new Date().toISOString()
  writeFileSync(join(claudeDir, '.task-phase'), to + '\n')
  appendFileSync(join(claudeDir, '.task-phase-history'), `${timestamp} ${current} → ${to}\n`)
}
