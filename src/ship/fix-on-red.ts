// SPDX-License-Identifier: Apache-2.0
//
// #1289 — fix-on-red engine module (ADR-093). The DETERMINISTIC half of the dual-side
// ship fix-on-red loop: compute a stable `<check-name>:<error-class>` failure signature,
// remember per-signature attempts in a schema-validated `.arbiter/ship/<id>/attempts.json`,
// and apply the 2-strike rule (same signature twice → escalate `needs-human`, never a 3rd
// retry). The model-side diagnosis + fix lives in the driver (#1290); this module never
// writes code. Fail-closed throughout (INV-96): an uncertain signature, an unreadable
// attempts file, or a failed persist all escalate — they never emit a blind retry.
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/** Same signature seen this many times → escalate to a human; never a further retry. */
export const STRIKE_LIMIT = 2

/** A check name must already be a clean slug — we validate, never silently rewrite (RT-10). */
const CHECK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
/** Bounded tail window read from a (potentially huge, attacker-influenceable) log (RT-06b). */
const DEFAULT_LOG_BUDGET = 1024 * 1024
/** Per-line scan cap — guards the regex table against catastrophic backtracking (RT-11). */
const MAX_LINE = 2000

// ───────────────────────────── signature parsing ─────────────────────────────

export interface ParseSuccess {
  ok: true
  signature: string
  checkName: string
  errorClass: string
}
export interface ParseFailure {
  ok: false
  reason: string
}

/**
 * Compute the `<check-name>:<error-class>` signature for a failed-gate log. Fail-closed:
 * returns `ok:false` (never a guessed signature) when the check name is not already a slug
 * or no error class can be derived. The error class is scoped to the failure *type*, never
 * collapsed to the bare framework name, so distinct failures stay distinct (RT-02).
 */
export function parseFailureSignature(checkName: string, log: string): ParseSuccess | ParseFailure {
  if (!CHECK_NAME_RE.test(checkName)) {
    return { ok: false, reason: `check name "${checkName}" is not a valid slug ([a-z0-9-])` }
  }
  const errorClass = deriveErrorClass(log)
  if (errorClass === null) {
    return { ok: false, reason: 'no recognised error class in the failure log' }
  }
  return { ok: true, signature: `${checkName}:${errorClass}`, checkName, errorClass }
}

/** Bounded, ReDoS-safe iteration over the log's non-trivial lines. */
function scanLines(log: string): string[] {
  return log
    .split(/\r?\n/)
    .map((l) => (l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l))
    .filter((l) => l.trim().length > 0)
}

const ERROR_CTOR_RE = /\b([A-Z][A-Za-z0-9]*(?:Error|Exception))\b/
const TS_CODE_RE = /\bTS\d{3,5}\b/
// Anchored on the severity word eslint actually prints, so a line that merely
// ends in `word/word` (a two-segment path) can never be classified as a rule id.
const ESLINT_RULE_RE = /\b(?:error|warning)\s+.*?\s([a-z@][\w-]{1,40}\/[\w-]{1,40})\s*$/
/** Exact tool failure markers (not the ambiguous bare "FAILED" substring — RT-13). */
const TOOL_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBUILD FAILED\b/, 'build-failed'],
  [/\btest result: FAILED\b/, 'cargo-test-failed'],
  [/^---\s*FAIL:/, 'go-test-failed'],
  [/duplication.*(?:exceed|threshold)/i, 'duplication-exceeded'],
  [/coverage.*(?:below|threshold)/i, 'coverage-below-threshold'],
]
/** Lines that genuinely indicate an assertion/error failure (used for the shape fallback). */
const FAILURE_LINE_RE = /\bexpected\b|\bError:|\bAssertionError\b|^\s*(?:FAIL|✗|×|✕|not ok)\b/i

/**
 * Derive the error-class token. Priority order (RT-07: pick by class, not text position,
 * so multi-token / reordered logs collapse to one stable class): named error/exception →
 * tsc code → eslint rule id → tool marker → masked assertion-shape fallback. Returns null
 * when nothing classifiable is present (fail-closed → caller escalates).
 */
function deriveErrorClass(log: string): string | null {
  const lines = scanLines(log)
  const named = firstClassToken(lines)
  if (named !== null) return slug(named)
  const shape = maskedShape(lines)
  return shape === null ? null : slug(shape)
}

/** First class token by fixed category priority, deterministic within a category. */
function firstClassToken(lines: readonly string[]): string | null {
  const errors = collectMatches(lines, ERROR_CTOR_RE)
  if (errors.length > 0) return [...errors].sort()[0] ?? null
  const tsCodes = collectMatches(lines, TS_CODE_RE)
  if (tsCodes.length > 0) return [...tsCodes].sort()[0] ?? null
  const eslint = collectMatches(lines, ESLINT_RULE_RE)
  if (eslint.length > 0) return [...eslint].sort()[0] ?? null
  for (const [re, token] of TOOL_MARKERS) {
    if (lines.some((l) => re.test(l))) return token
  }
  return null
}

