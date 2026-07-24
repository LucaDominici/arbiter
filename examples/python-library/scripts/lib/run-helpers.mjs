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

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
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
export function resetState() { results = []; failed = 0; }

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
  const start = Date.now();
  process.stdout.write(`[CHECK] ${name} ... `);
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    shell: false,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  return { r, elapsed: Date.now() - start };
}

function emitOutput(r) {
  const noColor = NO_COLOR();
  if (r.stdout) process.stdout.write(noColor ? stripAnsi(r.stdout) : r.stdout);
  if (r.stderr) process.stderr.write(noColor ? stripAnsi(r.stderr) : r.stderr);
}

function recordFail(name, elapsed, msg) {
  console.log(`FAIL (${msg}, ${elapsed}ms)`);
  if (IS_CI()) console.log(`::error::${name}::${msg}`);
  results.push({ name, status: 'FAIL', elapsed });
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
    recordFail(name, elapsed, `timeout after ${elapsed}ms`);
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
    recordFail(name, elapsed, `timeout after ${elapsed}ms`);
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
