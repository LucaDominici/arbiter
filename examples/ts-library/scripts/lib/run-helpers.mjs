// Gate runner trinity (#351, CANON-01) — runCheck / runWarnCheck / runToolCheck
//
// Three semantics for gate steps in scripts/check-all.mjs:
//   runCheck      HARD — non-zero exit fails the gate.
//                 { soft: true } coerces a single call to WARN
//                 (used for grace-period: { soft: graceActive }).
//   runWarnCheck  INFORMATIONAL — non-zero never fails the gate.
//                 Use ONLY for checks NOT backed by an INV-NN.
//   runToolCheck  CI-AWARE — missing binary: SKIP locally, FAIL in CI.
//
// Imported by scripts/check-all.mjs. Plain ESM (.mjs).
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when `importMetaUrl` names the module Node was actually invoked with — the ESM
 * equivalent of CommonJS `require.main === module`. Pass `import.meta.url`:
 *
 *   if (isMainModule(import.meta.url)) main();
 *
 * Null-safe (argv[1] is absent under `node --eval`) and path-normalized, so a relative
 * or non-canonical argv[1] still matches (#2010).
 */
export function isMainModule(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolvePath(entry) === fileURLToPath(importMetaUrl);
}

// resolveTmpfsTmpdir returns a RAM-backed dir to use as TMPDIR, or null.
//
// Test suites that rebuild a database fixture per test (migrations replayed one
// transaction at a time) are fsync-bound, not CPU-bound, on a disk-backed /tmp.
// Measured on a governed Go/SQLite project: the same `-count=1` coverage run over
// the gate's package list took 210s at 21% CPU on disk vs 33.7s at 101% CPU on
// tmpfs, at identical user CPU.
//
// The check is FREE SPACE, not existence. /dev/shm exists in every Linux container
// but defaults to 64 MB there, and TMPDIR relocates more than a test's own temp
// files: with GOTMPDIR unset, Go's build work dirs and every test binary land there
// too, and CI commonly runs this gate inside a container. Too small means ENOSPC
// wearing a linker error's clothes, green locally.
//
// ponytail: fixed floor rather than a measured high-water mark — raise it if a gate
// step starts staging multi-GB fixtures under TMPDIR.
export function resolveTmpfsTmpdir({
  path = '/dev/shm',
  minFreeBytes = 4 * 1024 ** 3,
  statfs = statfsSync,
} = {}) {
  try {
    const { bavail, bsize } = statfs(path);
    return bavail * bsize >= minFreeBytes ? path : null;
  } catch {
    return null; // absent, unmounted, or non-Linux — keep the platform default
  }
}

// Emission-time provenance lets the gate distinguish an optional guard that was
// never delivered from a delivered guard that was later deleted. Cache by target
// directory: a normal gate run has one cwd and therefore reads this manifest once.
// A missing, malformed, or wrong-shape manifest deliberately degrades rather than
// throwing: without a trustworthy record, the caller cannot make that distinction.
const gateManifestCache = new Map();

function gateManifestFiles(cwd) {
  if (gateManifestCache.has(cwd)) return gateManifestCache.get(cwd);
  let files = null;
  try {
    const manifestPath = join(cwd, '.arbiter-generated-manifest.json');
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.files === 'object' &&
        parsed.files !== null &&
        !Array.isArray(parsed.files)
      ) {
        files = parsed.files;
      }
    }
  } catch {
    files = null;
  }
  gateManifestCache.set(cwd, files);
  return files;
}

/**
 * Classify a gate artifact using its exact target-relative manifest key.
 *
 * `deleted` is deliberately reserved for a missing path explicitly recorded in
 * `.arbiter-generated-manifest.json#files`; no filesystem convention is inferred.
 */
