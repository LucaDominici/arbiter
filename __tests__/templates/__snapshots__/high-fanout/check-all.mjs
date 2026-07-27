#!/usr/bin/env node
// test-project quality gate
// Usage: node scripts/check-all.mjs [L1|L2] [--json [path]]
// L1: format + lint + unit tests (fast, pre-commit)
// L2: L1 + coverage + audit (full, pre-push)
// --json [path]: emit gate result JSON (schema arbiter-gate-v1) to path
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
// Helper trinity (#351, CANON-01) — runCheck (HARD), runWarnCheck (info),
// runToolCheck (CI-aware tool gate). pushResult/getResults/getFailed power the
// inline ad-hoc gates that classify status outside of spawnSync.
import {
  runCheck,
  runWarnCheck,
  runToolCheck,
  pushResult,
  getResults,
  getFailed,
  setMode,
  resolveTmpfsTmpdir,
} from './lib/run-helpers.mjs';

// ─── TMPDIR on tmpfs (dominant wall-clock lever for fsync-bound suites) ──────
// Set BEFORE any child spawns so every one of them inherits it; see
// resolveTmpfsTmpdir for the measurement and why the guard is free space, not
// existence. An explicit TMPDIR always wins — note it also partitions Go's test
// cache (TMPDIR is hashed into the test-input ID), so anyone running tests by
// hand should export the same value the gate picks or they warm a second,
// separate cache.
if (!process.env.TMPDIR) {
  const _tmpfs = resolveTmpfsTmpdir();
  if (_tmpfs) process.env.TMPDIR = _tmpfs;
}

// #1319.8 — greenfield-aware coverage decision (PASS on 0 executable statements;
// enforce threshold otherwise; FAIL on missing/malformed summary).
import { evaluateCoverageGate } from './lib/coverage-gate.mjs';


const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// >>> ARG-PARSE-START (#1504) — robust, fail-loud gate-arg parsing.
// Accept EVERY invocation form arbiter emits: the positional level
// (`check-all.mjs L2`), the subcommand aliases the Makefile + git hooks use
// (`check`/`gate`/`full`/`simulate-nightly`/`simulate-weekly`), the flag form
// (`--level L2` / `--level=L2`), and `--json [path]` — in any order. Plus the
// #2078 inspection flags: `--dry-run` (print which checks WOULD run at this level,
// spawn nothing) and `--gate <name>` (re-run one check by its display name).
// A garbage or missing level FAILS LOUD (exit 2). It must NEVER silently degrade
// to a weaker level than asked: a positional parser that reads the literal
// `--level` as the level string skips the L2 branch while the job stays green —
// that silent L2→L1 downgrade is the exact fake-green this gate exists to kill.
const _LEVELS = ['L1', 'L2', 'L3', 'L4'];
// Subcommand alias → level. `check` is the fast pre-commit lane; everything
// heavier maps to L2 (the strongest tier this generated gate implements).
const _SUBCOMMAND_LEVEL = {
  check: 'L1',
  gate: 'L2',
  full: 'L2',
  'simulate-nightly': 'L2',
  'simulate-weekly': 'L2',
};
let level = 'L2';
let jsonPath = null;
let dryRun = false; // #2078: print-what-would-run, spawn nothing
let only = null; // #2078: --gate <name>, re-run a single check
const _rawArgs = process.argv.slice(2);
const _gateUsage =
  'Usage: node scripts/check-all.mjs [L1|L2|L3|L4 | check|gate|full|simulate-nightly|simulate-weekly] [--level <L1|L2|L3|L4>] [--json [path]] [--dry-run] [--gate <name>]';
function _gateFatal(_msg) {
  console.error(`[GATE] FATAL: ${_msg}`);
  console.error(`[GATE] ${_gateUsage}`);
  process.exit(2);
}
for (let _i = 0; _i < _rawArgs.length; _i++) {
  const _a = _rawArgs[_i];
  if (_a === '--json') {
    jsonPath = _i + 1 < _rawArgs.length && !_rawArgs[_i + 1].startsWith('-') ? _rawArgs[++_i] : '';
  } else if (_a === '--level') {
    const _val = _rawArgs[_i + 1];
    if (!_LEVELS.includes(_val))
      _gateFatal(`--level requires one of ${_LEVELS.join('|')}, got "${_val ?? '(missing)'}"`);
    level = _val;
    _i++;
  } else if (_a.startsWith('--level=')) {
    const _val = _a.slice('--level='.length);
    if (!_LEVELS.includes(_val))
      _gateFatal(`--level requires one of ${_LEVELS.join('|')}, got "${_val}"`);
    level = _val;
  } else if (_a === '--dry-run') {
    dryRun = true;
  } else if (_a === '--gate') {
    const _g = _rawArgs[_i + 1];
    if (!_g || _g.startsWith('-')) _gateFatal('--gate requires a check name');
    only = _g;
    _i++;
  } else if (_a.startsWith('--gate=')) {
    const _g = _a.slice('--gate='.length);
    if (!_g) _gateFatal('--gate= requires a check name');
    only = _g;
  } else if (_LEVELS.includes(_a)) {
    level = _a;
  } else if (Object.prototype.hasOwnProperty.call(_SUBCOMMAND_LEVEL, _a)) {
    level = _SUBCOMMAND_LEVEL[_a];
  } else {
    _gateFatal(`unrecognized argument "${_a}"`);
  }
}
// <<< ARG-PARSE-END (#1504)

// #1720 (gap 4): L3/L4 have no dedicated runtime lane in this generated gate — L2
// ("full") is the strongest tier it implements; every `governanceLevel`-specific
// check below is compiled in at generation time and runs inside the L2 lane. The
// guard used to be the literal `level === 'L2'`, so invoking `check-all.mjs L3` or
// `L4` (both accepted by the parser above) silently ran ONLY the L1 fast-checks —
// a runtime lie where the strictest requested tier ran the weakest checks. Clamp an
// explicit L3/L4 request down to L2 so it runs the FULL gate body (never the L1
// subset) and the `level` stamped into the JSON/evidence below stays honest about
// what actually ran — it must never claim a tier this gate cannot run standalone.
// The clamp itself is LOUD (stderr): the bug class being fixed here is SILENT
// downgrades, so the clamp must never become one.
if (level === 'L3' || level === 'L4') {
  console.warn(`[GATE] level ${level} clamps to L2 (strongest tier this generated gate implements)`);
  level = 'L2';
}