/** Distinct capture-group-1 (or whole-match) tokens for a non-global pattern, per line. */
function collectMatches(lines: readonly string[], re: RegExp): string[] {
  const out = new Set<string>()
  for (const line of lines) {
    const m = line.match(re)
    if (m !== null) out.add(m[1] ?? m[0])
  }
  return [...out]
}

/** Masked shape of the first genuine failure line — stable across volatile token noise. */
function maskedShape(lines: readonly string[]): string | null {
  const line = lines.find((l) => FAILURE_LINE_RE.test(l))
  return line === undefined ? null : normalizeNoise(line)
}

/** Replace every volatile token class with a stable sentinel word (RT-04). Order matters. */
function normalizeNoise(input: string): string {
  return input
    .replace(/"[^"]*"/g, ' str ')
    .replace(/'[^']*'/g, ' str ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' uuid ')
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/gi, ' ts ')
    .replace(/[\w.-]*\/[\w./-]+/g, ' path ')
    .replace(/\b0x[0-9a-f]+\b/gi, ' hex ')
    .replace(/\b[0-9a-f]{7,}\b/gi, ' hex ')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|m|µs|ns)\b/gi, ' dur ')
    .replace(/\d+/g, ' num ')
}

/** Lowercase, collapse to `[a-z0-9-]`, trim dashes, cap length. Pollution-safe (RT-08). */
function slug(token: string): string {
  const s = token
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
  return s.length > 0 ? s : 'unknown'
}

// ───────────────────────────── attempts memory ─────────────────────────────

