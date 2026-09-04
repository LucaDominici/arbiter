// Gate runner trinity (#351, CANON-01) — runCheck / runWarnCheck / runToolCheck
//
// Three semantics for gate steps invoked by scripts/check-all.mjs and the
// generated check-all.mjs template:
//
//   runCheck      HARD — non-zero exit fails the gate (the default).
//                 Accepts { soft: true } to coerce a single call to WARN
//                 (used by template grace-period: { soft: graceActive }).
//                 A child that exits 0 but prints a `[SKIP] <reason>` line
//                 (#2052: self-skip, e.g. "nothing to check for this repo")
//                 is recorded SKIP, not PASS — still non-blocking, but no
//                 longer indistinguishable from a check that actually ran.
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
import { availableParallelism } from 'node:os'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * True when `importMetaUrl` names the module Node was actually invoked with — the ESM
 * equivalent of CommonJS `require.main === module`. Pass `import.meta.url`:
 *
 *   if (isMainModule(import.meta.url)) main()
 *
 * Null-safe (argv[1] is absent under `node --eval`) and path-normalized, so a relative
 * or non-canonical argv[1] still matches (#2010).
 */
export function isMainModule(importMetaUrl) {
  const entry = process.argv[1]
  if (!entry) return false
  return resolvePath(entry) === fileURLToPath(importMetaUrl)
}

/**
 * True when `pid` still exists. EPERM means it exists but belongs to another
 * user, which is still ALIVE — reading it as dead is what would make the orphan
 * guard below abort a healthy gate.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
    // FAIL-OPEN-INTENT: EPERM is a LIVE process we may not signal; every other
    // errno (ESRCH) is genuinely gone.
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

// ── Orphan guard (#2427, AC-3) ───────────────────────────────────────────────
//
// A `git push` was killed while its pre-push L2 ran; the gate was reparented and
// kept going for another twenty minutes against a tree that had since moved on,
// then stamped a green marker for it. Signal delivery cannot be relied on here —
// a SIGKILL aimed at one pid is untrappable and never reaches the gate at all —
// so the gate watches, from the inside, the process it was launched to serve.
//
// Opt-in: nothing changes for the many other scripts that import this module.
// `scripts/check-all.mjs` arms it; `gate-mutex.mjs` publishes the pid to watch
// through ARBITER_GATE_PARENT_PID so an intermediate `flock` cannot mask the
// death of the real parent.
/** @type {number|null} */
let watchedPid = null

/**
 * Arm the orphan guard. With no argument it watches ARBITER_GATE_PARENT_PID when
 * set (the process that started the gate), else this process's own parent.
 *
 * @param {number} [pid]
 */
export function setOrphanGuard(pid) {
  if (Number.isInteger(pid) && pid > 0) {
    watchedPid = pid
    return
  }
  const declared = Number(process.env.ARBITER_GATE_PARENT_PID)
  watchedPid = Number.isInteger(declared) && declared > 0 ? declared : process.ppid
}

/**
 * Checked before EVERY spawn: the cheapest boundary at which an orphaned gate
 * can stop without leaving a half-run check behind. Exits 2 (ERROR, per the
 * project-wide 0=PASS / 1=FAIL / 2=ERROR / 78=CONFIG contract) and loudly — this
 * is an aborted run, not a failed check, and an orphan that ran to completion
 * would go on to stamp a marker.
 */
function assertNotOrphaned() {
  if (watchedPid === null || isProcessAlive(watchedPid)) return
  process.stderr.write(
    `\n[ORPHANED] the process this gate was launched to serve (pid ${watchedPid}) is gone — ` +
      'aborting before the next check. A gate that outlives its parent measures a tree ' +
      'nobody is waiting on, and must never stamp evidence for it (#2427).\n',
  )
  process.exit(2)
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const REFERENCE_CORES = 24

/**
 * Preserve the measured 10-minute budget of the 24-core reference runner while
 * giving slower machines the same core-seconds. More cores never shrink the
 * hang ceiling below the measured reference budget (#2370).
 */
export function scaledTimeoutMs(cores = availableParallelism()) {
  const effectiveCores = Math.max(1, Math.min(REFERENCE_CORES, cores))
  return Math.ceil((DEFAULT_TIMEOUT_MS * REFERENCE_CORES) / effectiveCores)
}
// Explicit spawnSync output ceiling. Node's default is 1 MB; verbose checks
// (the integration suite's render/init tree dumps) exceed it, and an overflow
// silently kills the child (status=null) — surfacing as the misleading
// "exit null". A generous explicit ceiling + ENOBUFS-as-FAIL makes the gate
// behave identically locally and in CI. 50 MB matches scripts/dogfood-local.mjs.
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024

const IS_CI = () => process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
const NO_COLOR = () => IS_CI() || process.env.NO_COLOR === '1'

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return (str ?? '').replace(/\x1b\[[0-9;]*m/g, '')
}

// Self-skip marker (#2052): a check that decides for itself — via config,
// archetype, or missing input — that it has nothing to verify prints a
// `[SKIP] <reason>` line to its own stdout and still exits 0 (INV-53: 0
// stays PASS-or-SKIP for direct invocation). Anchored to the start of a
// line so it can't collide with an incidental "SKIP" substring inside a
// genuinely-passing check's own output (e.g. an env var name or a per-item
// note elsewhere in the log).
const SELF_SKIP_RE = /^\[SKIP\][ \t]*(.*)$/m

function detectSelfSkip(stdout) {
  const m = SELF_SKIP_RE.exec(stdout ?? '')
  if (!m) return null
  return m[1].trim() || 'self-skip'
}

/** @type {{ name: string; status: 'PASS'|'FAIL'|'TIMEOUT'|'WARN'|'SKIP'; elapsed: number }[]} */
let results = []
let failed = 0

// Opt-in selective gating (#2094): a name-based skip set computed by
// computeSkipped() in check-all.mjs and installed via setSkippedChecks()
// before any runCheck/runWarnCheck/runToolCheck call. Empty by default —
// every check runs unless a caller explicitly opts in. This is a LOCAL
// iteration speed tool only; it never gates a real push or merge (see #2094
// issue body — the full, unfiltered gate remains the only merge authority).
let skippedChecks = new Set()

export function setSkippedChecks(names) {
  skippedChecks = names instanceof Set ? names : new Set(names)
}

export function getResults() {
  return results
}

export function getFailed() {
  return failed
}

export function resetState() {
  results = []
  failed = 0
  skippedChecks = new Set()
  watchedPid = null
}

/**
 * Internal: run cmd and classify the outcome. Returns the spawnSync result and elapsed ms.
 */
function spawn(name, cmd, args, opts) {
  assertNotOrphaned()
  const start = Date.now()
  process.stdout.write(`[CHECK] ${name} ... `)
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    shell: false,
    timeout: opts.timeoutMs ?? scaledTimeoutMs(),
    maxBuffer: opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  })
  return { r, elapsed: Date.now() - start }
}