// #2078 (GATE-1 of #2041) — inspection modes. Both `--dry-run` and `--gate <name>`
// are diagnostic: they must NEVER stamp a gate-pass marker / result JSON (guarded
// at the write sites below), so a dry-run or single-check rerun cannot fake a green
// gate for the fail-closed Stop hook. `setMode` threads the mode into the
// runCheck/runWarnCheck/runToolCheck trio; a normal run leaves it a no-op.
const _inspect = dryRun || only !== null;
setMode({ dryRun, only });

// ─── Grace Period Guard (ADR-028) ─────────────────────────────────────────────
// A freshly-upgraded L1→L2 project may run its new L2 gates WARN-only for a
// bounded settling window (set ONLY by `arbiter upgrade-level`, never by hand).
//
// Three guards close the L2 fake-green vector this mechanism could otherwise open:
//   1. CURRENT-LEVEL binding — grace is honored only while THIS project is at L2
//      (the level baked into this script at generation time). Once it climbs to
//      L3/L4, `arbiter update` re-renders this script at the higher level and the
//      guard below evaluates false, so a stale L1→L2 graceEndsAt can no longer
//      silence the (now higher) gate. A grace from L1 only ever softens L2.
//   2. BOUNDED window — graceEndsAt is honored only if it is at most
//      GRACE_MAX_DAYS ahead of now. A hand-edited far-future date (the classic
//      "neuter the gate forever" edit) exceeds the bound and is IGNORED, with a
//      loud warning — it cannot make the gate advisory.
//   3. HARD checks stay hard — PII/secret early-fail (above) and the anti-fake-green
//      aggregate are never softened by grace.
const GRACE_MAX_DAYS = 35; // upgrade-level default is 30; +5 slack for one --extend
const _projectLevel = 'L2';
let graceActive = false;
const _arbiterJsonPath = join(process.cwd(), 'arbiter.json');
if (existsSync(_arbiterJsonPath)) {
  try {
    const _cfg = JSON.parse(readFileSync(_arbiterJsonPath, 'utf-8'));
    const _ends = _cfg.graceEndsAt ? Date.parse(_cfg.graceEndsAt) : NaN;
    const _now = Date.now();
    // Grace from L1 is only meaningful while the project is itself at L2.
    const _levelOk = _cfg.graceFromLevel === 'L1' && _projectLevel === 'L2';
    if (_levelOk && Number.isFinite(_ends) && _ends > _now) {
      const _maxEnds = _now + GRACE_MAX_DAYS * 86400000;
      if (_ends > _maxEnds) {
        const _endsDate = _cfg.graceEndsAt.slice(0, 10);
        console.log(`[GRACE] IGNORED — graceEndsAt (${_endsDate}) exceeds the ${GRACE_MAX_DAYS}-day bound; treating L2 gates as HARD. Re-run \`arbiter upgrade-level --extend\` instead of hand-editing arbiter.json.`);
      } else {
        graceActive = true;
        const _daysLeft = Math.ceil((_ends - _now) / 86400000);
        const _endsDate = _cfg.graceEndsAt.slice(0, 10);
        console.log(`[GRACE] Grace period ends in ${_daysLeft} day(s) (${_endsDate}). L2 gates WARN-only until then.`);
      }
    } else if (_cfg.graceFromLevel === 'L1' && _projectLevel !== 'L2' && Number.isFinite(_ends) && _ends > _now) {
      // Stale grace carried into a higher level — never soften the higher gate.
      console.log(`[GRACE] IGNORED — graceFromLevel=L1 but project is now ${_projectLevel}; L2 grace does not apply to a ${_projectLevel} gate.`);
    }
  } catch { /* ignore parse errors — arbiter.json absent or malformed */ }
}

console.log('');
console.log(`=== test-project Quality Gate: ${level} ===`);
console.log('');


// ─── Early-fail: PII scan (INV-12, HARD — no grace period) ────────────────────
runCheck('PII scan', 'node', ['scripts/pii-scan.mjs']);
// ─── L1: Secret-pattern drift (anti-drift, INV-89, #1152) ────────────────────
runCheck('secret scan', 'node', ['scripts/check-secret-scan.mjs']);

// ─── L1: Fast checks ──────────────────────────────────────────────────────────

runCheck('typecheck', 'npx', ['tsc', '--noEmit']);
runCheck('format', 'npx', ['prettier', '--check', '.']);
runCheck('lint', 'npx', ['eslint', 'src']);
// ─── L1: Static analysis rules (M29) ─────────────────────────────────────────
// ESLint v9+ flat config: the static-analysis ruleset lives in
// eslint.config.static.mjs and is run in isolation (--no-config-lookup) so it does
// not merge with the project's main eslint.config.mjs. The legacy eslintrc path
// (--no-eslintrc -c .eslintrc-static.json) was removed: ESLint v9 disabled it and
// v10 deleted it, so it crashed the gate on a fresh install (B4, #1491).
if (existsSync('eslint.config.static.mjs')) {
  runCheck('static analysis', 'npx', ['eslint', '--config', 'eslint.config.static.mjs', '--no-config-lookup', '--no-error-on-unmatched-pattern', 'src']);
} else {
  console.log('[CHECK] static analysis ... SKIP (run: arbiter update)');
}
// ─── L1: No fake-db imports in test files (INV-34, #1887-D) ─────────────────
// Isolated flat config, same reasoning as static analysis above — the legacy
// .eslintrc-no-fake-db.json cannot be loaded by ESLint v9. Emitted by
// generateIntegrationTesting only when hasDatabase, so the guard is graceful
// on a project without a database (never emitted there).
if (existsSync('eslint.config.no-fake-db.mjs')) {
  runCheck('no-fake-db imports (INV-34)', 'npx', ['eslint', '--config', 'eslint.config.no-fake-db.mjs', '--no-config-lookup', '--no-error-on-unmatched-pattern', '.']);
}
runCheck('unit tests', 'npm', ['run', 'test:unit']);
// ─── L1: npm-ci lockfile drift under the pinned npm (#1684) ────────────────────
// Verifies `npm ci` would succeed under the npm pinned in package.json#packageManager,
// catching the local/Dependabot-vs-CI npm-major skew that rejects the lock repo-wide.
// Invokes the pinned npm EXPLICITLY (npx npm@<pin>) — ambient npm may be a newer major
// that hides the skew. SKIP-neutral when there is no packageManager pin or no lockfile:
// the pin is opt-in, and the gate activates the moment one is added.
{
  const _driftStart = Date.now();
  process.stdout.write('[CHECK] npm-ci drift ... ');
  let _driftStatus = 'PASS';
  try {
    const _pin = existsSync('package.json')
      ? (JSON.parse(readFileSync('package.json', 'utf-8')).packageManager || '').match(/^npm@(\d+\.\d+\.\d+)/)
      : null;
    if (!_pin || !existsSync('package-lock.json')) {
      console.log('SKIP (no packageManager npm pin or lockfile)');
    } else {
      const _r = spawnSync('npx', ['-y', 'npm@' + _pin[1], 'ci', '--dry-run'], { encoding: 'utf-8', shell: false });
      if (_r.error) {
        console.log('SKIP (pinned npm@' + _pin[1] + ' unavailable)');
      } else if (_r.status === 0) {
        console.log('PASS');
      } else {
        console.log('FAIL');
        process.stdout.write('package-lock.json is out of sync under npm@' + _pin[1] + ' — relock: npx -y npm@' + _pin[1] + ' install --package-lock-only\n');
        _driftStatus = 'FAIL';
      }
    }
  } catch (_e) {
    console.log('SKIP (' + (_e && _e.message ? _e.message : 'unreadable package.json') + ')');
  }
  pushResult('npm-ci drift', _driftStatus, Date.now() - _driftStart);
}


