#!/usr/bin/env node
// ts-library-fixture quality gate
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
  gateFileState,
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


const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';


// Guard an arbiter-emitted gate artifact using the emission-time manifest rather
// than filesystem existence alone. A missing optional artifact that was never
// emitted stays a normal skip; a delivered guard later deleted is a gate failure.
function gateFilePresent(_path, _label, _neverEmittedLine = null, _alternatePaths = []) {
  if (_alternatePaths.some((_alternatePath) => existsSync(_alternatePath))) return true;
  const _state = gateFileState(_path);
  if (_state === 'present') return true;
  if (_state === 'never-emitted') {
    if (_neverEmittedLine) console.log(_neverEmittedLine);
    return false;
  }
  if (_state === 'deleted') {
    // Keep the prerequisite in the same inspection contract as runCheck: a
    // single-check rerun ignores another check's guard, and a dry-run reports
    // what a normal gate would do without changing its result to FAIL.
    if (only !== null && only !== _label) return false;
    if (dryRun) {
      console.log(
        `[CHECK] ${_label} ... DRY-RUN (would FAIL — ${_path} was emitted by arbiter and is now missing)`,
      );
      return false;
    }
    console.error(
      `[CHECK] ${_label} ... FAIL — ${_path} was emitted by arbiter and is now missing; run arbiter update or restore it from git.`,
    );
    pushResult(_label, 'FAIL', 0);
    return false;
  }
  console.error(
    `[CHECK] ${_label} ... DEGRADED — cannot determine whether ${_path} was emitted because .arbiter-generated-manifest.json is unavailable or invalid; run arbiter update or restore the manifest.`,
  );
  return false;
}

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

// ─── Embedded gate registry (#2041, AC-2041.4) ────────────────────────────────
// The declarative registry rendered from gate-registry.yml.ejs — consumed by
// `--dry-run` (manifest), `--gate <id|name>` (single-check re-run), and the
// emitted layering contract test (scripts/test-gate-layering.mjs). ORDER IS
// MEANINGFUL: gates run in registry order within each level.

