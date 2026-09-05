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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendFileTranslated,
  ensureDir,
  rmTranslated,
  writeFile,
  readFileTranslated,
  assertWritten,
} from '../utils/fs.js'
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
  | 'close'
  | 'complete'

type HandoffStrategy = 'interactive' | 'inline' | null

export const PHASE_ORDER: readonly TaskPhase[] = [
  'preflight',
  'plan',
  'red-team-review',
  'red',
  'green',
  'refactor',
  'verification',
  // #A11 — the closing phase (last mile: merge, red gate, conflict). Entry switches the active
  // agent-rule set to CLOSER mode (`.claude/rules/95-closer-mode.md`): single named target, no
  // new issues/refactor-beyond-diff (findings → PARKING), root-cause after 2 failed attempts.
  'close',
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

/** Narrow an arbitrary string to a non-null TddPhase. */
export function isTddPhase(s: string): s is Exclude<TddPhase, null> {
  return s === 'RED' || s === 'GREEN' || s === 'REFACTOR'
}

interface StepCursor {
  /** Fine-grained TDD sub-phase within the coarse `red`/`green`/`refactor` phases. */
  tddPhase: TddPhase
  /** One-line description of the most recently completed sub-step. */
  lastAction: string
  /** One-line description of the exact next sub-step — what resume lands on after `/clear`. */
  nextAction: string
}

/**
 * A red-team finding carried forward from the pre-implementation red-team phase
 * into code-review (#1212). Stable `id` (`RT-01`, `RT-02`, …) lets the review
 * map each finding to an auditor and cap that auditor's verdict contribution
 * while the finding is unresolved (see `.claude/commands/review-code.md`).
 */
interface RedTeamFinding {
  /** Stable forward-link id, e.g. `RT-01`. */
  id: string
  /** CRITICAL | HIGH | MEDIUM | LOW. */
  severity: string
  /** One-line description of the finding. */
  summary: string
  /** The auditor whose remit this falls under (a key of auditor-routing.json `auditors`). */
  auditorHint: string
  /** True once the finding has been addressed in the implementation. */
  resolved: boolean
}

export interface UnifiedTaskState {
  taskId: string
  phase: TaskPhase
  tier: string
  /** Repo-relative path to the active plan file. */
  plan: string
  cursor: StepCursor
  /** Task branch name, when known (stamped by `arbiter task init`). */
  branch?: string
  handoffStrategy: HandoffStrategy
  handoffReady: boolean
  planningHandoffReady?: string
  postClearResumed?: string
  runId: string
  timestamps: Record<string, string>
  gateDecisions: string[]
  /** Red-team findings forward-linked into code-review (#1212, INV-114 sibling). */
  redTeamFindings?: RedTeamFinding[]
  /**
   * #1305 (ADR-094 §Decision.3) — per-run setting overrides persisted into the session
   * layer so a `--set`/`--autonomy` value survives a mid-wave `/clear` (matches the `tier`
   * precedent). A config-path → raw-string map; values are validated by the resolver, not
   * here, so a stale/invalid entry can never harden into the resolved setting (fail-closed).
   */
  overrides?: Record<string, string>
  /**
   * #2102 — declared merge-train batch: other issue ids sequentially batched into this same
   * worktree/branch/gate/PR, in canonical `#NNN` form (normalized by `normalizeChainId`).
   * Explicit opt-in only (`--chain <id>`, repeatable) — never auto-derived from a shared
   * parent epic. Absent/empty ⇒ no chain (the pre-push enforcer is then a no-op).
   */
  chainIds?: string[]
  /**
   * #2400 — bounded review rounds. Absent on every task that has not reached `refactor` (and on
   * every document written before review tracking existed), which {@link reviewStateOf} reads as
   * round 0 — the key is never written speculatively.
   */
  review?: ReviewState
}

/** #2400 — how many review rounds this task has spent, and what the last one was pinned to. */
export interface ReviewState {
  /** Rounds recorded so far. 0 ⇒ the change has never been reviewed. */
  rounds: number
  /**
   * HEAD when the last round was recorded — the diff BASE for the next round, so round N ≥ 2
   * reviews `lastReviewedSha..HEAD` instead of the whole change. `null` when HEAD was
   * unreadable at the time (the round still counts; an unreadable sha must never disarm the cap).
   */
  lastReviewedSha: string | null
  /** True once a round past the cap was authorized with `--force-review`. */
  forced?: boolean
}

/**
 * #2400 — the review record, defaulted for a document that has none. The migration for every
 * status.json written before this field existed is exactly this read: absent ⇒ round 0.
 */
export function reviewStateOf(state: UnifiedTaskState | null): ReviewState {
  return state?.review ?? { rounds: 0, lastReviewedSha: null }
}

/** A partial update applied to the unified document; `cursor` may itself be partial. */
export type TaskStatePatch = Partial<Omit<UnifiedTaskState, 'cursor'>> & {
  cursor?: Partial<StepCursor>
}

/**
 * Normalize a `--chain <id>` value to canonical `#NNN`, rejecting non-numeric ids.
 *
 * #2102 — same guard `arbiter ship`'s primary-id normalizer applies (`normalizeShipTaskId`):
 * a chain id feeds the pre-push `#<id>` commit-message scan, so it must be a bare GitHub
 * issue number. Self-contained (no dependency on worktree paths) so both `task init` and
 * `ship` share it from the state module.
 */
export function normalizeChainId(raw: string): string {
  const core = raw.trim().replace(/^#/, '')
  if (!/^\d+$/.test(core)) {
    throw new Error(
      `Invalid chain id "${raw}" — expected a GitHub issue number like "1280" or "#1280".`,
    )
  }
  return `#${core}`
}

const TASK_DIRNAME = '.task'
const STATUS_FILENAME = 'status.json'

export function taskStateDir(root: string): string {
  return join(root, '.claude', TASK_DIRNAME)
}
export function statusPath(root: string): string {
  return join(taskStateDir(root), STATUS_FILENAME)
}
function logPath(root: string): string {
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

/** Normalize numeric task identities before lifecycle ownership comparisons. */
function canonicalTaskId(raw: string): string {
  const trimmed = raw.trim()
  const numeric = /^#?(\d+)$/.exec(trimmed)
  return numeric ? `#${numeric[1]}` : trimmed
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
  if (
    raw.chainIds !== undefined &&
    (!Array.isArray(raw.chainIds) || raw.chainIds.some((id) => typeof id !== 'string'))
  ) {
    throw new Error('Corrupted chainIds in status.json: expected an array of strings.')
  }
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
      parsed = JSON.parse(readFileTranslated(p, 'utf-8')) as Partial<UnifiedTaskState>
    } catch (err: unknown) {
      throw new Error(
        `readUnifiedState: corrupted status at ${p}: ${msg(err)}. ` +
          `Remove .claude/.task/ and re-run with --to preflight to reset.`,
        { cause: err },
      )
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
 *
 * #2533: this is internal task-engine state, never a generator-emitted target — written
 * with `skipPreserveCheck` (immune to `writeFile`'s `arbiter:preserve` marker) and its
 * `WriteResult` asserted via `assertWritten`, so a write that did not land is a loud
 * failure rather than every subsequent phase transition silently not persisting.
 */
export function writeUnifiedState(root: string, patch: TaskStatePatch): UnifiedTaskState {
  const prev = readUnifiedState(root) ?? defaultState()
  const nextTaskId = patch.taskId === undefined ? undefined : canonicalTaskId(patch.taskId)
  const taskChanged =
    nextTaskId !== undefined &&
    nextTaskId.length > 0 &&
    prev.taskId.length > 0 &&
    canonicalTaskId(prev.taskId) !== nextTaskId
  const base = taskChanged ? defaultState() : prev
  const normalizedPatch: TaskStatePatch = {
    ...patch,
    ...(nextTaskId !== undefined ? { taskId: nextTaskId } : {}),
  }
  const merged: UnifiedTaskState = {
    ...base,
    ...normalizedPatch,
    cursor: { ...base.cursor, ...(normalizedPatch.cursor ?? {}) },
    timestamps: { ...base.timestamps, ...(normalizedPatch.timestamps ?? {}) },
  }
  if (normalizedPatch.phase) {
    merged.timestamps = {
      ...merged.timestamps,
      [normalizedPatch.phase]: new Date().toISOString(),
    }
  }
  if (!merged.runId) merged.runId = `${process.pid}-${Date.now()}`
  const result = writeFile(statusPath(root), JSON.stringify(merged, null, 2) + '\n', {
    skipPreserveCheck: true,
  })
  assertWritten(result, `task-state document at ${statusPath(root)}`)
  return merged
}

// ─── Session-layer per-run overrides (#1305) ─────────────────────────────────────────────────

/**
 * #1305 (ADR-094 §Decision.3) — read a per-run override persisted in the session layer, or
 * undefined if none. This is the SESSION tier of the precedence resolver; it returns the raw
 * string verbatim (validation is the resolver's job, fail-closed) so a stale/invalid value can
 * never throw here. Path-gating is enforced at the write boundary, not on read.
 */
export function readOverride(root: string, path: string): string | undefined {
  return readUnifiedState(root)?.overrides?.[path]
}

/**
 * #1305 — persist a per-run override into the session layer so a `--set`/`--autonomy` value
 * survives a mid-wave `/clear` (matches the `tier` precedent). Merges over any existing overrides
 * map; the single-writer `writeUnifiedState` keeps it atomic. Callers MUST gate `path` through
 * `assertOverridablePath` first (RT-01) — this low-level writer stays free of the configure
 * catalog's heavy deps to avoid a module cycle.
 */
export function writeOverride(root: string, path: string, value: string): void {
  const prev = readUnifiedState(root)?.overrides ?? {}
  writeUnifiedState(root, { overrides: { ...prev, [path]: value } })
}

/** Append a single timestamped line to the human-readable digest log. */
export function appendLog(root: string, line: string): void {
  ensureDir(taskStateDir(root))
  appendFileTranslated(logPath(root), `- ${new Date().toISOString()} ${line}\n`)
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
  const raw = readFileTranslated(p, 'utf-8').trim()
  return raw.length > 0 ? raw : undefined
}

function legacyPerIdStatusPath(claudeDir: string, idRaw: string): string {
  return join(claudeDir, '.task-' + sanitizeTaskId(idRaw), STATUS_FILENAME)
}

/**
 * Seed the unified document from legacy state and delete the legacy files. Merges BOTH legacy
 * sources — flat dotfiles (authoritative phase/id/tier/plan) AND the per-id
 * `.task-{sanit}/status.json` (rich runId/handoff/timestamps) — so nothing is orphaned. Crash-safe:
 * the unified doc is written atomically FIRST; legacy is removed only after, and a corrupt rich
 * file is preserved (not deleted). Returns `null` when there is no legacy state to migrate.
 */
export function seedFromLegacy(root: string): UnifiedTaskState | null {
  const claudeDir = join(root, '.claude')
  const phaseRaw = readDotfile(claudeDir, DOT_PHASE)
  const idRaw = readDotfile(claudeDir, DOT_ID)
  if (phaseRaw === undefined && idRaw === undefined) return null

  let rich: Partial<UnifiedTaskState> = {}
  let richCorrupt = false
  if (idRaw) {
    const richPath = legacyPerIdStatusPath(claudeDir, idRaw)
    if (existsSync(richPath)) {
      try {
        rich = JSON.parse(readFileTranslated(richPath, 'utf-8')) as Partial<UnifiedTaskState>
      } catch (err: unknown) {
        // Corrupt legacy rich state — warn loudly and PRESERVE the file (do not delete below) so
        // its metadata (runId/handoff/timestamps) is recoverable rather than silently destroyed.
        richCorrupt = true
        process.stderr.write(
          `[arbiter] warn: legacy rich state at ${richPath} is unreadable (${msg(err)}); ` +
            `migrating flat dotfiles only and preserving the corrupt file for recovery.\n`,
        )
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

  // #2533: the legacy dotfiles below are deleted ONLY after this write — asserting
  // it actually landed (skipPreserveCheck: internal state, never a generator
  // target) is what makes that migration crash-safe rather than a silent data
  // loss (legacy removed while the unified doc it was meant to replace never wrote).
  const result = writeFile(statusPath(root), JSON.stringify(seeded, null, 2) + '\n', {
    skipPreserveCheck: true,
  })
  assertWritten(result, `task-state document at ${statusPath(root)}`)
  for (const f of LEGACY_DOTFILES) rmTranslated(join(claudeDir, f), { force: true })
  // Only delete the per-id rich dir when it parsed cleanly — a corrupt rich file is preserved.
  if (idRaw && !richCorrupt) {
    rmTranslated(join(claudeDir, '.task-' + sanitizeTaskId(idRaw)), {
      recursive: true,
      force: true,
    })
  }
  return seeded
}