// ─── L1: Repo hygiene — no tracked data/binary artifacts (INV-129, #1407) ─────
runCheck('no tracked artifacts (INV-129)', 'node', ['scripts/check-no-tracked-artifacts.mjs']);
// ─── L1: Container base images digest-pinned (#1442) ──────────────────────────
runCheck('image pins (#1442)', 'node', ['scripts/check-image-pins.mjs']);
// ─── L1: E2E flaky-test quarantine hygiene (INV-130, #1445) ───────────────────
// Annotates known-unstable tests but never suppresses them; fails closed on an
// expired/malformed quarantine entry. Self-SKIPs when no registry is present.
runCheck('e2e quarantine (INV-130)', 'node', ['scripts/check-e2e-quarantine.mjs']);
// ─── L1: Test naming convention (M27) ────────────────────────────────────────
runCheck('test naming', 'node', ['scripts/check-test-naming.mjs']);
// ─── L1: No-empty-suite / min-execution guard (INV-25, A2 #1497) ──────────────
// Asks the project test runner (vitest/jest/pytest/go) how many tests it would run, via its
// collect/list mode (no execution), and FAILS when that count is 0 — the "0 executed = green"
// false-green that a runner's own exit code does not catch. NA when no runner; SKIP when deps absent.
runCheck('min test execution (INV-25)', 'node', ['scripts/check-min-test-execution.mjs']);
// ─── L1: Exit-code universal contract (INV-53) ────────────────────────────────
runCheck('exit code contract', 'node', ['scripts/check-exit-code-contract.mjs']);
// ─── L1: Pipe/tee hazard (advisory — always exits 0) ─────────────────────────
runCheck('pipe/tee hazard', 'node', ['scripts/check-pipe-tee-hazard.mjs']);

// ─── L1: Self-validation A/B/C drill — proves the two gates above actually
// distinguish PASS/FAIL/ERROR (#1835). Reference only where emitted: the
// self-validation generator owns scripts/self-validation.mjs and is gated by
// this same flag (registry.ts), so emission and wiring can never diverge.
runCheck('self-validation drill', 'node', ['scripts/self-validation.mjs']);

// ─── L1: Anti-drift validators (INV-89, #1152) ───────────────────────────────
runCheck('config drift', 'node', ['scripts/check-drift.mjs']);
runCheck('validator help text', 'node', ['scripts/check-validator-helptext.mjs']);






// ─── L1: Suppression expiry ───────────────────────────────────────────────────
runCheck('suppressions expiry', 'node', ['scripts/check-suppressions.mjs']);
// ─── L1: Suppression quality (anti-drift, INV-89, #1152) ─────────────────────
runCheck('suppression rationale', 'node', ['scripts/check-suppression-rationale.mjs']);
runCheck('suppression expiry (anti-drift)', 'node', ['scripts/check-suppression-expiry.mjs']);

