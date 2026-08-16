// Pure oracles shared by the private consumer reliability prepare/verifier commands (#2135).

const RUNNER_CALL = /\b(?:runCheck|runWarnCheck|runToolCheck)\s*\(\s*(['"`])([^'"`]+)\1/g
const CONSUMER_SECRET_PREFIX = `${['ARBITER', 'CONSUMER'].join('_')}_`

export function extractCheckNames(source) {
  return new Set([...source.matchAll(RUNNER_CALL)].map((match) => match[2]).sort())
}

export function assessGateSpine({ before, after, existed }) {
  // AC-2 (#2135) diffs a PRE-EXISTING check set. With no baseline there is nothing to
  // diff, so the non-decreasing property is UNPROVEN on this consumer — not satisfied.
  // Reporting PASS here would assert a check the bar never performed, which is the
  // exact `forma` shape this bar exists to prevent.
  // `existed` is deliberately NOT defaulted: a caller that forgets it must land on the
  // UNPROVEN branch, never silently inherit a passing baseline.
  if (existed !== true) {
    return {
      ok: false,
      detail: `no pre-existing gate spine to diff; update materialized ${extractCheckNames(after).size} checks, so the non-decreasing property is UNPROVEN`,
    }
  }
  const beforeChecks = extractCheckNames(before)
  const afterChecks = extractCheckNames(after)
  if (before.length > 0 && beforeChecks.size === 0) {
    return { ok: false, detail: 'pre-existing gate spine has no parseable check calls' }
  }
  const missing = [...beforeChecks].filter((name) => !afterChecks.has(name)).sort()
  if (missing.length > 0) {
    return { ok: false, detail: `pre-existing checks disappeared: ${missing.join(', ')}` }
  }
  // #2290 §4: the byte-identity branch is GONE on purpose. AC-2's property is a set of
  // check NAMES, not a byte string — a check that disappears is a name, and a reformat is
  // not a regression. Worse, it keyed on `recordedRenderHash === null`, which has three
  // distinct causes (no manifest at all, no entry for this file, file deleted by the
  // consumer) that the old `?? 'unknown-customized-baseline'` fallback collapsed into
  // `customized = true` on every row. Ownership is now read from the manifest by the
  // runner, independently of whether the file is on disk, and reported as an observation.
  return {
    ok: true,
    detail: `${beforeChecks.size} pre-existing checks preserved; ${afterChecks.size} after update`,
  }
}

// ── AC-2 (#2135): emitted-vs-executed reconciliation ─────────────────────────────
//
// `arbiter update` materializes a gate spine of ~100 check names into each consumer.
// Measured at the pins, only 2 of 104 java names equal an executed gate id by string
// equality (`doc-set`, `spotbugs`) — arbiter says `PII scan`, viafera says `pii` — so
// subtraction by string equality proves nothing. The reconciliation runs through a
// committed name->gate mapping instead, and every emitted name must land in exactly one
// of three buckets:
//
//   WIRED:<gate id>    the consumer really runs a gate with that property, under its own
//                      name. The id is checked against the surface measured THIS run, so
//                      a gate leaving the consumer's spine reddens the row.
//   DECLINED:<reason>  the consumer legitimately does not need it. The reason is required
//                      — "out of scope" with no sentence behind it is how a criterion dies.
//   DEBT:#NNNN         a real gap against a real issue, machine-verified OPEN upstream.
//
// The debt register is a RATCHET, not an append-list: its cardinality is pinned to a
// committed integer and enforced in both directions, so a new entry can only enter when
// another leaves resolved. Without that, one free-text `DEBT:#9999` zeroes the criterion.
const MAPPING_VERDICT = /^(WIRED|DECLINED|DEBT):([\s\S]*)$/

export function assessGateSurface({ freshRender, declared, mapping, debtRegister }) {
  const emitted = [...new Set(freshRender)].sort()
  const executed = new Set(declared)
  const entries = mapping ?? {}
  const openIssues = new Set(debtRegister?.openIssues ?? [])
  const problems = []

  const unaccounted = emitted.filter((name) => typeof entries[name] !== 'string')
  if (unaccounted.length > 0) {
    problems.push(`${unaccounted.length} emitted check(s) unaccounted: ${unaccounted.join(', ')}`)
  }
  const stale = Object.keys(entries)
    .filter((name) => !emitted.includes(name))
    .sort()
  if (stale.length > 0) {
    problems.push(
      `${stale.length} stale mapping entr(ies) for names no longer emitted: ${stale.join(', ')}`,
    )
  }

  let debt = 0
  for (const name of emitted) {
    const verdict = entries[name]
    if (typeof verdict !== 'string') continue
    const parsed = MAPPING_VERDICT.exec(verdict)
    if (parsed === null) {
      problems.push(`${name}: unknown mapping verdict ${verdict}`)
      continue
    }
    const [, kind, value] = parsed
    if (kind === 'WIRED' && !executed.has(value)) {
      problems.push(`${name}: mapped to gate ${value}, absent from the executed surface`)
    } else if (kind === 'DECLINED' && value.trim().length === 0) {
      problems.push(`${name}: DECLINED without a written reason`)
    } else if (kind === 'DEBT') {
      debt += 1
      if (!openIssues.has(value)) {
        problems.push(`${name}: debt issue ${value} is not a verified OPEN issue`)
      }
    }
  }

  const ceiling = debtRegister?.ceiling
  if (typeof ceiling !== 'number' || debt !== ceiling) {
    problems.push(
      `debt ratchet: ${debt} debt entr(ies) against a committed ceiling of ${String(ceiling)} — ` +
        'the ceiling must be re-tightened when debt resolves and can never absorb new debt silently',
    )
  }

  if (problems.length > 0) return { ok: false, detail: problems.join('; ') }
  return {
    ok: true,
    detail: `${emitted.length} emitted check(s) reconciled against ${executed.size} executed gate(s); ${debt} carried as tracked debt`,
  }
}

// Acquiring the executed surface is a separate failure domain from judging it. A dry-run
// that exits non-zero, times out, gets signalled, or never prints its gate line has told
// us NOTHING about the consumer — that is an ERROR (exit 2), never a FAIL and never a
// PASS. Mutex contention gets its own wording so a queued run is never mistaken for a
// consumer that stopped running a gate.
export function parseGateSurfaceOutput({ result, pattern, separator, contentionMarker }) {
  const output = `${String(result?.stdout ?? '')}\n${String(result?.stderr ?? '')}`
  const contended =
    typeof contentionMarker === 'string' &&
    contentionMarker.length > 0 &&
    output.includes(contentionMarker)
  const reason = contended
    ? `the run queued on the ${contentionMarker} mutex (contention, not a verdict)`
    : `command exited status=${String(result?.status)} signal=${String(result?.signal)}`
  if (result?.ok !== true) {
    return { ok: false, detail: `executed gate surface could not be obtained: ${reason}` }
  }
  const matcher = new RegExp(pattern, 'm')
  const matched = matcher.exec(output)
  if (matched === null || typeof matched[1] !== 'string') {
    return {
      ok: false,
      detail: `executed gate surface could not be obtained: no line matched ${pattern}${contended ? ` (${reason})` : ''}`,
    }
  }
  const gates = matched[1]
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (gates.length === 0) {
    return { ok: false, detail: 'executed gate surface could not be obtained: gate line was empty' }
  }
  return { ok: true, gates }
}

export function classifyHookResult({ exitCode, signal, hardness, applicable, rationale }) {
  if (!applicable) return rationale.trim().length > 0 ? 'NOT-APPLICABLE' : 'INVALID-RATIONALE'
  if (signal || exitCode === null || exitCode === undefined) return 'PROBE-ERROR'
  if (hardness === 'ADVISORY') {
    return rationale.trim().length > 0 ? 'ADVISORY' : 'INVALID-ADVISORY'
  }
  return exitCode === 2 ? 'BLOCKS' : 'INERT'
}

export function classifyAdvisoryHookResult({ exitCode, signal, rationale }) {
  if (rationale.trim().length === 0) return 'INVALID-ADVISORY'
  if (signal || exitCode === null || exitCode === undefined) return 'PROBE-ERROR'
  if (exitCode === 2) return 'UNEXPECTED-BLOCK'
  return exitCode === 0 ? 'ADVISORY' : 'PROBE-ERROR'
}

export function commandOutcomeKind({ status, signal }) {
  if (!signal && status === 0) return 'pass'
  if (signal || status === null || status === undefined || status === 2) return 'error'
  return 'fail'
}

const VERIFIER_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'CI',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'XDG_CACHE_HOME',
  'npm_config_cache',
  'NO_COLOR',
])

export function buildVerifierEnvironment(environment) {
  const clean = Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) => VERIFIER_ENV_KEYS.has(key) && String(value ?? '').length > 0,
    ),
  )
  return {
    ...clean,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  }
}

