// Gate runner trinity (#351, CANON-01) — runCheck / runWarnCheck / runToolCheck
//
// Three semantics for gate steps invoked by scripts/check-all.mjs and the
// generated check-all.mjs template:
//
//   runCheck      HARD — non-zero exit fails the gate (the default).
//                 Accepts { soft: true } to coerce a single call to WARN
//                 (used by template grace-period: { soft: graceActive }).
//
//   runWarnCheck  INFORMATIONAL — non-zero never fails the gate.
//                 Allowed ONLY when no INV-NN backs the check. Surfaced as
//                 WARN in the summary table. INV-backed checks MUST use
//                 runCheck (audited by check-inv-enforcement-wired.mjs).
//
//   runToolCheck  CI-AWARE TOOL GATE — if the binary is missing:
//                 - locally (CI unset): SKIP (yellow), gate continues
//                 - in CI (process.env.CI === 'true' or GITHUB_ACTIONS): FAIL
//                 Otherwise behaves like runCheck.
//
// State is module-local: results[], failed counter. Read via getResults() /
// getFailed(); reset (for tests) via resetState().
//
// Plain ESM (.mjs). Imported from .mjs gate scripts that run pre-build and
// cannot pull from src/. Direct spawnSync use is the documented exception
// to INV-12 for the gate runner itself (see scripts/check-all.mjs header).
import { spawnSync } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

const IS_CI = () => process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
const NO_COLOR = () => IS_CI() || process.env.NO_COLOR === '1'

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return (str ?? '').replace(/\x1b\[[0-9;]*m/g, '')
}

/** @type {{ name: string; status: 'PASS'|'FAIL'|'WARN'|'SKIP'; elapsed: number }[]} */
let results = []
let failed = 0

export function getResults() {
  return results
}

export function getFailed() {
  return failed
}

export function resetState() {
  results = []
  failed = 0
}

/**
 * Internal: run cmd and classify the outcome. Returns the spawnSync result and elapsed ms.
 */
function spawn(name, cmd, args, opts) {
  const start = Date.now()
  process.stdout.write(`[CHECK] ${name} ... `)
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    shell: false,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  })
  return { r, elapsed: Date.now() - start }
}

function emitOutput(r) {
  const noColor = NO_COLOR()
  if (r.stdout) process.stdout.write(noColor ? stripAnsi(r.stdout) : r.stdout)
  if (r.stderr) process.stderr.write(noColor ? stripAnsi(r.stderr) : r.stderr)
}

function recordFail(name, elapsed, msg) {
  process.stdout.write(`FAIL (${msg}, ${elapsed}ms)
`)
  if (IS_CI()) process.stdout.write(`::error::${name}::${msg}\n`)
  results.push({ name, status: 'FAIL', elapsed })
  failed++
}

function recordWarn(name, elapsed, msg) {
  process.stdout.write(`WARN (${msg}, ${elapsed}ms)
`)
  results.push({ name, status: 'WARN', elapsed })
}

function recordSkip(name, elapsed, msg) {
  process.stdout.write(`SKIP (${msg}, ${elapsed}ms)
`)
  results.push({ name, status: 'SKIP', elapsed })
}

function recordPass(name, elapsed) {
  process.stdout.write(`PASS (${elapsed}ms)
`)
  results.push({ name, status: 'PASS', elapsed })
}

/**
 * HARD gate step. Non-zero exit fails the gate (failed++).
 */
export function runCheck(name, cmd, args, opts = {}) {
  const { r, elapsed } = spawn(name, cmd, args, opts)

  if (r.error && r.error.code === 'ENOENT') {
    recordFail(name, elapsed, `command not found: ${cmd}`)
    return
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    recordFail(name, elapsed, `timeout after ${elapsed}ms`)
    return
  }
  if (r.status === 0) {
    recordPass(name, elapsed)
    return
  }
  if (opts.soft) {
    emitOutput(r)
    recordWarn(name, elapsed, `grace period, exit ${r.status}`)
    return
  }
  emitOutput(r)
  recordFail(name, elapsed, `exit ${r.status}`)
}

/**
 * INFORMATIONAL gate step. Non-zero exit records WARN, never fails the gate.
 */
export function runWarnCheck(name, cmd, args, opts = {}) {
  const { r, elapsed } = spawn(name, cmd, args, opts)

  if (r.error && r.error.code === 'ENOENT') {
    recordWarn(name, elapsed, `command not found: ${cmd}`)
    return
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    recordWarn(name, elapsed, `timeout after ${elapsed}ms`)
    return
  }
  if (r.status === 0) {
    recordPass(name, elapsed)
    return
  }
  emitOutput(r)
  recordWarn(name, elapsed, `exit ${r.status}`)
}

/**
 * CI-AWARE TOOL gate step. Missing binary => SKIP locally, FAIL in CI.
 */
export function runToolCheck(name, cmd, args, opts = {}) {
  const { r, elapsed } = spawn(name, cmd, args, opts)

  if (r.error && r.error.code === 'ENOENT') {
    if (IS_CI()) {
      recordFail(name, elapsed, `tool not installed in CI: ${cmd}`)
    } else {
      recordSkip(name, elapsed, `tool not installed locally: ${cmd}`)
    }
    return
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    recordFail(name, elapsed, `timeout after ${elapsed}ms`)
    return
  }
  if (r.status === 0) {
    recordPass(name, elapsed)
    return
  }
  emitOutput(r)
  recordFail(name, elapsed, `exit ${r.status}`)
}

/**
 * Record an externally-classified result in the helper's bookkeeping. Used by
 * gate scripts that compute status via custom logic (inline grep/parse blocks)
 * and need their result rolled into the same results[]/failed accounting that
 * the runCheck trinity feeds.
 *
 * Status 'FAIL' increments failed; 'PASS' | 'WARN' | 'SKIP' do not.
 *
 * @param {string} name
 * @param {'PASS'|'FAIL'|'WARN'|'SKIP'} status
 * @param {number} elapsed
 */
export function pushResult(name, status, elapsed) {
  results.push({ name, status, elapsed })
  if (status === 'FAIL') failed++
}