// ─── L1: Inline suppression directives (INV-31) ──────────────────────────────
runCheck('inline suppressions', 'node', ['scripts/check-inline-suppressions.mjs']);
// ─── L1: Context-file lint (anti-drift, INV-89, #1266) ───────────────────────
runCheck('claude-md lint', 'node', ['scripts/check-claude-md-lint.mjs']);
// ─── L1: Workflow runner label enforcement (#191, inlined) ───────────────────
{
  const _wrStart = Date.now();
  process.stdout.write('[CHECK] workflow runners ... ');
  const _wrWorkflowsDir = join(process.cwd(), '.github', 'workflows');
  // Allowlisted runs-on forms (INV-89, ADR-023 amendment #959 — ubuntu-latest default):
  //   1. ${{ vars.CI_BUILD_RUNNER_LABEL || 'ubuntu-latest' }}  — global override (auxiliary jobs)
  //   2. ${{ fromJSON(vars.RUNNER_LABELS_BUILD  || '["ubuntu-latest"]') }}  — build job-class pool
  //   3. ${{ fromJSON(vars.RUNNER_LABELS_TEST   || '["ubuntu-latest"]') }}  — test job-class pool
  //   4. ${{ fromJSON(vars.RUNNER_LABELS_DEPLOY || '["ubuntu-latest"]') }}  — deploy job-class pool
  //   5. ${{ matrix.os }} — explicit OS matrix, always allowed
  // The per-job-class map lets a project point build/test/deploy at distinct runner
  // pools (self-hosted / cloud / GitHub-hosted) via org vars without editing workflows;
  // each var falls back to ubuntu-latest, so an unset var is never a broken runner.
  const _wrAllowedPattern = /\$\{\{\s*(?:vars\.CI_BUILD_RUNNER_LABEL|fromJSON\(vars\.RUNNER_LABELS_(?:BUILD|TEST|DEPLOY)|matrix\.os)/;
  const _wrRunsOnPattern = /^\s*runs-on:/;
  let _wrViolations = 0;
  let _wrFiles;
  try {
    _wrFiles = readdirSync(_wrWorkflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.log(`FAIL (cannot read .github/workflows — ${err.message})`);
      pushResult('workflow runners', 'FAIL', Date.now() - _wrStart);
      _wrFiles = null;
    } else {
      _wrFiles = [];
    }
  }
  if (_wrFiles !== null) {
    for (const _wrFile of _wrFiles) {
      let _wrContent;
      try {
        _wrContent = readFileSync(join(_wrWorkflowsDir, _wrFile), 'utf-8');
      } catch (err) { console.log(`FAIL (cannot read workflow file: ${_wrFile} — ${err.message})`); _wrViolations++; continue; }
      const _wrLines = _wrContent.split('\n');
      for (let _wi = 0; _wi < _wrLines.length; _wi++) {
        if (_wrRunsOnPattern.test(_wrLines[_wi]) && !_wrAllowedPattern.test(_wrLines[_wi])) {
          _wrViolations++;
        }
      }
    }
    if (_wrViolations > 0) {
      console.log(`FAIL (${_wrViolations} violation(s) — use \${{ vars.CI_BUILD_RUNNER_LABEL || 'ubuntu-latest' }})`);
      pushResult('workflow runners', 'FAIL', Date.now() - _wrStart);
    } else {
      console.log(`PASS (${Date.now() - _wrStart}ms)`);
      pushResult('workflow runners', 'PASS', Date.now() - _wrStart);
    }
  }
}
// ─── L1: CI/manifest gate alignment (#240, inlined) ──────────────────────────
{
  const _caStart = Date.now();
  process.stdout.write('[CHECK] ci alignment ... ');
  const _caManifestPath = join(process.cwd(), 'scripts', 'check-all.mjs');
  const _caCiPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
  const _caInfraPrefixes = ['npm ci', 'npm install', 'git fetch', 'git checkout', 'curl ', 'echo ', 'mkdir ', 'cp ', 'tar ', 'pip install', 'apt-get'];
  const _caDesignExemptions = new Set(['npx:commitlint', 'npm:test']);
  function _caIsInfra(cmd) { return _caInfraPrefixes.some((p) => cmd.startsWith(p)); }
  function _caNormalizeKey(cmd, firstArg) {
    switch (cmd) {
      case 'node': return (firstArg && firstArg.startsWith('scripts/')) ? firstArg : null;
      case 'npx': { if (!firstArg) return null; const tool = firstArg.replace(/@.+$/, ''); return 'npx:' + tool; }
      case 'npm': if (firstArg === 'test') return 'npm:test'; if (firstArg === 'audit') return 'npm:audit'; return null;
      default: return null;
    }
  }
  function _caExtractManifestGates(text) {
    const gates = new Set();
    const re = /runCheck\(\s*"[^"]*"\s*,\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const k = _caNormalizeKey(m[1].trim(), (m[2].match(/"([^"]+)"/) || [])[1] || '');
      if (k !== null) gates.add(k);
    }
    return gates;
  }
  function _caParseRun(cmd, gates) {
    if (!cmd || _caIsInfra(cmd)) return;
    const toks = cmd.split(/\s+/);
    const c0 = toks[0]; const a0 = toks[1] ?? '';
    const k = (c0 === 'node' && a0) ? _caNormalizeKey('node', a0) : _caNormalizeKey(c0, a0);
    if (k !== null) gates.add(k);
  }
  function _caExtractCiGates(ciPath) {
    const gates = new Set();
    let ciText;
    try { ciText = readFileSync(ciPath, 'utf-8'); } catch (e) { if (e.code === 'ENOENT') return gates; throw e; }
    const ciLines = ciText.split('\n');
    let _ci = 0;
    while (_ci < ciLines.length) {
      const cl = ciLines[_ci];
      if (/^\s*-?\s*uses:\s*.+/.test(cl)) { _ci++; continue; }
      const blk = cl.match(/^(\s*)-?\s*run:\s*[|>]\s*$/);
      if (blk) {
        const bi = blk[1].length; _ci++;
        while (_ci < ciLines.length) {
          const bl = ciLines[_ci];
          if (bl.trim() === '') { _ci++; continue; }
          if ((bl.match(/^(\s*)/)?.[1].length ?? 0) <= bi && bl.trim() !== '') break;
          _caParseRun(bl.trim(), gates); _ci++;
        }
        continue;
      }
      const sl = cl.match(/^\s*-?\s*run:\s*(.+)/);
      if (sl) { _caParseRun(sl[1].trim(), gates); }
      _ci++;
    }
    return gates;
  }
  let _caStatus = 'PASS';
  try {
    const _caManifestText = readFileSync(_caManifestPath, 'utf-8');
    const _caManifestGates = _caExtractManifestGates(_caManifestText);
    const _caCiGates = _caExtractCiGates(_caCiPath);
    for (const k of _caDesignExemptions) { _caManifestGates.delete(k); _caCiGates.delete(k); }
    const _caManifestOnly = [..._caManifestGates].filter((k) => !_caCiGates.has(k));
    const _caCiOnly = [..._caCiGates].filter((k) => !_caManifestGates.has(k));
    if (_caManifestOnly.length > 0 || _caCiOnly.length > 0) {
      console.log(`FAIL (${_caManifestOnly.length + _caCiOnly.length} alignment violation(s))`);
      for (const k of _caManifestOnly) process.stderr.write('  manifest-only: ' + k + '\n');
      for (const k of _caCiOnly) process.stderr.write('  ci-only: ' + k + '\n');
      _caStatus = 'FAIL';
    } else {
      console.log(`PASS (${_caManifestGates.size} gates aligned, ${Date.now() - _caStart}ms)`);
    }
  } catch (_caErr) {
    console.log('FAIL (error: ' + _caErr.message + ')');
    _caStatus = 'FAIL';
  }
  pushResult('ci alignment', _caStatus, Date.now() - _caStart);
}
// ─── L1: SSOT infrastructure gates (INV-54–57, #255) ─────────────────────────
runCheck('ssot core set', 'node', ['scripts/check-ssot-core.mjs']);
runCheck('doc links', 'node', ['scripts/check-doc-links.mjs']);
runCheck('knowledge map', 'node', ['scripts/check-knowledge-map.mjs']);
runCheck('canonical paths', 'node', ['scripts/check-canonical-paths.mjs']);
// ─── L1: collaborationMode wired (INV-100, #1093) ────────────────────────────
runCheck('collab mode wired (INV-100)', 'node', ['scripts/check-collab-mode-wired.mjs']);
// ─── L1: emitted hook → dispatcher → settings reverse routing (#2129) ─────────
runCheck('hook routing (#2129)', 'node', ['scripts/check-hook-routing.mjs']);
// ─── L1: safety-class adopt ratchet (T1, anti-erosion) ───────────────────────
runCheck('safety adopt ratchet', 'node', ['scripts/check-safety-adopt-ratchet.mjs']);
// ─── L1: governance constraint scan (INV-115, #1214) ─────────────────────────
runCheck('constraint scan (INV-115)', 'node', ['scripts/check-constraint-scan.mjs']);
// ─── L1: wiki lint gate (INV-116, #1241) ─────────────────────────────────────

// #1318/#1321: the wiki generator is enabled only at L2+ (registry.ts), so a
// virgin L1 project never emits scripts/check-wiki-lint.mjs. Gating this runCheck
// to match the generator predicate prevents a MODULE_NOT_FOUND RED on `check-all L1`.
runCheck('wiki lint (INV-116)', 'node', ['scripts/check-wiki-lint.mjs']);

// ─── L1: anti-proforma test gate (INV-118, #1249) ────────────────────────────
runCheck('anti-proforma (INV-118)', 'node', ['scripts/check-anti-proforma.mjs']);
// ─── L1: test pyramid non-empty gate (INV-124, #1364) ────────────────────────
runCheck('test pyramid (INV-124)', 'node', ['scripts/check-test-pyramid.mjs']);
// ─── L1: test-scope ↔ tier integrity (A4, #1497) ─────────────────────────────
// A declared `required` test category that no gate step (check-all check or CI workflow)
// runs is a silent false-green. Complements the pyramid gate (file presence) by asserting
// each required category is actually WIRED into a tier. NO-DATA (no manifest) self-SKIPs.
runCheck('test scope-tier (INV-124)', 'node', ['scripts/check-test-scope-tier.mjs']);
// ─── L1: live-API e2e suite gate (INV-126, #1365) ────────────────────────────
// Service archetypes (api-e2e.json required:true) must ship a non-mocked suite that
// boots the real binary; required:false / absent manifest ⇒ runtime SKIP.
runCheck('api e2e (INV-126)', 'node', ['scripts/check-api-e2e.mjs']);
// ─── L1: domain<->API surface-completeness gate (INV-125, #1367) ─────────────

// #1835/#1331: check-domain-api-surface.mjs is emitted by emitDomainApiSurface
// (check-all.ts) only when config.hasPublicApi is true — reference it only where
// it is actually emitted (mirrors the consumer-audit precedent above in this
// same file, #1737), so the emission-coherence gate stays consistent for
// archetypes without a public API (e.g. typescript/library).
runCheck('domain-api surface (INV-125)', 'node', ['scripts/check-domain-api-surface.mjs']);

// ─── L1: frontend render-smoke presence gate (INV-127, #1366) ────────────────
// Fails-closed when a frontend archetype (or `frontend` lane) ships without a
// render-smoke behavioural spec. Self-SKIPs for non-frontend / ungoverned repos.
runCheck('render smoke presence (INV-127)', 'node', ['scripts/check-render-smoke.mjs']);
// ─── L1: smoke-journey acceptance-floor gate (INV-137, #2080) ─────────────────
// Asserts the declared login/CRUD/authz journeys are COVERED (not just present, unlike
// INV-126). applicable:false / absent manifest ⇒ runtime SKIP.
runCheck('smoke journeys (INV-137)', 'node', ['scripts/check-smoke-journeys.mjs']);

// ─── L1: stack-conformity gate (INV-121, #1312) ──────────────────────────────
// Fails when the repo-root manifest contradicts the declared language/databaseEngine
// axes. Self-safety is RUNTIME-resident in the emitted .mjs (absent language ⇒ exit 0).
runCheck('stack conformity (INV-121)', 'node', ['scripts/check-stack-conformity.mjs']);

// ─── L1: ISO 9001 quality-process overlay gate (#1253) — present only when overlay selected
if (existsSync('scripts/check-iso9001.mjs')) {
  runCheck('iso9001 QMS (RTM + doc-control + CAPA)', 'node', ['scripts/check-iso9001.mjs']);
}
// ─── L1: regulated / high-assurance overlay gate — present only when overlay selected
if (existsSync('scripts/check-regulated-overlay.mjs')) {
  runCheck('regulated overlay (SoD + retention + signing + mutation)', 'node', [
    'scripts/check-regulated-overlay.mjs',
  ]);
}

// ─── L1: GitHub CI tier gates (INV-73, INV-75, INV-76) ───────────────────────
runCheck('ci tiers (INV-73)', 'node', ['scripts/check-ci-tiers.mjs']);
runCheck('action pins (INV-75)', 'node', ['scripts/check-action-pins.mjs']);
runCheck('workflow perms (INV-76)', 'node', ['scripts/check-workflow-perms.mjs']);
// ─── L1: Workflow anti-drift validators (INV-89, #1152) ──────────────────────
runCheck('workflow runners', 'node', ['scripts/check-workflow-runners.mjs']);
runCheck('workflow docs sync', 'node', ['scripts/check-workflow-docs-sync.mjs']);
runCheck('workflow test integrity', 'node', ['scripts/check-workflow-test-integrity.mjs']);
runCheck('secret presence (fail-loud)', 'node', ['scripts/check-secret-presence.mjs']);
runCheck('continue-on-error (swallowed gate)', 'node', ['scripts/check-continue-on-error.mjs']);
runCheck('workflow sha pinning', 'node', ['scripts/check-workflow-sha-pinning.mjs']);
runCheck('workflow job naming', 'node', ['scripts/check-workflow-job-naming.mjs']);
runCheck('pr size gate', 'node', ['scripts/check-pr-size-gate.mjs']);
// ─── ff-only merge method enforcement (INV-101) ──────────────────────────────
// #1331: check-merge-method.mjs is emitted by the github-setup generator, which
// only runs at L2+. Reference it only where it is emitted so an L1+GitHub project
// is not left with a ghost reference to a never-emitted script.

runCheck('merge method ff-only (INV-101)', 'node', ['scripts/check-merge-method.mjs']);


// ─── L1+: anti-fake-green file-scan guards (#1497) ────────────────────────────
// arbiter's deterministic, NO-DATA-safe anti-fake-green guards, shipped INTO this project so a
// planted false-green is caught by THIS gate — not only by arbiter's. Each PASSES when there is
// nothing to scan, so they are safe to enforce hard at every governance level:
//   muted gate test (a silenced test that can never fail), skipped critical e2e, a stale "Moved →"
//   redirect husk doc, and an over-long / stale-level ADR-028 grace window in arbiter.json.
runCheck('muted gate test (anti-fake-green)', 'node', ['scripts/check-muted-test.mjs']);
runCheck('skipped critical e2e (anti-fake-green)', 'node', ['scripts/check-skip-critical-e2e.mjs']);
runCheck('stub redirect husk (anti-fake-green)', 'node', ['scripts/check-no-stub-redirects.mjs']);
runCheck('grace window (anti-fake-green)', 'node', ['scripts/check-grace-window.mjs']);
// ─── L2: Full checks ──────────────────────────────────────────────────────────
if (level === 'L2') {

  // ─── L2: Security scanning (INV-11/12/13) ──────────────────────────────────
  runCheck('gitleaks', 'gitleaks', ['detect', '--source', '.', '--config', '.gitleaks.toml', '--gitleaks-ignore-path', 'suppressions/.gitleaksignore', '--exit-code', '1'], { soft: graceActive });



  runCheck('audit', 'npm', ['audit', '--audit-level=high'], { soft: graceActive });



  runCheck('contract tests', 'npm', ['run', 'test:contract'], { soft: graceActive });
  runCheck('integration tests', 'npm', ['run', 'test:integration'], { soft: graceActive });
  runCheck('behavioral tests', 'npm', ['run', 'test:behavioral'], { soft: graceActive });

  runCheck('db integration tests', 'npx', ['vitest', 'run', 'integration'], { soft: graceActive });



  // ─── L2: Playwright E2E (#348, CANON-02) — matrix proven for TS frontend-spa / backend-web-db.
  // Wrapped via scripts/lib/ephemeral-server.mjs (#358): the runner starts the
  // server, polls TCP readiness, runs Playwright, then tears the server down.
  // runToolCheck SKIPs locally when the binary is missing, FAILs in CI.
  runToolCheck(
    'playwright e2e',
    'node',
    [
      'scripts/lib/ephemeral-server.mjs',
      '--start', process.env.E2E_START_CMD || 'npm run start:test',
      '--test',  'npx playwright test',
      '--port',  process.env.E2E_PORT || '4173',
    ],
    { soft: graceActive },
  );



  // ─── L2: Tech Debt Gates ────────────────────────────────────────────────────


  // ─── L2: coverage threshold (greenfield-aware, #1319.8) ─────────────────────
  // Run vitest with the json-summary reporter so we can inspect the real coverage
  // totals at runtime. A virgin project has zero executable statements ⇒ the
  // greenfield guard PASSES instead of false-failing the line threshold. A coverage
  // run that crashed (no summary) FAILS — never silently skipped.
  {
    const _covStart = Date.now();
    process.stdout.write('[CHECK] coverage threshold ... ');
    const _covThreshold = 80;
    const _cov = spawnSync(
      'npx',
      ['vitest', 'run', '--coverage', '--coverage.reporter=json-summary'],
      { encoding: 'utf-8', shell: false },
    );
    let _covStatus = 'PASS';
    let _covReason = '';
    let _covSummary = null;
    const _covSummaryPath = resolve(process.cwd(), 'coverage', 'coverage-summary.json');
    if (existsSync(_covSummaryPath)) {
      try {
        _covSummary = JSON.parse(readFileSync(_covSummaryPath, 'utf-8'));
      } catch {
        _covSummary = null; // malformed JSON ⇒ evaluateCoverageGate fails closed
      }
    }
    const _covResult = evaluateCoverageGate(_covSummary, _covThreshold);
    _covStatus = _covResult.status;
    _covReason = _covResult.reason;
    if (_covStatus === 'FAIL' && graceActive) {
      console.log(`WARN (grace period — ${_covReason})`);
      _covStatus = 'PASS';
    } else if (_covStatus === 'FAIL') {
      console.log(`FAIL (${_covReason})`);
    } else {
      console.log(`PASS (${_covReason})`);
    }
    pushResult('coverage threshold', _covStatus, Date.now() - _covStart);
  }

  runCheck('dead code', 'npx', ['knip'], { soft: graceActive });
  // Fail-closed wrapper: bare `npx jscpd --silent` exits 0 on a 0-file scan
  // under jscpd v5, making the gate vacuous on fileset drift.
  runCheck('duplication', 'node', ['scripts/check-duplication.mjs'], { soft: graceActive });
  runCheck('circular deps', 'npx', ['madge', '--circular', '--extensions', 'ts,tsx,js,jsx', 'src'], { soft: graceActive });
  runCheck('arch boundaries', 'npm', ['run', 'check:arch'], { soft: graceActive });

  // ─── L2: Mutation testing gate (#347, INV-30, CANON-02/09/15) ───────────────
  // Proven cells: java (pitest), typescript (stryker). Rust/Python (beta) and Go (unsafe)
  // are not wired. CANON-02 is proven⇒gated (one-directional); Kotlin (beta) kover is
  // soft-gated above (plugin operator-applied, not auto-wired by arbiter). Kotlin pitest
  // is not wired (beta cell, separate from kover coverage).
  // Threshold (mutationThreshold) is rendered into the tool config (stryker.conf.json,
  // pitest.gradle) by generateMutation at L3. At L2 the gate runs against whatever
  // config is present locally; the helper is `runToolCheck` for stryker (npx auto-fetch
  // may be absent locally → SKIP, FAIL only in CI) and `runCheck` for pitest (binary
  // ships via gradle/maven plugin once the build file is wired).

  // ─── L2: STRIDE/RACI traceability ───────────────────────────────────────────
  runCheck('STRIDE/RACI traceability', 'node', ['scripts/check-stride-traceability.mjs'], { soft: graceActive });

  // ─── L2: BDD gate (INV-40) ──────────────────────────────────────────────────
  {
    // @ignore-tagged scenarios are HARD-fail (soft: false per INV-40 — never graced)
    const _bddIgnoreStart = Date.now();
    const _bddIgnore = spawnSync('grep', ['-rql', '--include=*.feature', '@ignore', '.'], { encoding: 'utf-8', shell: false });
    process.stdout.write('[CHECK] BDD @ignore check ... ');
    let _bddIgnoreStatus = 'PASS';
    if (_bddIgnore.error?.code === 'ENOENT') {
      console.log('FAIL (grep not found — cannot check @ignore tags)');
      _bddIgnoreStatus = 'FAIL';
    } else if (_bddIgnore.status === null || _bddIgnore.status === 2) {
      console.log(`FAIL (grep error — exit ${_bddIgnore.status ?? 'signal'}: ${_bddIgnore.stderr ?? ''})`);
      _bddIgnoreStatus = 'FAIL';
    } else if (_bddIgnore.status === 0) {
      console.log('FAIL (@ignore-tagged scenarios found — remove tags or move to issue tracker)');
      _bddIgnoreStatus = 'FAIL';
    } else {
      console.log('PASS');
    }
    pushResult('BDD @ignore check', _bddIgnoreStatus, Date.now() - _bddIgnoreStart);
  }
  // ─── L2: GDPR controls gate (#1251) ──────────────────────────────────────────
  // Enforceable controls→gates for the `industryOverlay: gdpr` overlay. existsSync-
  // guarded so it only runs for projects where the gdpr generator emitted the gate;
  // language-neutral (the controls are documentation artifacts, not stack-specific).
  if (existsSync('scripts/check-gdpr-controls.mjs')) {
    runCheck('gdpr controls (#1251)', 'node', ['scripts/check-gdpr-controls.mjs'], { soft: graceActive });
  }

  runCheck('bdd', 'npx', ['cucumber-js'], { soft: graceActive });

  // ─── L2: Debt Ratchet ────────────────────────────────────────────────────────
  // Compares against baseline if debt-baseline.json exists (skips gracefully if absent)

  runCheck('debt ratchet', 'node', ['scripts/debt-report.mjs', '--gate'], { soft: graceActive });

  // ─── L2+: Commit-footer audit evidence (INV-119, #1249) ──────────────────────
  // Hard-blocks if suppression/override/bypass commits lack required footer trailers.
  // Fails open (exit 0 with WARN) when origin/main is unavailable.
  runCheck('commit-footer rationale (INV-119)', 'node', ['scripts/check-commit-footer-rationale.mjs'], { soft: graceActive });
  // ─── L2+: Docs updated alongside code changes (#356, #1835) ──────────────────
  // Emitted at this same governance gate (check-all.ts) but was never referenced
  // anywhere — a dead emission on every L2+ project. Advisory (never blocks a
  // fresh `arbiter update` consumer that has never had this enforced before);
  // [skip-docs] in a commit message bypasses.
  runWarnCheck('docs updated with code (#356)', 'node', ['scripts/check-docs.mjs']);
  // ─── L2+: FEATURE_MATRIX.md / GAP.md gates (#1887-B) ─────────────────────────
  // generateFeatureMatrix/generateGap emit these docs at this same L2+ gate
  // (governanceLevel !== 'L1') and each doc's own header comment promises a
  // gate script — check-feature-matrix.mjs and gen-gap.mjs are emitted at the
  // identical gate, so the reference always resolves.
  runCheck('feature matrix (INV-112)', 'node', ['scripts/check-feature-matrix.mjs']);
  runCheck('gap register', 'node', ['scripts/gen-gap.mjs', '--check']);

  // Advisory (#1398/C6, INV-128): conformance scorecard ratchet — informational, never blocks gate.
  if (existsSync('scripts/conformance.mjs')) {
    runWarnCheck('conformance', 'node', ['scripts/conformance.mjs', '--check'])
  }
  // Advisory (#1419): gold-audit no-regress ratchet — informational, never blocks gate.
  // Plain --check bootstraps a missing baseline (exit 0); the strict require-baseline hard
  // guard is NEVER passed downstream (it hard-fails a fresh consumer = day-1 red; self-only).
  if (existsSync('scripts/gold-audit.mjs')) {
    runWarnCheck('gold-audit', 'node', ['scripts/gold-audit.mjs', '--check'])
  }
  // Advisory (#1428, INV-135): doc-set presence audit — informational, never blocks gate.
  // Plain --check runs the engine in its default advisory mode (exit 0 unless --strict), so a
  // fresh consumer bootstraps with no day-1 redness; the strict hard guard is never passed here.
  if (existsSync('scripts/check-doc-set.mjs')) {
    runWarnCheck('doc-set', 'node', ['scripts/check-doc-set.mjs', '--check'])
  }
  // Advisory (#1428, INV-135): anti-fake-green guard aggregate — informational, never blocks gate.
  // The gh-audit guards fail OPEN (advisory) when `gh` is absent; --enforce is NEVER passed here
  // (it would promote advisory findings to hard fails = day-1 red for a fresh consumer).
  if (existsSync('scripts/check-anti-fake-green.mjs')) {
    runWarnCheck('anti-fake-green', 'node', ['scripts/check-anti-fake-green.mjs'])
  }
  // Advisory (#1457, INV-134): per-module coverage non-regression ratchet — start-warn,
  // promote-later. Informational (runWarnCheck) so it never blocks the gate while the
  // ±0.5pp per-module baseline beds in. Self-SKIPs when no coverage summary exists.
  if (existsSync('scripts/verify-module-coverage.mjs')) {
    runWarnCheck('module coverage ratchet', 'node', ['scripts/verify-module-coverage.mjs'])
  }
  // Advisory (E1-E6a #1943): anti-context-rot enforcers — advisory at land-time per the
  // design's tier table (docs/design/anti-context-rot-enforcers.md §0); each vacuous-PASSes
  // when its evidence surface is absent, so a fresh consumer sees no day-1 redness. Dated
  // promotion discipline (advisory-is-a-stage-not-a-destination): promote to runCheck at
  // gated-review once the producer paths are routinely populated. check-touched-vs-manifest
  // is deliberately NOT here — it is a per-group harvest-time gate needing --plan/--group/--base.
  if (existsSync('scripts/check-agent-return.mjs')) {
    runWarnCheck('agent-return envelope (E1 #1943)', 'node', ['scripts/check-agent-return.mjs'])
  }
  if (existsSync('scripts/check-refutation-verdicts.mjs')) {
    runWarnCheck('refutation majority (E2 #1943)', 'node', ['scripts/check-refutation-verdicts.mjs'])
  }
  if (existsSync('scripts/check-audit-dry-pass.mjs')) {
    runWarnCheck('audit dry-pass (E3 #1943)', 'node', ['scripts/check-audit-dry-pass.mjs', '--all'])
  }
  if (existsSync('scripts/check-handoff-doc.mjs')) {
    runWarnCheck('handoff lint (E6a #1943)', 'node', ['scripts/check-handoff-doc.mjs'])
  }

  // ─── L2: TDD red→green evidence re-verification (INV-131, #1446) ──────────────
  // Re-verifies every task-ID commit's red→green evidence on a fresh CI checkout —
  // the rigor arbiter applies to itself, shipped to targets. Independent of debt
  // gates (runs whenever level===L2). Self-SKIPs when origin/main is unavailable or
  // there are no task-ID commits.
  runCheck('tdd-evidence (INV-131)', 'node', ['scripts/check-tdd-evidence.mjs'], { soft: graceActive });
  // ─── L2: over-age task-marker enforcement (INV-133, #1456) ────────────────────
  // A TODO(#123) marker whose linked issue was created more than MAX_AGE_DAYS (default 180)
  // ago FAILS the gate. Age is derived from the issue created_at only. Graceful-SKIP
  // when gh is missing / token absent / offline (never false-fails).
  runCheck('todo max-age (INV-133)', 'node', ['scripts/check-todo-max-age.mjs'], { soft: graceActive });


}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('');
console.log('=== Summary ===');
console.log('');

const _allResults = getResults();
const _failedCount = getFailed();
const nameWidth = Math.max(6, ..._allResults.map((r) => r.name.length));
const header = `${'Check'.padEnd(nameWidth)}  Status  Elapsed`;
const divider = '-'.repeat(header.length);
console.log(header);
console.log(divider);
let totalElapsed = 0;
for (const r of _allResults) {
  totalElapsed += r.elapsed;
  console.log(`${r.name.padEnd(nameWidth)}  ${r.status.padEnd(6)}  ${r.elapsed}ms`);
}
console.log(divider);
console.log(`${'Total'.padEnd(nameWidth)}          ${totalElapsed}ms`);
console.log('');

// ─── Gate result JSON (arbiter-gate-v1) ──────────────────────────────────────
// #2078: never write gate evidence from an inspection run (--dry-run / --gate) —
// its `pass` would be a lie (all-SKIP for dry-run, a partial run for --gate).
if (!_inspect) {
  const _parityGates = _allResults
    .map((r) => ({ name: r.name, pass: r.status === 'PASS' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const _parityContentHash = createHash('sha256').update(JSON.stringify(_parityGates)).digest('hex');
  const _contentHash = createHash('sha256').update(JSON.stringify(_parityGates)).digest('hex');
  const _artifact = {
    schema: 'arbiter-gate-v1',
    node: process.version,
    level,
    gates: _allResults.map((r) => ({ name: r.name, pass: r.status === 'PASS', durationMs: r.elapsed })),
    parityGates: _parityGates,
    pass: _failedCount === 0,
    parityContentHash: _parityContentHash,
    contentHash: _contentHash,
  };
  const _outPath = (jsonPath !== null && jsonPath !== '') ? jsonPath : resolve(process.cwd(), '.arbiter/gate/local-result.json');
  try {
    mkdirSync(dirname(_outPath), { recursive: true });
    writeFileSync(_outPath, JSON.stringify(_artifact, null, 2) + '\n');
  } catch { /* non-fatal */ }
}

if (_failedCount === 0 && !_inspect) {
  const _headResult = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' });
  const _headSha = _headResult.stdout.trim();
  const _gitUserResult = spawnSync('git', ['config', 'user.name'], { encoding: 'utf-8' });
  const _gitUser = _gitUserResult.status === 0 ? _gitUserResult.stdout.trim() : 'unknown';
  // #1705/#1212: stamp the branch so the fail-closed Stop hook (stop-evidence-guard.mjs)
  // can require this gate-pass to belong to the current branch (strict branch+sha match).
  // Mirrors the live scripts/check-all.mjs gate-pass shape — omitting `branch` here breaks
  // the generated hook's `gate.branch !== branch` check for every target project.
  const _branch = (() => {
    try {
      const _r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' });
      return _r.status === 0 ? _r.stdout.trim() : 'unknown';
    } catch { return 'unknown'; }
  })();
  // #1441: stamp the task id so the Stop hook can reject a prior task's gate-pass (anti-replay).
  const _taskId = (() => {
    try {
      const _sp = resolve(process.cwd(), '.claude/.task/status.json');
      if (!existsSync(_sp)) return 'unknown';
      const _s = JSON.parse(readFileSync(_sp, 'utf-8'));
      return (typeof _s.taskId === 'string' && _s.taskId.length > 0) ? _s.taskId : 'unknown';
    } catch { return 'unknown'; }
  })();
  // #2085: record whether the TRACKED tree was clean when the gate ran, so the
  // generated pre-push hook can reuse this green evidence only when the stamp
  // corresponds to a committed (clean) tree. Untracked files ('??') are ignored,
  // matching the hook's porcelain semantics. Fail-closed: any error → false.
  const _treeWasClean = (() => {
    try {
      const _p = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8' });
      if (_p.status !== 0 || typeof _p.stdout !== 'string') return false;
      return _p.stdout.split('\n').every((l) => l === '' || l.startsWith('??'));
    } catch { return false; }
  })();
  const _markerPath = resolve(process.cwd(), '.arbiter/gate-pass.json');
  try {
    mkdirSync(dirname(_markerPath), { recursive: true });
    writeFileSync(
      _markerPath,
      JSON.stringify(
        { head_sha: _headSha, branch: _branch, task_id: _taskId, timestamp: new Date().toISOString(), level, node_version: process.version, git_user: _gitUser, tree_was_clean_at_run_time: _treeWasClean },
        null,
        2,
      ) + '\n',
    );
  } catch (_err) {
    process.stderr.write(`check-all: warning: could not write gate marker: ${_err.message}\n`);
  }
}

if (_failedCount > 0) {
  const _failedResults = _allResults.filter((r) => r.status === 'FAIL');
  console.error(`=== FAILED: ${_failedCount} check(s) ===`);
  console.error('Failed checks:');
  for (const r of _failedResults) console.error(`- ${r.name}`);
  console.error('');
  process.exit(1);
} else {
  console.log('=== ALL PASSED ===\n');
}
