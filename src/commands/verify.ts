import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runProbes } from '../compatibility/probe.js'
import { formatText, formatJson } from '../compatibility/report.js'
import { loadConfig } from '../utils/config.js'
import { detectLanguage } from '../detectors/language.js'
import { verifySummarySha } from '../risk/sha-check.js'
import {
  classifyPath,
  highestRisk,
  UNCLASSIFIED_LEVEL,
  type ClassifyResult,
  type RiskLevel,
} from '../risk/classifier.js'
import type { Language } from '../wizard/types.js'
import { loadSummaryFile } from '../evidence/load.js'
import { validateSummarySchema } from '../evidence/summary.js'

export interface VerifyOptions {
  dir?: string | undefined
  json?: boolean | undefined
}

export interface VerifyEvidenceResult {
  status: 'ok' | 'warning' | 'error'
  exitCode: 0 | 1 | 2
  reason?: string
  skipped?: boolean
  /** Aggregate risk level across SUMMARY.json `files[]`. Absent when the
   *  summary has no `files` field or no skip-applicable path was reached. */
  riskLevel?: ClassifyResult
}

const FRESHNESS_DAYS = 7
const MS_PER_DAY = 86_400_000

/**
 * Pattern enforced on `E2E_RISK_SKIP` reasons:
 *   <category>:#<issue>[:<slug>]
 * where <category> ∈ {flake, infra, external} and <issue> is digits.
 * Examples:
 *   flake:#123
 *   infra:#456:db-outage
 *   external:#789
 *
 * Any other value is REFUSED — the skip falls through to normal
 * verification. Unconstrained string bypasses (e.g. "lol") are not
 * allowed because the skip silently disables an auditing gate.
 */
const SKIP_REASON_PATTERN = /^(?:flake|infra|external):#\d+(?::[\w-]+)?$/

function isValidSkipReason(raw: string): boolean {
  return SKIP_REASON_PATTERN.test(raw)
}

/**
 * Append a single JSONL entry to `.evidence/skip-log.jsonl` for audit.
 *
 * If the write fails we cannot honour the skip — silently disabling the
 * audit trail would be exactly the footgun the gate exists to prevent —
 * so the error is surfaced to stderr and re-thrown.
 */
function writeSkipEntry(dir: string, reason: string): void {
  const evidenceDir = join(dir, '.evidence')
  const logPath = join(evidenceDir, 'skip-log.jsonl')
  try {
    mkdirSync(evidenceDir, { recursive: true })
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), reason }) + '\n',
      'utf-8',
    )
  } catch (err) {
    const errno =
      err && typeof err === 'object' && 'code' in err
        ? String((err as Record<string, unknown>)['code'])
        : 'unknown'
    process.stderr.write(
      `arbiter verify evidence: refusing to honour E2E_RISK_SKIP — ` +
        `audit log write failed (${errno}) at ${logPath}\n`,
    )
    throw err
  }
}

/** Languages the risk classifier knows about. */
const KNOWN_STACKS: ReadonlySet<Language> = new Set<Language>([
  'typescript',
  'java',
  'kotlin',
  'rust',
  'python',
  'go',
])

/**
 * Resolve the stack to classify against, in order of preference:
 *   1. The `stack` field embedded in SUMMARY.json (signed by the SHA)
 *   2. `detectLanguage(dir)` from the project on disk
 */
function resolveStack(summary: Record<string, unknown>, dir: string): Language {
  const stored = summary['stack']
  if (typeof stored === 'string' && KNOWN_STACKS.has(stored as Language)) {
    return stored as Language
  }
  return detectLanguage(dir)
}

/** Aggregate risk across the SUMMARY.json `files[]` array, if present. */
function classifyFiles(summary: Record<string, unknown>, stack: Language): ClassifyResult | null {
  const raw = summary['files']
  if (!Array.isArray(raw) || raw.length === 0) return null
  const levels: ClassifyResult[] = []
  for (const f of raw) {
    if (typeof f !== 'string') continue
    levels.push(classifyPath(f, stack))
  }
  if (levels.length === 0) return null
  return highestRisk(levels)
}

/**
 * Risk-driven stale gating: how severe should stale evidence be at this
 * risk level? Returns the (exit code, status) pair to use.
 *
 *   R0/R1 (high risk)  → blocker (exit 2)
 *   R2     (medium)    → blocker (exit 2)
 *   R3/R4 (low risk)   → warning (exit 1)
 *
 * The higher-risk the change, the less we tolerate stale evidence.
 */
function staleSeverity(level: RiskLevel): {
  exitCode: 1 | 2
  status: 'warning' | 'error'
} {
  if (level === 'R0' || level === 'R1' || level === 'R2') {
    return { exitCode: 2, status: 'error' }
  }
  return { exitCode: 1, status: 'warning' }
}

/** Handle the `E2E_RISK_SKIP` env override. Returns the result envelope
 *  to short-circuit with, or null when verification should proceed. */
function handleRiskSkip(dir: string): VerifyEvidenceResult | null {
  const skip = process.env['E2E_RISK_SKIP']
  if (!skip || skip.trim() === '') return null
  const trimmed = skip.trim()
  if (isValidSkipReason(trimmed)) {
    writeSkipEntry(dir, trimmed)
    process.stderr.write(
      `arbiter verify evidence: E2E_RISK_SKIP honoured — ` +
        `reason="${trimmed}" log=${join(dir, '.evidence', 'skip-log.jsonl')}\n`,
    )
    return { status: 'ok', exitCode: 0, skipped: true, reason: trimmed }
  }
  // Invalid skip pattern → refuse, fall through to normal verification.
  process.stderr.write(
    `arbiter verify evidence: E2E_RISK_SKIP="${trimmed}" rejected — ` +
      `must match <flake|infra|external>:#<issue>[:<slug>] (e.g. flake:#123). ` +
      `Falling through to normal verification.\n`,
  )
  return null
}