const GATE_REGISTRY = [{"id":"pii-scan","name":"PII scan","level":"L1","kind":"check","cmd":["node","scripts/pii-scan.mjs"]},{"id":"secret-scan","name":"secret scan","level":"L1","kind":"check","cmd":["node","scripts/check-secret-scan.mjs"]},{"id":"typecheck","name":"typecheck","level":"L1","kind":"check","cmd":["npx","tsc","--noEmit"],"language":"typescript"},{"id":"format","name":"format","level":"L1","kind":"check","cmd":["npx","prettier","--check","."],"language":"typescript"},{"id":"lint","name":"lint","level":"L1","kind":"check","cmd":["npx","eslint","."],"language":"typescript"},{"id":"static-analysis","name":"static analysis","level":"L1","kind":"check","cmd":["npx","eslint","--config","eslint.config.static.mjs","--no-config-lookup","--no-error-on-unmatched-pattern","src"],"language":"typescript","condition":"gateFilePresent('eslint.config.static.mjs', 'static analysis', '[CHECK] static analysis ... SKIP (run: arbiter update)')"},{"id":"no-fake-db-imports","name":"no-fake-db imports (INV-34)","level":"L1","kind":"check","cmd":["npx","eslint","--config","eslint.config.no-fake-db.mjs","--no-config-lookup","--no-error-on-unmatched-pattern","."],"language":"typescript","condition":"gateFilePresent('eslint.config.no-fake-db.mjs', 'no-fake-db imports (INV-34)')"},{"id":"unit-tests","name":"unit tests","level":"L1","kind":"check","cmd":["npm","run","test:unit"],"language":"typescript"},{"id":"npm-ci-drift","name":"npm-ci drift","level":"L1","kind":"inline","language":"typescript","emitIf":"packageManager === 'npm'","else":"console.log('[CHECK] npm-ci drift ... SKIP (project uses npm)');\npushResult('npm-ci drift', 'SKIP', 0);"},{"id":"no-tracked-artifacts","name":"no tracked artifacts (INV-129)","level":"L1","kind":"check","cmd":["node","scripts/check-no-tracked-artifacts.mjs"]},{"id":"image-pins","name":"image pins (#1442)","level":"L1","kind":"check","cmd":["node","scripts/check-image-pins.mjs"]},{"id":"e2e-quarantine","name":"e2e quarantine (INV-130)","level":"L1","kind":"check","cmd":["node","scripts/check-e2e-quarantine.mjs"]},{"id":"test-naming","name":"test naming","level":"L1","kind":"check","cmd":["node","scripts/check-test-naming.mjs"]},{"id":"min-test-execution","name":"min test execution (INV-25)","level":"L1","kind":"check","cmd":["node","scripts/check-min-test-execution.mjs"]},{"id":"exit-code-contract","name":"exit code contract","level":"L1","kind":"check","cmd":["node","scripts/check-exit-code-contract.mjs"]},{"id":"pipe-tee-hazard","name":"pipe/tee hazard","level":"L1","kind":"check","cmd":["node","scripts/check-pipe-tee-hazard.mjs"]},{"id":"self-validation-drill","name":"self-validation drill","level":"L1","kind":"check","cmd":["node","scripts/self-validation.mjs"],"emitIf":"typeof enableSelfValidationHarness === 'undefined' || enableSelfValidationHarness !== false"},{"id":"config-drift","name":"config drift","level":"L1","kind":"check","cmd":["node","scripts/check-drift.mjs"]},{"id":"validator-helptext","name":"validator help text","level":"L1","kind":"check","cmd":["node","scripts/check-validator-helptext.mjs"]},{"id":"suppressions-expiry","name":"suppressions expiry","level":"L1","kind":"check","cmd":["node","scripts/check-suppressions.mjs"],"emitIf":"enableSuppressions"},{"id":"suppression-rationale","name":"suppression rationale","level":"L1","kind":"check","cmd":["node","scripts/check-suppression-rationale.mjs"],"emitIf":"enableSuppressions"},{"id":"suppression-expiry-antidrift","name":"suppression expiry (anti-drift)","level":"L1","kind":"check","cmd":["node","scripts/check-suppression-expiry.mjs"],"emitIf":"enableSuppressions"},{"id":"inline-suppressions","name":"inline suppressions","level":"L1","kind":"check","cmd":["node","scripts/check-inline-suppressions.mjs"]},{"id":"claude-md-lint","name":"claude-md lint","level":"L1","kind":"check","cmd":["node","scripts/check-claude-md-lint.mjs"]},{"id":"unwired-guards","name":"unwired guards","level":"L1","kind":"check","cmd":["node","scripts/check-unwired-guards.mjs"]},{"id":"workflow-runners-inline","name":"workflow runners","level":"L1","kind":"inline"},{"id":"ci-alignment","name":"ci alignment","level":"L1","kind":"inline"},{"id":"ssot-core-set","name":"ssot core set","level":"L1","kind":"check","cmd":["node","scripts/check-ssot-core.mjs"]},{"id":"doc-links","name":"doc links","level":"L1","kind":"check","cmd":["node","scripts/check-doc-links.mjs"]},{"id":"knowledge-map","name":"knowledge map","level":"L1","kind":"check","cmd":["node","scripts/check-knowledge-map.mjs"]},{"id":"canonical-paths","name":"canonical paths","level":"L1","kind":"check","cmd":["node","scripts/check-canonical-paths.mjs"]},{"id":"collab-mode-wired","name":"collab mode wired (INV-100)","level":"L1","kind":"check","cmd":["node","scripts/check-collab-mode-wired.mjs"]},{"id":"hook-routing","name":"hook routing (#2129)","level":"L1","kind":"check","cmd":["node","scripts/check-hook-routing.mjs"]},{"id":"safety-adopt-ratchet","name":"safety adopt ratchet","level":"L1","kind":"check","cmd":["node","scripts/check-safety-adopt-ratchet.mjs"]},{"id":"emission-parity","name":"emission parity (#2110)","level":"L1","kind":"check","cmd":["node","scripts/check-emission-parity.mjs"]},{"id":"constraint-scan","name":"constraint scan (INV-115)","level":"L1","kind":"check","cmd":["node","scripts/check-constraint-scan.mjs"]},{"id":"anti-proforma","name":"anti-proforma (INV-118)","level":"L1","kind":"check","cmd":["node","scripts/check-anti-proforma.mjs"]},{"id":"test-pyramid","name":"test pyramid (INV-124)","level":"L1","kind":"check","cmd":["node","scripts/check-test-pyramid.mjs"]},{"id":"test-scope-tier","name":"test scope-tier (INV-124)","level":"L1","kind":"check","cmd":["node","scripts/check-test-scope-tier.mjs"]},{"id":"api-e2e","name":"api e2e (INV-126)","level":"L1","kind":"check","cmd":["node","scripts/check-api-e2e.mjs"]},{"id":"render-smoke-presence","name":"render smoke presence (INV-127)","level":"L1","kind":"check","cmd":["node","scripts/check-render-smoke.mjs"]},{"id":"smoke-journeys","name":"smoke journeys (INV-137)","level":"L1","kind":"check","cmd":["node","scripts/check-smoke-journeys.mjs"]},{"id":"e2e-escalation","name":"e2e escalation ladder (#2043)","level":"L1","kind":"check","cmd":["node","scripts/check-e2e-escalation.mjs"]},{"id":"m16-handoff","name":"M16 handoff-contract marker (#2103)","level":"L1","kind":"check","cmd":["node","scripts/check-m16-handoff.mjs"]},{"id":"stack-conformity","name":"stack conformity (INV-121)","level":"L1","kind":"check","cmd":["node","scripts/check-stack-conformity.mjs"],"emitIf":"language"},{"id":"iso9001","name":"iso9001 QMS (RTM + doc-control + CAPA)","level":"L1","kind":"check","cmd":["node","scripts/check-iso9001.mjs"],"condition":"gateFilePresent('scripts/check-iso9001.mjs', 'iso9001 QMS (RTM + doc-control + CAPA)')"},{"id":"regulated-overlay","name":"regulated overlay (SoD + retention + signing + mutation)","level":"L1","kind":"check","cmd":["node","scripts/check-regulated-overlay.mjs"],"condition":"gateFilePresent('scripts/check-regulated-overlay.mjs', 'regulated overlay (SoD + retention + signing + mutation)')"},{"id":"muted-test","name":"muted gate test (anti-fake-green)","level":"L1","kind":"check","cmd":["node","scripts/check-muted-test.mjs"]},{"id":"skip-critical-e2e","name":"skipped critical e2e (anti-fake-green)","level":"L1","kind":"check","cmd":["node","scripts/check-skip-critical-e2e.mjs"]},{"id":"stub-redirect-husk","name":"stub redirect husk (anti-fake-green)","level":"L1","kind":"check","cmd":["node","scripts/check-no-stub-redirects.mjs"]},{"id":"grace-window","name":"grace window (anti-fake-green)","level":"L1","kind":"check","cmd":["node","scripts/check-grace-window.mjs"]},{"id":"assertion-delta","name":"assertion delta (anti-fake-green)","level":"L1","kind":"check","cmd":["node","scripts/check-assertion-delta.mjs"]},{"id":"tabletop-evidence","name":"tabletop evidence (#2429)","level":"L1","kind":"check","cmd":["node","scripts/check-tabletop-evidence.mjs"]},{"id":"contract-tests-ts","name":"contract tests","level":"L2","kind":"check","cmd":["npm","run","test:contract"],"emitIf":"language === 'typescript'","soft":true},{"id":"integration-tests-ts","name":"integration tests","level":"L2","kind":"check","cmd":["npm","run","test:integration"],"emitIf":"language === 'typescript'","soft":true},{"id":"behavioral-tests-ts","name":"behavioral tests","level":"L2","kind":"check","cmd":["npm","run","test:behavioral"],"emitIf":"language === 'typescript'","soft":true},{"id":"arc42-slots","name":"arc42 slots (INV-144)","level":"L2","kind":"warn","cmd":["node","scripts/check-arc42-slots.mjs"],"condition":"gateFilePresent('scripts/check-arc42-slots.mjs', 'arc42 slots (INV-144)')"},{"id":"tdd-evidence","name":"tdd-evidence (INV-131)","level":"L2","kind":"check","cmd":["node","scripts/check-tdd-evidence.mjs"],"soft":true},{"id":"todo-max-age","name":"todo max-age (INV-133)","level":"L2","kind":"check","cmd":["node","scripts/check-todo-max-age.mjs"],"soft":true},{"id":"nightly-audit-prod","name":"nightly audit (prod scope)","level":"L3","kind":"check","cmd":["npm","audit","--omit=dev","--audit-level=high"],"emitIf":"language === 'typescript' && packageManager === 'npm'","soft":true}];