export function assertCredentialFreeEnvironment(environment) {
  const leaked = Object.entries(environment)
    .filter(
      ([key, value]) => key.startsWith(CONSUMER_SECRET_PREFIX) && String(value ?? '').length > 0,
    )
    .map(([key]) => key)
  if (leaked.length > 0) {
    throw new Error(`credential-bearing verifier environment: ${leaked.join(', ')}`)
  }
}

export function summarizeProbeFailures(stdout) {
  try {
    const parsed = JSON.parse(String(stdout))
    if (!Array.isArray(parsed?.failures) || parsed.failures.length === 0) return 'probe failed'
    return parsed.failures
      .slice(0, 8)
      .map(
        (row) =>
          `${String(row?.hook ?? 'unknown')}@${String(row?.state ?? 'unknown')}:${String(row?.verdict ?? 'unknown')}`,
      )
      .join(', ')
    // FAIL-OPEN-INTENT: malformed probe output becomes an explicit failed diagnostic, never PASS.
  } catch {
    return 'probe failed without a valid report'
  }
}

export function summarizeRoutingFailures(stderr) {
  const findings = String(stderr)
    .split('\n')
    .map((line) => /^\[hook-routing\] ([A-Z]+(?: [A-Za-z0-9_.:|/-]+)+)$/.exec(line)?.[1])
    .filter(Boolean)
    .slice(0, 8)
  return findings.length > 0 ? findings.join(', ') : 'hook routing failed'
}