export function gateFileState(path, cwd = process.cwd()) {
  if (existsSync(join(cwd, path))) return 'present';
  const files = gateManifestFiles(cwd);
  if (files === null) return 'unknown-no-manifest';
  return Object.prototype.hasOwnProperty.call(files, path) ? 'deleted' : 'never-emitted';
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

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const REFERENCE_CORES = 24;

// Preserve the measured 10-minute budget of the 24-core reference runner while
// giving slower machines the same core-seconds. More cores never shrink the
// hang ceiling below the measured reference budget (#2370).
export function scaledTimeoutMs(cores = availableParallelism()) {
  const effectiveCores = Math.max(1, Math.min(REFERENCE_CORES, cores));
  return Math.ceil((DEFAULT_TIMEOUT_MS * REFERENCE_CORES) / effectiveCores);
}
// Explicit spawnSync output ceiling. Node's default is 1 MB; verbose checks can
// exceed it, and an overflow silently kills the child (status=null), surfacing
// as a misleading "exit null". An explicit ceiling + ENOBUFS-as-FAIL keeps the
// gate behaving identically locally and in CI.
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

const IS_CI = () => process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const NO_COLOR = () => IS_CI() || process.env.NO_COLOR === '1';

function stripAnsi(str) {
  return (str ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}

// Self-skip marker (#2052): a child that exits 0 but prints a `[SKIP] <reason>`
// line decided for itself it had nothing to check — record SKIP, not PASS.
const SELF_SKIP_RE = /^\[SKIP\][ \t]*(.*)$/m;

function detectSelfSkip(stdout) {
  const m = SELF_SKIP_RE.exec(stdout ?? '');
  if (!m) return null;
  return m[1].trim() || 'self-skip';
}

let results = [];
let failed = 0;

export function getResults() { return results; }
export function getFailed() { return failed; }
export function resetState() { results = []; failed = 0; watchedPid = null; }

// #2078 (GATE-1 of #2041) — inspection modes for the agentic loop.
//   dryRun: print what each check WOULD run and spawn nothing (records SKIP).
//   only:   run only the check whose name === only; skip (unrecorded) the rest.
// Set once by check-all.mjs after arg-parsing; the default is a no-op so normal
// runs are unaffected.
let mode = { dryRun: false, only: null };
export function setMode(m = {}) {
  mode = { dryRun: Boolean(m.dryRun), only: m.only ?? null };
}

// Shared pre-flight for the runCheck/runWarnCheck/runToolCheck trio. Returns true
// when the caller must return WITHOUT spawning (skipped by --gate, or dry-run printed).
function inspectSkip(name, cmd, args) {
  if (mode.only !== null && name !== mode.only) return true; // --gate <name>: skip non-match (unrecorded)
  if (mode.dryRun) {
    console.log(`[CHECK] ${name} ... DRY-RUN (would run: ${cmd} ${args.join(' ')})`);
    results.push({ name, status: 'SKIP', elapsed: 0 });
    return true;
  }
  return false;
}

function spawn(name, cmd, args, opts) {
  assertNotOrphaned();
  const start = Date.now();
  process.stdout.write(`[CHECK] ${name} ... `);
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    shell: false,
    timeout: opts.timeoutMs ?? scaledTimeoutMs(),
    maxBuffer: opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  return { r, elapsed: Date.now() - start };
}

// #2032: the dump of a failed check is truncated by whatever reads it (GitHub caps a
// step's log), and what gets dropped is the END — where a test runner prints the actual
// failure. So dump the TAIL, not the head.
const DUMP_TAIL_LINES = 400;

function tail(str) {
  const lines = str.split('\n');
  if (lines.length <= DUMP_TAIL_LINES) return str;
  return (
    `[... ${lines.length - DUMP_TAIL_LINES} earlier line(s) truncated — ` +
    `showing the last ${DUMP_TAIL_LINES}, where the failure is]\n` +
    lines.slice(-DUMP_TAIL_LINES).join('\n')
  );
}

function emitOutput(r) {
  const noColor = NO_COLOR();
  if (r.stdout) process.stdout.write(tail(noColor ? stripAnsi(r.stdout) : r.stdout));
  if (r.stderr) process.stderr.write(tail(noColor ? stripAnsi(r.stderr) : r.stderr));
}

function recordFail(name, elapsed, msg) {
  console.log(`FAIL (${msg}, ${elapsed}ms)`);
  if (IS_CI()) console.log(`::error::${name}::${msg}`);
  results.push({ name, status: 'FAIL', elapsed });
  failed++;
}

function recordTimeout(name, elapsed) {
  console.log(`TIMEOUT (after ${elapsed}ms)`);
  if (IS_CI()) console.log(`::error::${name}::timeout after ${elapsed}ms`);
  results.push({ name, status: 'TIMEOUT', elapsed });
  failed++;
}

function recordWarn(name, elapsed, msg) {
  console.log(`WARN (${msg}, ${elapsed}ms)`);
  results.push({ name, status: 'WARN', elapsed });
}

function recordSkip(name, elapsed, msg) {
  console.log(`SKIP (${msg}, ${elapsed}ms)`);
  results.push({ name, status: 'SKIP', elapsed });
}

function recordPass(name, elapsed) {
  console.log(`PASS (${elapsed}ms)`);
  results.push({ name, status: 'PASS', elapsed });
}

export function runCheck(name, cmd, args, opts = {}) {
  if (inspectSkip(name, cmd, args)) return;
  const { r, elapsed } = spawn(name, cmd, args, opts);
  if (r.error && r.error.code === 'ENOENT') {
    recordFail(name, elapsed, `command not found: ${cmd}`);
    return;
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    recordTimeout(name, elapsed);
    return;
  }
  if (r.error && r.error.code === 'ENOBUFS') {
    const limit = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    recordFail(name, elapsed, `output exceeded buffer (limit ${limit} bytes)`);
    return;
  }
  if (r.status === 0) {
    const selfSkip = detectSelfSkip(r.stdout);
    if (selfSkip) { recordSkip(name, elapsed, selfSkip); return; }
    recordPass(name, elapsed);
    return;
  }
  if (opts.soft) {
    recordWarn(name, elapsed, `grace period, exit ${r.status}`);
    emitOutput(r);
    return;
  }
  recordFail(name, elapsed, `exit ${r.status}`);
  emitOutput(r);
}

export function runWarnCheck(name, cmd, args, opts = {}) {
  if (inspectSkip(name, cmd, args)) return;
  const { r, elapsed } = spawn(name, cmd, args, opts);
  if (r.error && r.error.code === 'ENOENT') {
    recordWarn(name, elapsed, `command not found: ${cmd}`);
    return;
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    recordWarn(name, elapsed, `timeout after ${elapsed}ms`);
    return;
  }
  if (r.error && r.error.code === 'ENOBUFS') {
    const limit = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    recordWarn(name, elapsed, `output exceeded buffer (limit ${limit} bytes)`);
    return;
  }
  if (r.status === 0) { recordPass(name, elapsed); return; }
  recordWarn(name, elapsed, `exit ${r.status}`);
  emitOutput(r);
}

export function runToolCheck(name, cmd, args, opts = {}) {
  if (inspectSkip(name, cmd, args)) return;
  const { r, elapsed } = spawn(name, cmd, args, opts);
  if (r.error && r.error.code === 'ENOENT') {
    if (IS_CI()) {
      recordFail(name, elapsed, `tool not installed in CI: ${cmd}`);
    } else {
      recordSkip(name, elapsed, `tool not installed locally: ${cmd}`);
    }
    return;
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    recordTimeout(name, elapsed);
    return;
  }
  if (r.error && r.error.code === 'ENOBUFS') {
    const limit = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    recordFail(name, elapsed, `output exceeded buffer (limit ${limit} bytes)`);
    return;
  }
  if (r.status === 0) { recordPass(name, elapsed); return; }
  recordFail(name, elapsed, `exit ${r.status}`);
  emitOutput(r);
}

/**
 * Record an externally-classified result. Status 'FAIL' increments failed.
 */
export function pushResult(name, status, elapsed) {
  results.push({ name, status, elapsed });
  if (status === 'FAIL') failed++;
}