// ─── #2078 (GATE-1 of #2041) — inspection modes, re-based on the registry.
// `--dry-run` prints the registry manifest without executing (exit 0, zero
// executions); `--gate <id|name>` re-runs a single check with timing. Both are
// diagnostic: they must NEVER stamp a gate-pass marker / result JSON (guarded
// at the write sites below), so a dry-run or single-check rerun cannot fake a
// green gate for the fail-closed Stop hook. `setMode` threads the mode into the
// runCheck/runWarnCheck/runToolCheck trio; a normal run leaves it a no-op.
if (dryRun) {
  console.log('[DRY-RUN] gate manifest (registry):');
  // #2257: the lanes are structurally contained (L1 ⊂ L2 ⊂ L3 — see the L3 lane
  // below, which runs only AFTER the L1 and L2 bodies), so the manifest must use
  // the same containment. The old `_g.level === level` equality omitted EVERY L2
  // gate from `--dry-run L3`, i.e. the diagnostic that exists to answer "what
  // does this lane run" under-reported the L3 lane by ~40 gates.
  for (const _g of GATE_REGISTRY) {
    if (_LEVELS.indexOf(_g.level) <= _LEVELS.indexOf(level)) {
      console.log(`  ${_g.level}  ${_g.id}  ${_g.name}`);
    }
  }
}
if (only !== null) {
  // --gate accepts a registry id (re-based on the registry) OR the display name
  // (#2078 backward compatibility — the trio matches by name).
  const _regGate = GATE_REGISTRY.find((_g) => _g.id === only);
  if (_regGate) only = _regGate.name;
}
const _inspect = dryRun || only !== null;
setMode({ dryRun, only });