// #2032: the dump of a failed check is truncated by whatever reads it (GitHub caps a
// step's log), and what gets dropped is the END — where a test runner prints the actual
// failure. Across four episodes of #2027 the vitest error line was unrecoverable from CI
// and only a local run exposed it. So dump the TAIL, not the head.
const DUMP_TAIL_LINES = 400

function tail(str) {
  const lines = str.split('\n')
  if (lines.length <= DUMP_TAIL_LINES) return str
  return (
    `[... ${lines.length - DUMP_TAIL_LINES} earlier line(s) truncated — ` +
    `showing the last ${DUMP_TAIL_LINES}, where the failure is]\n` +
    lines.slice(-DUMP_TAIL_LINES).join('\n')
  )
}

function emitOutput(r) {
  const noColor = NO_COLOR()
  if (r.stdout) process.stdout.write(tail(noColor ? stripAnsi(r.stdout) : r.stdout))
  if (r.stderr) process.stderr.write(tail(noColor ? stripAnsi(r.stderr) : r.stderr))
}

function recordFail(name, elapsed, msg) {
  process.stdout.write(`FAIL (${msg}, ${elapsed}ms)
`)
  if (IS_CI()) process.stdout.write(`::error::${name}::${msg}\n`)
  results.push({ name, status: 'FAIL', elapsed })
  failed++
}

