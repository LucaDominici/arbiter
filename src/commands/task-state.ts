// SPDX-License-Identifier: Apache-2.0
//
// Unified task-state document (#1206).
//
// Collapses the historical split-brain — flat `.claude/.task-*` dotfiles (authoritative phase) plus
// a per-id `.claude/.task-{sanit}/status.json` (rich, but frozen at phase:'red' after handoff) — into
// ONE authoritative document pair at a fixed path:
//
//   .claude/.task/status.json   structured state (phase + cursor + metadata) — single writer
//   .claude/.task/log.md        append-only human-readable digest (transitions + `arbiter mark`)
//
// Fixed path (not per-sanitized-id) lets generated hooks find state without first reading a
// `.task-id` dotfile. This module is the LOWER layer: it owns the phase vocabulary and all state
// I/O. `src/commands/task.ts` is the higher orchestration layer and imports from here.
import { existsSync, readFileSync, rmSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from '../utils/fs.js'
import { sanitizeTaskId } from '../utils/task-id.js'

// ─── Phase vocabulary (single source; re-exported by task.ts for back-compat) ────────────────

export type TaskPhase =
  | 'preflight'
  | 'plan'
  | 'red-team-review'
  | 'red-team-rework'
  | 'red'
  | 'green'
  | 'refactor'
  | 'verification'
  | 'complete'

export type HandoffStrategy = 'interactive' | 'inline' | null

export const PHASE_ORDER: readonly TaskPhase[] = [
  'preflight',
  'plan',
  'red-team-review',
  'red',
  'green',
  'refactor',
  'verification',
  'complete',
]

export const LATERAL_PHASES: readonly TaskPhase[] = ['red-team-rework']

export function isValidPhase(s: string): s is TaskPhase {
  return (
    (PHASE_ORDER as readonly string[]).includes(s) ||
    (LATERAL_PHASES as readonly string[]).includes(s)
  )
}

// ─── Document schema ─────────────────────────────────────────────────────────────────────────

export type TddPhase = 'RED' | 'GREEN' | 'REFACTOR' | null

export interface StepCursor {
  /** Fine-grained TDD sub-phase within the coarse `red`/`green`/`refactor` phases. */
  tddPhase: TddPhase
  /** One-line description of the most recently completed sub-step. */
  lastAction: string
  /** One-line description of the exact next sub-step — what resume lands on after `/clear`. */
  nextAction: string
}

export interface UnifiedTaskState {
  taskId: string
  phase: TaskPhase
  tier: string
  /** Repo-relative path to the active plan file. */
  plan: string
  cursor: StepCursor
  /** Task branch name, when known. */
  branch?: string
  handoffStrategy: HandoffStrategy
  handoffReady: boolean
  planningHandoffReady?: string
  postClearResumed?: string
  hostCapabilities?: { modelSwitch: boolean; transcriptAvailable: boolean }
  cost?: { byPhase: Record<string, { in: number; out: number; samples: number }> }
  runId: string
  timestamps: Record<string, string>
  gateDecisions: string[]
}

/** A partial update applied to the unified document; `cursor` may itself be partial. */
export type TaskStatePatch = Partial<Omit<UnifiedTaskState, 'cursor'>> & {
  cursor?: Partial<StepCursor>
}

const TASK_DIRNAME = '.task'
const STATUS_FILENAME = 'status.json'

export function taskStateDir(root: string): string {
  return join(root, '.claude', TASK_DIRNAME)
}
export function statusPath(root: string): string {
  return join(taskStateDir(root), STATUS_FILENAME)
}
export function logPath(root: string): string {
  return join(taskStateDir(root), 'log.md')
}

function emptyCursor(): StepCursor {
  return { tddPhase: null, lastAction: '', nextAction: '' }
}

function defaultState(): UnifiedTaskState {
  return {
    taskId: '',
    phase: 'preflight',
    tier: '',
    plan: '',
    cursor: emptyCursor(),
    handoffStrategy: null,
    handoffReady: false,
    runId: '',
    timestamps: {},
    gateDecisions: [],
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Normalize a raw legacy/unified phase string: migrate the pre-#549 `implementation` alias to
 * `red`, and reject any unrecognized value (mirrors the historical readPhase guard).
 */
export function normalizePhase(raw: string | undefined, sourceLabel = STATUS_FILENAME): TaskPhase {
  if (raw === undefined || raw === '') return 'preflight'
  if (raw === 'implementation') return 'red'
  if (!isValidPhase(raw)) {
    throw new Error(
      `Corrupted phase value "${raw}" in ${sourceLabel}. ` +
        `Valid phases: ${PHASE_ORDER.join(', ')}. ` +
        `Remove .claude/.task/ and re-run with --to preflight to reset.`,
    )
  }
  return raw
}

/** Ensure a parsed/seeded object is a complete UnifiedTaskState with all defaults filled. */
function normalize(raw: Partial<UnifiedTaskState>): UnifiedTaskState {
  const base = defaultState()
  return {
    ...base,
    ...raw,
    phase: normalizePhase(raw.phase),
    cursor: { ...emptyCursor(), ...(raw.cursor ?? {}) },
    timestamps: raw.timestamps ?? {},
    gateDecisions: raw.gateDecisions ?? [],
  }
}

// ─── Read ──────────────────────────────────────────────────────────────────────────────────

/**
 * Read the unified document. If it is absent but legacy dotfiles exist, transparently migrate
 * (seed + delete legacy) and return the seeded state. Returns `null` for a truly fresh tree.
 */
export function readUnifiedState(root: string): UnifiedTaskState | null {
  const p = statusPath(root)
  if (existsSync(p)) {
    let parsed: Partial<UnifiedTaskState>
    try {
      parsed = JSON.parse(readFileSync(p, 'utf-8')) as Partial<UnifiedTaskState>
    } catch (err: unknown) {
      throw new Error(`readUnifiedState: corrupted status at ${p}: ${msg(err)}`, { cause: err })
    }
    return normalize(parsed)
  }
  return seedFromLegacy(root)
}

/** Active task id from the unified document, or undefined if none/empty. */
export function readTaskId(root: string): string | undefined {
  const id = readUnifiedState(root)?.taskId.trim()
  return id && id.length > 0 ? id : undefined
}

// ─── Write ────────────────────────────────────────────────────────────────────────────────

/**
 * Read-modify-write the unified document, merging `patch` over ALL prior fields. Nested
 * `cursor`/`timestamps` are shallow-merged so a partial patch never clobbers untouched keys.
 * When `patch.phase` is set, its transition timestamp is stamped. Atomic (temp-file + rename).
 */
export function writeUnifiedState(root: string, patch: TaskStatePatch): UnifiedTaskState {
  const prev = readUnifiedState(root) ?? defaultState()
  const merged: UnifiedTaskState = {
    ...prev,
    ...patch,
    cursor: { ...prev.cursor, ...(patch.cursor ?? {}) },
    timestamps: { ...prev.timestamps, ...(patch.timestamps ?? {}) },
  }
  if (patch.phase) {
    merged.timestamps = { ...merged.timestamps, [patch.phase]: new Date().toISOString() }
  }
  if (!merged.runId) merged.runId = `${process.pid}-${Date.now()}`
  writeFile(statusPath(root), JSON.stringify(merged, null, 2) + '\n')
  return merged
}

/** Append a single timestamped line to the human-readable digest log. */
export function appendLog(root: string, line: string): void {
  mkdirSync(taskStateDir(root), { recursive: true })
  appendFileSync(logPath(root), `- ${new Date().toISOString()} ${line}\n`)
}

// ─── Migration (legacy dotfiles → unified document) ──────────────────────────────────────────

const DOT_PHASE = '.task-phase'
const DOT_ID = '.task-id'
const DOT_TIER = '.task-tier'
const DOT_PLAN = '.task-plan'
const DOT_HANDOFF_READY = '.task-handoff-ready'
const DOT_HISTORY = '.task-phase-history'

const LEGACY_DOTFILES = [
  DOT_PHASE,
  DOT_ID,
  DOT_TIER,
  DOT_PLAN,
  DOT_HANDOFF_READY,
  DOT_HISTORY,
] as const

function readDotfile(claudeDir: string, name: string): string | undefined {
  const p = join(claudeDir, name)
  if (!existsSync(p)) return undefined
  const raw = readFileSync(p, 'utf-8').trim()
  return raw.length > 0 ? raw : undefined
}

function legacyPerIdStatusPath(claudeDir: string, idRaw: string): string {
  return join(claudeDir, '.task-' + sanitizeTaskId(idRaw), STATUS_FILENAME)
}

/**
 * Seed the unified document from legacy state and delete the legacy files. Merges BOTH legacy
 * sources — flat dotfiles (authoritative phase/id/tier/plan) AND the per-id
 * `.task-{sanit}/status.json` (rich cost/runId/handoff/timestamps) — so nothing is orphaned and
 * cost is not double-counted. Crash-safe: the unified doc is written atomically FIRST; legacy is
 * removed only after. Returns `null` when there is no legacy state to migrate.
 */
export function seedFromLegacy(root: string): UnifiedTaskState | null {
  const claudeDir = join(root, '.claude')
  const phaseRaw = readDotfile(claudeDir, DOT_PHASE)
  const idRaw = readDotfile(claudeDir, DOT_ID)
  if (phaseRaw === undefined && idRaw === undefined) return null

  let rich: Partial<UnifiedTaskState> = {}
  if (idRaw) {
    const richPath = legacyPerIdStatusPath(claudeDir, idRaw)
    if (existsSync(richPath)) {
      try {
        rich = JSON.parse(readFileSync(richPath, 'utf-8')) as Partial<UnifiedTaskState>
      } catch {
        // Corrupt legacy rich state — ignore; flat dotfiles are authoritative for the migration.
      }
    }
  }

  const seeded: UnifiedTaskState = normalize({
    ...rich,
    taskId: idRaw ?? rich.taskId ?? '',
    phase: normalizePhase(phaseRaw, DOT_PHASE),
    tier: readDotfile(claudeDir, DOT_TIER) ?? rich.tier ?? '',
    plan: readDotfile(claudeDir, DOT_PLAN) ?? rich.plan ?? '',
    handoffReady: existsSync(join(claudeDir, DOT_HANDOFF_READY)),
    cursor: emptyCursor(),
  })

  writeFile(statusPath(root), JSON.stringify(seeded, null, 2) + '\n')
  for (const f of LEGACY_DOTFILES) rmSync(join(claudeDir, f), { force: true })
  if (idRaw) {
    rmSync(join(claudeDir, '.task-' + sanitizeTaskId(idRaw)), { recursive: true, force: true })
  }
  return seeded
}