// #2041 (AC-2041.5/6): inline gate bodies bypass the runCheck trio, so they must
// honour the inspection modes themselves — --dry-run prints and spawns NOTHING
// (the #2078 contract: "print-what-would-run, spawn nothing"; a direct spawn
// would also hang an offline consumer), and --gate <id|name> filters to the
// named gate. Returns true when the caller must skip.
function _inlineInspect(_name, _wouldRun) {
  if (dryRun) {
    console.log(`[CHECK] ${_name} ... DRY-RUN (would run: ${_wouldRun})`);
    pushResult(_name, 'SKIP', 0);
    return true;
  }
  if (only !== null && only !== _name) return true;
  return false;
}

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
const _projectLevel = 'L1';
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
console.log(`=== ts-library-fixture Quality Gate: ${level} ===`);
console.log('');



// ─── Gate execution (registry-driven, #2041) ─────────────────────────────────
// Each registry entry renders as a level-conditioned call: L1 gates always run,
// L2 gates run at L2+, L3 gates run at L3+ (the local nightly lane). Language
// and data conditions (emitIf) are resolved at GENERATION time; runtime guards
// (gateFilePresent/existsSync) remain runtime `if` wrappers. Inline gates keep
// their custom JS bodies (declared in the registry so --dry-run/--gate and the
// layering test see them). ORDER IS THE REGISTRY ORDER.


