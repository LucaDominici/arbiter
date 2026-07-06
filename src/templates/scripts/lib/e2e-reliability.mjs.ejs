// SPDX-License-Identifier: Apache-2.0
// arbiter — stack-agnostic E2E reliability library (#1445, INV-130).
//
// A small, framework-neutral toolkit for telling a FLAKE apart from a real REGRESSION
// — the #1 source of fake-green for a prompt-only operator, where a flaky test that
// goes green on re-run is indistinguishable from a regression that rides the retry
// habit into production. It operates on a NORMALISED failure shape, so the same logic
// serves any runner (Playwright / Vitest / pytest / JUnit / go test …); per-framework
// adapters that map a native report onto this shape are thin and live in the target.
//
// Exports (all pure / fail-closed — an unknown failure is treated as a REGRESSION,
// never silently dismissed):
//   fingerprint(text)                  stable identity after volatile-token normalisation
//   classify(failure, {quarantined})   INFRA | FLAKE | REGRESSION
//   retryLadder(runAttempt, opts)      PASS | FLAKE | INFRA | REGRESSION over a retry ladder
//   riskTier(summary)                  R0 (clean) … R4 (block / error) — fail-closes to R4
//   appendLedger(path, entry)          append-only JSONL outcome ledger
//   validateQuarantine(registry, now)  quarantine-registry schema + expiry validation
//   QUARANTINE_REQUIRED_FIELDS         the registry entry contract
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// ─── Deterministic fingerprint ────────────────────────────────────────────────
// Strip the volatile tokens that make two runs of the SAME failure look different,
// then hash. Keeps failure identity stable across machines, runs, and clocks.
const NORMALISERS = [
  // ISO-ish timestamps (with or without millis / timezone)
  [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<TS>'],
  // UUIDs
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>'],
  // hex pointers / addresses
  [/0x[0-9a-fA-F]+/g, '<ADDR>'],
  // file position suffixes (:line:col) — must run before the port rule
  [/:\d+:\d+/g, ':<LC>'],
  // ports (host:NNNN)
  [/:\d{2,5}\b/g, ':<PORT>'],
  // durations
  [/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, '<DUR>'],
  // OS temp paths
  [/(?:\/[^\s:'"]*)?\/(?:tmp|temp)\/[^\s:'")]*/gi, '<TMP>'],
]

export function fingerprint(input) {
  let s = String(input == null ? '' : input)
  for (const [re, rep] of NORMALISERS) s = s.replace(re, rep)
  s = s.replace(/\s+/g, ' ').trim()
  return 'fp_' + createHash('sha256').update(s).digest('hex').slice(0, 16)
}

// ─── Failure classification ───────────────────────────────────────────────────
// Environmental breakage (network / DNS / OOM / container) is INFRA; a failure whose
// fingerprint is in the known-flaky (quarantined) set is FLAKE; everything else is a
// REGRESSION. INFRA is checked first because an environment fault is not the test's
// fault regardless of quarantine status. Fail-closed: a malformed failure → REGRESSION.
const INFRA_SIGNALS = [
  /econnrefused/i,
  /etimedout/i,
  /enotfound/i,
  /eai_again/i,
  /econnreset/i,
  /epipe/i,
  /socket hang ?up/i,
  /connection refused/i,
  /could not connect/i,
  /\bnetwork\b/i,
  /\bdns\b/i,
  /\b50[234]\b/, // 502 / 503 / 504
  /no space left/i,
  /out of memory|\boom\b/i,
  /\b(docker|container)\b/i,
]

export function classify(failure, opts = {}) {
  try {
    if (!failure || typeof failure !== 'object') return 'REGRESSION'
    const quarantined =
      opts.quarantined instanceof Set ? opts.quarantined : new Set(opts.quarantined || [])
    const text = [failure.message, failure.name, failure.error, failure.stack]
      .filter(Boolean)
      .join('\n')
    if (INFRA_SIGNALS.some((re) => re.test(text))) return 'INFRA'
    const fp = failure.fingerprint || fingerprint(text)
    if (quarantined.has(fp)) return 'FLAKE'
    return 'REGRESSION'
  } catch {
    return 'REGRESSION'
  }
}

// ─── Retry ladder ─────────────────────────────────────────────────────────────
// `runAttempt(scope)` is injected by the caller (this is what keeps the library
// stack-agnostic): it runs the suite at the given scope and returns
// `{ passed: boolean, failures?: NormalisedFailure[] }`. The ladder escalates
// initial → single-test → spec. Passing on the first attempt is a PASS; passing only
// after a retry is a FLAKE; an all-INFRA failure short-circuits to INFRA (retrying a
// dead environment is pointless); an exhausted ladder is a REGRESSION. A runner that
// throws is fail-closed to REGRESSION — never an implicit pass.
//
// A3 (#1817): `opts.tier === 'smoke'` forces the ladder down to a single ['initial']
// attempt — @smoke tier gets zero retries, full stop. This overrides any caller-supplied
// `opts.scopes`: retries hide races, and the smoke tier exists specifically to catch
// them, so the zero-retry rule is not something a caller can opt out of.
export function retryLadder(runAttempt, opts = {}) {
  const quarantined =
    opts.quarantined instanceof Set ? opts.quarantined : new Set(opts.quarantined || [])
  const ladder =
    opts.tier === 'smoke'
      ? ['initial']
      : Array.isArray(opts.scopes) && opts.scopes.length
        ? opts.scopes
        : ['initial', 'single-test', 'spec']
  const attempts = []
  let residual = []
  for (let i = 0; i < ladder.length; i++) {
    const scope = ladder[i]
    let res
    try {
      res = runAttempt(scope)
    } catch (err) {
      attempts.push({ scope, error: String((err && err.message) || err) })
      return { verdict: 'REGRESSION', attempts }
    }
    const passed = !!(res && res.passed)
    const failures = res && Array.isArray(res.failures) ? res.failures : []
    attempts.push({ scope, passed, failureCount: failures.length })
    if (passed) return { verdict: i === 0 ? 'PASS' : 'FLAKE', attempts }
    residual = failures
    const labels = failures.map((f) => classify(f, { quarantined }))
    if (labels.length && labels.every((l) => l === 'INFRA')) return { verdict: 'INFRA', attempts }
  }
  const labels = residual.map((f) => classify(f, { quarantined }))
  if (labels.length && labels.every((l) => l === 'INFRA')) return { verdict: 'INFRA', attempts }
  if (labels.length && labels.every((l) => l === 'FLAKE')) return { verdict: 'FLAKE', attempts }
  return { verdict: 'REGRESSION', attempts }
}

// ─── Risk tier ────────────────────────────────────────────────────────────────
// R0 clean · R1 known-flaky only · R2 infra present · R3 governance rot (expired
// quarantine) · R4 regression present OR malformed input. Fail-closes to R4.
export function riskTier(summary) {
  try {
    if (!summary || typeof summary !== 'object') return 'R4'
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    if (n(summary.regressions) > 0) return 'R4'
    if (n(summary.expiredQuarantine) > 0) return 'R3'
    if (n(summary.infra) > 0) return 'R2'
    if (n(summary.flakes) > 0) return 'R1'
    return 'R0'
  } catch {
    return 'R4'
  }
}

// ─── Append-only ledger ───────────────────────────────────────────────────────
// One JSON object per line; never rewrites prior lines. The historical record of
// every reliability verdict, for auditing whether re-runs are masking regressions.
export function appendLedger(path, entry) {
  const record = { recorded_at: new Date().toISOString(), ...entry }
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(record) + '\n')
  return record
}

// ─── Quarantine registry contract ─────────────────────────────────────────────
// A quarantine entry annotates a known-unstable test; it does NOT suppress it. Every
// entry must carry the full field set AND a FUTURE `expires` date so a quarantine
// cannot rot into a permanent silent mute. validateQuarantine is the executable schema.
export const QUARANTINE_REQUIRED_FIELDS = [
  'id',
  'fingerprint',
  'reason',
  'owner',
  'added',
  'expires',
  'issue',
]

export function validateQuarantine(registry, now = new Date()) {
  const errors = []
  let entries
  if (Array.isArray(registry)) entries = registry
  else if (registry && Array.isArray(registry.entries)) entries = registry.entries
  else return { ok: false, errors: ['quarantine registry must be an array or { entries: [...] }'] }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  entries.forEach((e, idx) => {
    const label = (e && (e.id || e.fingerprint)) || `entry[${idx}]`
    if (!e || typeof e !== 'object') {
      errors.push(`${label}: not an object`)
      return
    }
    for (const f of QUARANTINE_REQUIRED_FIELDS) {
      if (e[f] === undefined || e[f] === null || e[f] === '') {
        errors.push(`${label}: missing required field '${f}'`)
      }
    }
    if (e.expires !== undefined && e.expires !== null && e.expires !== '') {
      const expMs = new Date(e.expires).getTime()
      if (Number.isNaN(expMs)) errors.push(`${label}: 'expires' is not a valid date (${e.expires})`)
      else if (expMs < nowMs) {
        errors.push(`${label}: quarantine expired on ${String(e.expires)} — re-triage or remove`)
      }
    }
  })
  return { ok: errors.length === 0, errors }
}