function recordTimeout(name, elapsed) {
  process.stdout.write(`TIMEOUT (after ${elapsed}ms)
`)
  if (IS_CI()) process.stdout.write(`::error::${name}::timeout after ${elapsed}ms\n`)
  results.push({ name, status: 'TIMEOUT', elapsed })
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
 * True (and recorded) when `name` is in the selective-gate skip set — callers
 * must return immediately without spawning. Split out of the runCheck trinity
 * to keep each runner's own complexity under the ratchet (#2094).
 */
function skipIfSelected(name) {
  if (!skippedChecks.has(name)) return false
  recordSkip(name, 0, 'selective gate: no affected files changed')
  return true
}

/**
 * Classifies a spawn-level error (missing binary / timeout / buffer overflow)
 * into the identical detail message all three runners use. Returns null when
 * `r` completed without a spawn-level error (status may still be non-zero).
 * ENOENT handling is NOT unconditional here — runToolCheck's CI-aware branch
 * checks `r.error?.code === 'ENOENT'` itself, before this ever runs, so by the
 * time it's called ENOENT (for that runner) is already handled.
 */
function classifySpawnError(r, cmd, elapsed, opts) {
  if (!r.error) return null
  if (r.error.code === 'ENOENT') return { detail: `command not found: ${cmd}` }
  if (r.error.code === 'ETIMEDOUT') return { detail: `timeout after ${elapsed}ms` }
  if (r.error.code === 'ENOBUFS') {
    const limit = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    return { detail: `output exceeded buffer (limit ${limit} bytes)` }
  }
  return null
}

/**
 * HARD gate step. Non-zero exit fails the gate (failed++).
 */
export function runCheck(name, cmd, args, opts = {}) {
  if (skipIfSelected(name)) return
  const { r, elapsed } = spawn(name, cmd, args, opts)

  const spawnErr = classifySpawnError(r, cmd, elapsed, opts)
  if (spawnErr) {
    if (r.error?.code === 'ETIMEDOUT') recordTimeout(name, elapsed)
    else recordFail(name, elapsed, spawnErr.detail)
    return
  }
  if (r.status === 0) {
    const selfSkip = detectSelfSkip(r.stdout)
    if (selfSkip) {
      recordSkip(name, elapsed, selfSkip)
      return
    }
    recordPass(name, elapsed)
    return
  }
  if (opts.soft) {
    recordWarn(name, elapsed, `grace period, exit ${r.status}`)
    emitOutput(r)
    return
  }
  recordFail(name, elapsed, `exit ${r.status}`)
  emitOutput(r)
}

/**
 * INFORMATIONAL gate step. Non-zero exit records WARN, never fails the gate.
 */
export function runWarnCheck(name, cmd, args, opts = {}) {
  if (skipIfSelected(name)) return
  const { r, elapsed } = spawn(name, cmd, args, opts)

  const spawnErr = classifySpawnError(r, cmd, elapsed, opts)
  if (spawnErr) {
    recordWarn(name, elapsed, spawnErr.detail)
    return
  }
  if (r.status === 0) {
    recordPass(name, elapsed)
    return
  }
  recordWarn(name, elapsed, `exit ${r.status}`)
  emitOutput(r)
}

/**
 * CI-AWARE TOOL gate step. Missing binary => SKIP locally, FAIL in CI.
 */
export function runToolCheck(name, cmd, args, opts = {}) {
  if (skipIfSelected(name)) return
  const { r, elapsed } = spawn(name, cmd, args, opts)

  if (r.error?.code === 'ENOENT') {
    if (IS_CI()) {
      recordFail(name, elapsed, `tool not installed in CI: ${cmd}`)
    } else {
      recordSkip(name, elapsed, `tool not installed locally: ${cmd}`)
    }
    return
  }
  const spawnErr = classifySpawnError(r, cmd, elapsed, opts)
  if (spawnErr) {
    if (r.error?.code === 'ETIMEDOUT') recordTimeout(name, elapsed)
    else recordFail(name, elapsed, spawnErr.detail)
    return
  }
  if (r.status === 0) {
    recordPass(name, elapsed)
    return
  }
  recordFail(name, elapsed, `exit ${r.status}`)
  emitOutput(r)
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