const ShipAttemptEntryV1 = z.object({
  signature: z.string().min(1),
  // recordFailure never persists 0 — a stored count:0 is anomalous state and
  // must be rejected (fail-closed), not silently trusted as a free first strike.
  count: z.number().int().positive(),
  first_seen: z.iso.datetime(),
  last_seen: z.iso.datetime(),
})
export const ShipAttemptsV1 = z.object({
  $schemaVersion: z.literal(1),
  task_id: z.string().regex(/^#\d+$/, 'task_id must start with # followed by digits'),
  attempts: z.array(ShipAttemptEntryV1),
  updated_at: z.iso.datetime(),
})
export type ShipAttempts = z.infer<typeof ShipAttemptsV1>

const EPOCH = '1970-01-01T00:00:00.000Z'

/** A fresh, empty attempts record for a task. */
export function emptyAttempts(taskId: string): ShipAttempts {
  return { $schemaVersion: 1, task_id: taskId, attempts: [], updated_at: EPOCH }
}

/** `.arbiter/ship/<task-id>/attempts.json` — per-task dir to prevent cross-task bleed (RT-05). */
export function attemptsPath(taskId: string, repoDir: string): string {
  return join(repoDir, '.arbiter', 'ship', taskId, 'attempts.json')
}

export type LoadResult =
  | { ok: true; data: ShipAttempts; absent: boolean }
  | { ok: false; reason: string }

/**
 * Load the attempts record. An ABSENT file is empty state (count starts 0). A present but
 * unreadable / invalid / wrong-task file is a FAILURE — the caller must escalate, never reset
 * a live strike counter (RT-09).
 */
export function loadAttempts(taskId: string, repoDir: string): LoadResult {
  const p = attemptsPath(taskId, repoDir)
  if (!existsSync(p)) return { ok: true, data: emptyAttempts(taskId), absent: true }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'))
  } catch (err) {
    return { ok: false, reason: `unreadable attempts file: ${errText(err)}` }
  }
  const parsed = ShipAttemptsV1.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `invalid attempts schema: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    }
  }
  if (parsed.data.task_id !== taskId) {
    return { ok: false, reason: `attempts file task_id ${parsed.data.task_id} ≠ ${taskId}` }
  }
  return { ok: true, data: parsed.data, absent: false }
}

/** Atomically persist the attempts record (tmp + rename — no torn file on crash, RT-06). */
export function writeAttempts(taskId: string, repoDir: string, data: ShipAttempts): string {
  const p = attemptsPath(taskId, repoDir)
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  renameSync(tmp, p)
  return p
}

// ───────────────────────────── 2-strike policy ─────────────────────────────

export interface FixDecision {
  kind: 'fix'
  signature: string
  attempt: number
  nextAction: string
  /** #1291 — true ONLY at autonomy L3: the driver may push the fix without a human. */
  autopush: boolean
}
export interface EscalateDecision {
  kind: 'escalate'
  signature: string
  attempt: number
  nextAction: string
}
export interface EscalateUncertainDecision {
  kind: 'escalate-uncertain'
  signature?: string
  attempt?: number
  reason: string
  nextAction: string
}
export type Decision = FixDecision | EscalateDecision | EscalateUncertainDecision

const REPRODUCE_ACTION = 'Reproduce the failed gate locally before push, then fix the root cause'
const ESCALATE_ACTION = 'Apply the needs-human label and STOP — no further retry'
const UNCERTAIN_ACTION = 'STOP and hand off to a human — cannot safely retry'

/**
 * Apply the 2-strike rule to one red occurrence. Increments the per-signature counter
 * (monotonic) and decides: first strike → `fix` (with the reproduce-before-push action);
 * at/over the limit → `escalate`. Pure — returns the new state, never mutates the input.
 */
export function recordFailure(
  state: ShipAttempts,
  signature: string,
  now: string,
): { state: ShipAttempts; decision: Decision } {
  const existing = state.attempts.find((e) => e.signature === signature)
  const count = (existing?.count ?? 0) + 1
  const entry = { signature, count, first_seen: existing?.first_seen ?? now, last_seen: now }
  const attempts = existing
    ? state.attempts.map((e) => (e.signature === signature ? entry : e))
    : [...state.attempts, entry]
  const nextState: ShipAttempts = { ...state, attempts, updated_at: now }
  const decision: Decision =
    count >= STRIKE_LIMIT
      ? {
          kind: 'escalate',
          signature,
          attempt: count,
          nextAction: `${ESCALATE_ACTION} (${signature}).`,
        }
      : {
          kind: 'fix',
          signature,
          attempt: count,
          nextAction: `${REPRODUCE_ACTION} of ${signature}.`,
          autopush: false,
        }
  return { state: nextState, decision }
}

/** Autonomy levels the fix decision is gated on (#1291, ADR-093 §4). */
export type FixAutonomy = 'L0' | 'L1' | 'L2' | 'L3'

export interface EvaluateRedOptions {
  taskId: string
  checkName: string
  log: string
  repoDir: string
  now?: string
  /**
   * #1291 — resolved autonomy level; default L0 (ask each step). Gates ONLY the
   * fix decision (ASK-prefix below L2, autopush at L3). Escalation paths never
   * consult it — the 2-strike floor cannot be granted away.
   */
  autonomy?: FixAutonomy
}

/**
 * End-to-end decision for a red gate: parse → load → record → persist → decide. The three
 * fail-closed paths (uncertain parse, unreadable state, failed persist) all return
 * `escalate-uncertain` and never a `fix` (INV-96).
 */
export function evaluateRed(opts: EvaluateRedOptions): Decision {
  const now = opts.now ?? new Date().toISOString()
  const parsed = parseFailureSignature(opts.checkName, opts.log)
  if (!parsed.ok) return uncertain(parsed.reason)

  const loaded = loadAttempts(opts.taskId, opts.repoDir)
  if (!loaded.ok) return uncertain(loaded.reason, parsed.signature)

  const { state, decision } = recordFailure(loaded.data, parsed.signature, now)
  try {
    writeAttempts(opts.taskId, opts.repoDir, state)
  } catch (err) {
    return uncertain(`could not persist attempt: ${errText(err)}`, parsed.signature)
  }
  return applyAutonomy(decision, opts.autonomy ?? 'L0')
}

/**
 * #1291 — gate the FIX decision on the autonomy level. The reproduce-before-push
 * floor text is always present; below L3 the push is handed to a human; below L2
 * even APPLYING the fix needs a human go (ask-on-risky, ADR-093 L1). Escalation
 * decisions pass through untouched at every level.
 */
function applyAutonomy(decision: Decision, autonomy: FixAutonomy): Decision {
  if (decision.kind !== 'fix') return decision
  if (autonomy === 'L3') {
    return { ...decision, autopush: true }
  }
  const handOff = `${decision.nextAction} Do not push autonomously — hand the fix to the human for push approval.`
  if (autonomy === 'L2') {
    return { ...decision, autopush: false, nextAction: handOff }
  }
  return {
    ...decision,
    autopush: false,
    nextAction: `ASK the human before applying this fix — ${handOff}`,
  }
}

/** Fail-closed escalation when the signature, the stored count, or the persist is uncertain. */
function uncertain(reason: string, signature?: string): EscalateUncertainDecision {
  return {
    kind: 'escalate-uncertain',
    ...(signature !== undefined ? { signature } : {}),
    reason,
    nextAction: `${UNCERTAIN_ACTION}: ${reason}.`,
  }
}

// ───────────────────────────── bounded log read ─────────────────────────────

/**
 * Read at most `maxBytes` from the TAIL of a log file (failures print last). Rejects binary
 * input (a NUL byte) so a wrong decision can never be computed from non-text (RT-06b/11).
 */
export function readBoundedLog(filePath: string, maxBytes: number = DEFAULT_LOG_BUDGET): string {
  if (maxBytes <= 0) {
    throw new RangeError(`maxBytes must be > 0, got ${maxBytes}`)
  }
  const fd = openSync(filePath, 'r')
  try {
    const size = fstatSync(fd).size
    const len = Math.min(size, maxBytes)
    const start = size > maxBytes ? size - maxBytes : 0
    const buf = Buffer.alloc(len)
    if (len > 0) readSync(fd, buf, 0, len, start)
    if (buf.includes(0)) throw new Error(`binary log file (NUL byte): ${filePath}`)
    return buf.toString('utf-8')
  } finally {
    closeSync(fd)
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