export function redactSecrets(value, secrets) {
  let redacted = String(value).replace(/https?:\/\/[^\s'"]+/g, '[REDACTED_URL]')
  for (const secret of [...secrets]
    .filter((item) => item.length > 0)
    .sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

export function resultExitCode(results) {
  if (results.some((result) => result.kind === 'error')) return 2
  if (results.some((result) => result.kind === 'fail')) return 1
  return 0
}

export function classifyUpdateResult({ status, signal, stdout }) {
  if (status === 0 && !signal) return { acceptable: true, status: 'PASS', warningCount: 0 }
  if (status !== 1 || signal) {
    return { acceptable: false, status: 'FAIL', warningCount: 0 }
  }
  const payload = lastJsonLine(stdout)
  const recoverable = isRecoverableUpdate(payload)
  return {
    acceptable: recoverable,
    status: recoverable ? 'WARN' : 'FAIL',
    warningCount: recoverable ? payload.warnings.length : 0,
  }
}

function lastJsonLine(stdout) {
  return String(stdout)
    .trim()
    .split('\n')
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line)
        // FAIL-OPEN-INTENT: non-JSON stdout lines are skipped while locating the update payload.
      } catch {
        return null
      }
    })
    .find((value) => value !== null)
}

function isRecoverableUpdate(payload) {
  return hasRecoverableUpdateMetadata(payload) && hasRecoverableWarnings(payload)
}

function hasRecoverableUpdateMetadata(payload) {
  return (
    payload?.command === 'update' &&
    payload?.version === '1' &&
    payload?.status === 'warning' &&
    payload?.errorClass === 'recoverable'
  )
}

function hasRecoverableWarnings(payload) {
  return Array.isArray(payload?.warnings) && payload.warnings.length > 0
}