// ── L1 (fast checks — pre-commit) ────────────────────────────────────────
if (true) {






runCheck('PII scan', 'node', ['scripts/pii-scan.mjs']);








runCheck('secret scan', 'node', ['scripts/check-secret-scan.mjs']);








runCheck('typecheck', 'npx', ['tsc', '--noEmit']);








runCheck('format', 'npx', ['prettier', '--check', '.']);








runCheck('lint', 'npx', ['eslint', '.']);






if (gateFilePresent('eslint.config.static.mjs', 'static analysis', '[CHECK] static analysis ... SKIP (run: arbiter update)')) { 

runCheck('static analysis', 'npx', ['eslint', '--config', 'eslint.config.static.mjs', '--no-config-lookup', '--no-error-on-unmatched-pattern', 'src']);
 } 





if (gateFilePresent('eslint.config.no-fake-db.mjs', 'no-fake-db imports (INV-34)')) { 

runCheck('no-fake-db imports (INV-34)', 'npx', ['eslint', '--config', 'eslint.config.no-fake-db.mjs', '--no-config-lookup', '--no-error-on-unmatched-pattern', '.']);
 } 







runCheck('unit tests', 'npm', ['run', 'test:unit']);








if (_inlineInspect('npm-ci drift', 'npx -y npm@<pin> ci --dry-run')) {} else {
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









runCheck('no tracked artifacts (INV-129)', 'node', ['scripts/check-no-tracked-artifacts.mjs']);








runCheck('image pins (#1442)', 'node', ['scripts/check-image-pins.mjs']);








runCheck('e2e quarantine (INV-130)', 'node', ['scripts/check-e2e-quarantine.mjs']);








runCheck('test naming', 'node', ['scripts/check-test-naming.mjs']);








runCheck('min test execution (INV-25)', 'node', ['scripts/check-min-test-execution.mjs']);








runCheck('exit code contract', 'node', ['scripts/check-exit-code-contract.mjs']);








runCheck('pipe/tee hazard', 'node', ['scripts/check-pipe-tee-hazard.mjs']);








runCheck('self-validation drill', 'node', ['scripts/self-validation.mjs']);








runCheck('config drift', 'node', ['scripts/check-drift.mjs']);








runCheck('validator help text', 'node', ['scripts/check-validator-helptext.mjs']);








runCheck('suppressions expiry', 'node', ['scripts/check-suppressions.mjs']);








runCheck('suppression rationale', 'node', ['scripts/check-suppression-rationale.mjs']);








runCheck('suppression expiry (anti-drift)', 'node', ['scripts/check-suppression-expiry.mjs']);








runCheck('inline suppressions', 'node', ['scripts/check-inline-suppressions.mjs']);








runCheck('claude-md lint', 'node', ['scripts/check-claude-md-lint.mjs']);








runCheck('unwired guards', 'node', ['scripts/check-unwired-guards.mjs']);







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








runCheck('ssot core set', 'node', ['scripts/check-ssot-core.mjs']);








runCheck('doc links', 'node', ['scripts/check-doc-links.mjs']);








runCheck('knowledge map', 'node', ['scripts/check-knowledge-map.mjs']);








runCheck('canonical paths', 'node', ['scripts/check-canonical-paths.mjs']);








runCheck('collab mode wired (INV-100)', 'node', ['scripts/check-collab-mode-wired.mjs']);








runCheck('hook routing (#2129)', 'node', ['scripts/check-hook-routing.mjs']);








runCheck('safety adopt ratchet', 'node', ['scripts/check-safety-adopt-ratchet.mjs']);








runCheck('emission parity (#2110)', 'node', ['scripts/check-emission-parity.mjs']);








runCheck('constraint scan (INV-115)', 'node', ['scripts/check-constraint-scan.mjs']);








runCheck('anti-proforma (INV-118)', 'node', ['scripts/check-anti-proforma.mjs']);








runCheck('test pyramid (INV-124)', 'node', ['scripts/check-test-pyramid.mjs']);








runCheck('test scope-tier (INV-124)', 'node', ['scripts/check-test-scope-tier.mjs']);








runCheck('api e2e (INV-126)', 'node', ['scripts/check-api-e2e.mjs']);








runCheck('render smoke presence (INV-127)', 'node', ['scripts/check-render-smoke.mjs']);








runCheck('smoke journeys (INV-137)', 'node', ['scripts/check-smoke-journeys.mjs']);








runCheck('e2e escalation ladder (#2043)', 'node', ['scripts/check-e2e-escalation.mjs']);








runCheck('M16 handoff-contract marker (#2103)', 'node', ['scripts/check-m16-handoff.mjs']);








runCheck('stack conformity (INV-121)', 'node', ['scripts/check-stack-conformity.mjs']);






if (gateFilePresent('scripts/check-iso9001.mjs', 'iso9001 QMS (RTM + doc-control + CAPA)')) { 

runCheck('iso9001 QMS (RTM + doc-control + CAPA)', 'node', ['scripts/check-iso9001.mjs']);
 } 





if (gateFilePresent('scripts/check-regulated-overlay.mjs', 'regulated overlay (SoD + retention + signing + mutation)')) { 

runCheck('regulated overlay (SoD + retention + signing + mutation)', 'node', ['scripts/check-regulated-overlay.mjs']);
 } 







runCheck('muted gate test (anti-fake-green)', 'node', ['scripts/check-muted-test.mjs']);








runCheck('skipped critical e2e (anti-fake-green)', 'node', ['scripts/check-skip-critical-e2e.mjs']);








runCheck('stub redirect husk (anti-fake-green)', 'node', ['scripts/check-no-stub-redirects.mjs']);








runCheck('grace window (anti-fake-green)', 'node', ['scripts/check-grace-window.mjs']);








runCheck('assertion delta (anti-fake-green)', 'node', ['scripts/check-assertion-delta.mjs']);








runCheck('tabletop evidence (#2429)', 'node', ['scripts/check-tabletop-evidence.mjs']);



}
// ── L2 (full checks — pre-push) ──────────────────────────────────────────
if (level !== 'L1') {






runCheck('contract tests', 'npm', ['run', 'test:contract'], { soft: graceActive });








runCheck('integration tests', 'npm', ['run', 'test:integration'], { soft: graceActive });








runCheck('behavioral tests', 'npm', ['run', 'test:behavioral'], { soft: graceActive });






if (gateFilePresent('scripts/check-arc42-slots.mjs', 'arc42 slots (INV-144)')) { 

runWarnCheck('arc42 slots (INV-144)', 'node', ['scripts/check-arc42-slots.mjs']);
 } 







runCheck('tdd-evidence (INV-131)', 'node', ['scripts/check-tdd-evidence.mjs'], { soft: graceActive });








runCheck('todo max-age (INV-133)', 'node', ['scripts/check-todo-max-age.mjs'], { soft: graceActive });



  // ── L2: gate-layering contract test (#2041, AC-2041.3) — asserts the
  // L1 ⊂ L2 ⊂ L3 containment from the embedded registry.
  if (gateFilePresent('scripts/test-gate-layering.mjs', 'gate layering')) {
    runCheck('gate layering', 'node', ['scripts/test-gate-layering.mjs'])
  }
}
// ── L3 (nightly lane — AC-2041.1, mirrors 06-nightly-lite.yml) ───────────
if (level === 'L3' || level === 'L4') {






runCheck('nightly audit (prod scope)', 'npm', ['audit', '--omit=dev', '--audit-level=high'], { soft: graceActive });



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
  // #1441: stamp the task id so the Stop hook can reject a prior task's gate-pass (anti-replay).
  const _taskId = (() => {
    try {
      const _sp = resolve(process.cwd(), '.claude/.task/status.json');
      if (!existsSync(_sp)) return 'unknown';
      const _s = JSON.parse(readFileSync(_sp, 'utf-8'));
      return (typeof _s.taskId === 'string' && _s.taskId.length > 0) ? _s.taskId : 'unknown';
    } catch { return 'unknown'; }
  })();
  // The marker binds tree content, checkout identity, toolchain identity, level
  // and a TTL — not just head_sha + branch + a boolean. A fact that cannot be
  // resolved yields no marker at all: a green gate with no marker is honest, a
  // marker that cannot prove what it describes is not.
  try {
    // Loaded lazily so a project missing the verifier writes NO marker (fail
    // closed) instead of crashing an otherwise-green gate at import time.
    const { buildGateEvidence } = await import('./lib/gate-evidence.mjs');
    const _evidence = buildGateEvidence({ root: process.cwd(), level, taskId: _taskId });
    if (_evidence === null) {
      process.stderr.write(
        'check-all: warning: gate marker NOT written — HEAD, checkout root or tree hash ' +
          'could not be resolved, so nothing can bind this gate result to this tree\n',
      );
    } else {
      const _markerPath = resolve(process.cwd(), '.arbiter/gate-pass.json');
      mkdirSync(dirname(_markerPath), { recursive: true });
      writeFileSync(_markerPath, JSON.stringify(_evidence, null, 2) + '\n');
    }
  } catch (_err) {
    process.stderr.write(`check-all: warning: could not write gate marker: ${_err.message}\n`);
  }
}

if (_failedCount > 0) {
  const _failedResults = _allResults.filter((r) => r.status === 'FAIL' || r.status === 'TIMEOUT');
  console.error(`=== FAILED: ${_failedCount} check(s) ===`);
  console.error('Failed checks:');
  for (const r of _failedResults) console.error(`- ${r.name} (${r.status})`);
  console.error('');
  process.exit(1);
} else {
  console.log('=== ALL PASSED ===\n');
}
