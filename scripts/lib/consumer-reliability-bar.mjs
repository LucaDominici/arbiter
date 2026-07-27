// Pure oracles shared by the private consumer reliability prepare/verifier commands (#2135).
import { createHash } from 'node:crypto'

const RUNNER_CALL = /\b(?:runCheck|runWarnCheck|runToolCheck)\s*\(\s*(['"`])([^'"`]+)\1/g
const CONSUMER_SECRET_PREFIX = `${['ARBITER', 'CONSUMER'].join('_')}_`

export function extractCheckNames(source) {
  return new Set([...source.matchAll(RUNNER_CALL)].map((match) => match[2]).sort())
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function assessGateSpine({ before, after, recordedRenderHash }) {
  const beforeChecks = extractCheckNames(before)
  const afterChecks = extractCheckNames(after)
  if (before.length > 0 && beforeChecks.size === 0) {
    return { ok: false, detail: 'pre-existing gate spine has no parseable check calls' }
  }
  const missing = [...beforeChecks].filter((name) => !afterChecks.has(name)).sort()
  if (missing.length > 0) {
    return { ok: false, detail: `pre-existing checks disappeared: ${missing.join(', ')}` }
  }
  const customized =
    typeof recordedRenderHash === 'string' &&
    recordedRenderHash.length > 0 &&
    recordedRenderHash !== sha256(before)
  if (customized && before !== after) {
    return {
      ok: false,
      detail: 'customized gate spine changed bytes; project-owned wiring was not preserved exactly',
    }
  }
  return {
    ok: true,
    detail: `${beforeChecks.size} pre-existing checks preserved; ${afterChecks.size} after update`,
  }
}

export function classifyHookResult({ exitCode, hardness, applicable, rationale }) {
  if (!applicable) return rationale.trim().length > 0 ? 'NOT-APPLICABLE' : 'INVALID-RATIONALE'
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
  } catch {
    return 'probe failed without a valid report'
  }
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
  const payload = String(stdout)
    .trim()
    .split('\n')
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .find((value) => value !== null)
  const recoverable =
    payload?.command === 'update' &&
    payload?.version === '1' &&
    payload?.status === 'warning' &&
    payload?.errorClass === 'recoverable' &&
    Array.isArray(payload?.warnings) &&
    payload.warnings.length > 0
  return {
    acceptable: recoverable,
    status: recoverable ? 'WARN' : 'FAIL',
    warningCount: recoverable ? payload.warnings.length : 0,
  }
}