function loadSummary(summaryPath: string): Record<string, unknown> | VerifyEvidenceResult {
  const loaded = loadSummaryFile(summaryPath)
  if (!loaded.ok) {
    return { status: 'error', exitCode: 1, reason: loaded.reason }
  }
  return loaded.body
}

function isResult(v: Record<string, unknown> | VerifyEvidenceResult): v is VerifyEvidenceResult {
  return 'exitCode' in v && 'status' in v
}

/** Decide the stale-evidence envelope for a given risk level + age string. */
function makeStaleResult(riskLevel: RiskLevel | null, ageStr: string): VerifyEvidenceResult {
  if (riskLevel === null) {
    return { status: 'warning', exitCode: 1, reason: ageStr }
  }
  const sev = staleSeverity(riskLevel)
  return {
    status: sev.status,
    exitCode: sev.exitCode,
    riskLevel,
    reason: sev.exitCode === 2 ? `${ageStr}; high-risk change set requires fresh evidence` : ageStr,
  }
}

/** Compute the freshness envelope from the SUMMARY timestamp + risk level.
 *  Returns null when timestamp is missing/unreadable or evidence is fresh. */
function checkFreshness(
  summary: Record<string, unknown>,
  riskLevel: RiskLevel | null,
): VerifyEvidenceResult | null {
  const ts = summary['timestamp']
  if (typeof ts !== 'string') return null
  const tsMs = Date.parse(ts)
  if (!Number.isFinite(tsMs)) return null
  const ageDays = (Date.now() - tsMs) / MS_PER_DAY
  if (ageDays <= FRESHNESS_DAYS) return null
  const ageStr = `summary is ${ageDays.toFixed(1)} days old (>${FRESHNESS_DAYS})`
  return makeStaleResult(riskLevel, ageStr)
}

/**
 * Verify an existing `.evidence/SUMMARY.json` snapshot. Returns a result
 * envelope so callers (CLI / programmatic) can decide how to surface it.
 *
 * Exit code conventions (canonical CLI convention — see CLI.md §Exit codes):
 *   0 = ok (or E2E_RISK_SKIP set with a valid reason)
 *   1 = missing/unreadable SUMMARY.json, invalid JSON, low-risk stale, or unclassified
 *   2 = SHA mismatch, or stale evidence on medium/high-risk changes (R0-R2)
 *
 * Risk gating: when SUMMARY.json carries a non-empty `files[]` array, each
 * file is classified via `classifyPath(file, stack)` and the highest risk
 * level drives gate strictness — see `staleSeverity` below.
 *
 * #238
 */
export function runVerifyEvidence(opts: VerifyOptions): VerifyEvidenceResult {
  const dir = resolve(opts.dir ?? '.')

  const skipResult = handleRiskSkip(dir)
  if (skipResult) return skipResult

  const summaryPath = join(dir, '.evidence', 'SUMMARY.json')
  const loaded = loadSummary(summaryPath)
  if (isResult(loaded)) return loaded

  const shaResult = verifySummarySha(loaded)
  if (!shaResult.ok) {
    return {
      status: 'error',
      exitCode: 2,
      reason: shaResult.reason ?? 'sha mismatch',
    }
  }

  const schema = validateSummarySchema(loaded)
  if (!schema.ok) {
    return { status: 'error', exitCode: 1, reason: schema.errors.join('; ') }
  }

  // Classify the change set (if any files are listed) so we can scale
  // freshness severity to risk. Absent files[] → no risk gating possible
  // and we fall back to the legacy advisory-only stale behaviour.
  const stack = resolveStack(loaded, dir)
  const aggregated = classifyFiles(loaded, stack)

  // UNCLASSIFIED in the changeset means the consumer must decide — we
  // refuse to fail open. Surfaces as advisory (exit 1) with a clear reason.
  if (aggregated === UNCLASSIFIED_LEVEL) {
    return {
      status: 'warning',
      exitCode: 1,
      riskLevel: aggregated,
      reason: 'one or more files could not be classified — manual review required',
    }
  }

  // Narrow: `aggregated` is now RiskLevel | null (UNCLASSIFIED handled above).
  const riskLevel: RiskLevel | null = aggregated
  const stale = checkFreshness(loaded, riskLevel)
  if (stale) return stale

  const result: VerifyEvidenceResult = { status: 'ok', exitCode: 0 }
  if (riskLevel !== null) result.riskLevel = riskLevel
  return result
}

export function runVerify(opts: VerifyOptions): void {
  const dir = resolve(opts.dir ?? '.')
  const report = runProbes(dir)

  if (opts.json) {
    // Augment the JSON envelope with the effective (post-env-override) config
    // so external consumers can see exactly what arbiter loaded — #233.
    const cfg = loadConfig(dir)
    const enriched = {
      ...report,
      effectiveConfig: cfg,
    }
    process.stdout.write(formatJson(enriched) + '\n')
  } else {
    process.stdout.write(formatText(report) + '\n')
  }

  if (report.hasFailures) {
    process.exit(1)
  }
}
