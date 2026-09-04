#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [subcommand] [--level L1|L2|L3] [--json [path]]
//   Subcommands: check (T1 fast, ~2 min), gate (T1+T2, ~10 min, default),
//                full (T1+T2+T3 dry-run, ~35 min),
//                simulate-nightly (T4), simulate-weekly (T5)
//   Back-compat: L1 → check --level L1, L2 → gate --level L2, L3 → gate --level L3
//
// check (T1, "check" subcommand — L1 fast checks): runs the hard + advisory checks
//   registered between the "check: T1 fast checks" and "gate: T1+T2 extended checks"
//   section markers below.
// gate (T1+T2, "gate" subcommand, default): check + the T2 extended checks registered
//   between "gate: T1+T2 extended checks" and "─── Summary" below.
// A prior version of this comment hand-counted the totals (#2042 fixed a ~2x stale
// count and a 25/37-gate-name drift found by audit; #2412 removed the counts entirely
// after they drifted again) — do not hand-copy an enumerated gate list or count here,
// it WILL drift. For the exhaustive, always-current list: grep this file for
// `run(Check|ToolCheck|WarnCheck)(` between the markers below, or run
// `node scripts/check-all.mjs gate --level L2 --json` and inspect the emitted result.
//
// --json [path]: emit gate result JSON to path (default: .arbiter/gate/local-result.json)
//   Writes schema arbiter-gate-v1 with parityContentHash over static check gate subset.
//
// NOTE: this file runs without a build step and cannot import from src/.
// src/ code goes through src/utils/run-cli.ts (INV-12). Gate scripts use the
// helper trinity in scripts/lib/run-helpers.mjs (#351, CANON-01): runCheck (HARD),
// runWarnCheck (informational), runToolCheck (CI-aware tool gate).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minimatch } from 'minimatch'
import {
  runCheck,
  runWarnCheck,
  runToolCheck,
  getResults,
  getFailed,
  setSkippedChecks,
  setOrphanGuard,
  isMainModule,
} from './lib/run-helpers.mjs'
import { GATE_MUTEX_HELD_ENV, gateLockPathFor } from './lib/gate-mutex.mjs'
import { effectiveGateLevel, parseCheckArgs } from './lib/parse-check-args.mjs'
import { GATE_AFFECTS_REGISTRY, GATE_SKIP_BLACKLIST } from './lib/gate-affects-registry.mjs'

// isMain guard so computeSkipped can be imported without running checks.
const isMain = isMainModule(import.meta.url)

/**
 * Compute which checks to skip given a set of changed files (opt-in selective gating).
 * Returns empty Set (= full gate) on any safety-boundary violation.
 */
export function computeSkipped(changedFiles, registry, blacklist) {
  if (!Array.isArray(changedFiles) || changedFiles.length > 500) return new Set()
  for (const f of changedFiles) {
    if (f.startsWith('/') || f.startsWith('../') || f.includes('/../')) return new Set()
  }
  for (const f of changedFiles) {
    for (const pattern of blacklist) {
      if (minimatch(f, pattern, { dot: true })) return new Set()
    }
  }
  const skipped = new Set()
  for (const entry of registry) {
    const affected = changedFiles.some((f) =>
      entry.affects.some((pat) => minimatch(f, pat, { dot: true })),
    )
    if (!affected) skipped.add(entry.name)
  }
  return skipped
}

if (isMain) {
  const parsedArgs = parseCheckArgs(process.argv.slice(2))
  const { subcommand, jsonPath: _parsedJsonPath } = parsedArgs
  const level = effectiveGateLevel(parsedArgs)
  let jsonPath = _parsedJsonPath

  // When the pre-commit hook rsyncs to a temp dir to work around the Vite '#' bug,
  // git-dependent checks (commitlint, docs) must run from the original repo path.
  const GIT_CWD = process.env.ARBITER_HOOK_GIT_CWD

  // ─── #2427: one gate per repo, and never an orphan ──────────────────────────
  // Two L2 runs in one worktree interfered (a half-deleted vitepress temp file
  // broke docs:build; a subprocess-heavy unit test flaked under the doubled
  // load), and the orphan of a killed `git push` went on to stamp a green marker.
  //
  // The mutex is the SAME per-repo flock `arbiter gate-exec` takes — keyed off
  // GIT_CWD when present, because the pre-push '#'-in-path branch runs this file
  // from an rsync'd copy under /tmp and keying off cwd there would derive a fresh
  // key per run, i.e. a null mutex. Re-exec (rather than acquire-in-place) is how
  // a synchronous gate can hold a kernel lock for its whole life; the wrapper
  // publishes ARBITER_GATE_MUTEX_HELD so this branch runs exactly once.
  //
  // Fail-open by design ONLY where there is no repo to key on: a checkout git
  // cannot answer for has no per-repo mutex to take, and refusing to run the
  // gate there would break every non-git consumer for no safety gain — the
  // start/end binding below is what actually prevents the false green.
  const MUTEX_ROOT = GIT_CWD ?? process.cwd()
  if (!process.env[GATE_MUTEX_HELD_ENV]) {
    let lockPath = null
    try {
      lockPath = gateLockPathFor(MUTEX_ROOT)
      // FAIL-OPEN-INTENT: no resolvable repo ⇒ no per-repo mutex exists to take.
    } catch {
      lockPath = null
    }
    if (lockPath !== null) {
      const wrapper = resolve(dirname(fileURLToPath(import.meta.url)), 'lib/gate-mutex.mjs')
      const relayed = spawnSync(
        process.execPath,
        [wrapper, 'run', '--dir', MUTEX_ROOT, '--', process.execPath, ...process.argv.slice(1)],
        { stdio: 'inherit' },
      )
      process.exit(relayed.status ?? 1)
    }
  }

  // Armed for the whole run: between every two checks the gate confirms the
  // process it was launched to serve is still alive, so a SIGKILL'd parent — the
  // one signal nothing can forward — cannot leave a gate measuring a tree nobody
  // is waiting on, let alone stamping evidence for it.
  setOrphanGuard()

  // #2427 AC-1: the identity of the tree this gate is about to measure, sampled
  // BEFORE the first check. `buildGateEvidence` re-measures at the end and
  // refuses to stamp anything if the two disagree — which is exactly what the
  // orphan of a killed push produced: twenty minutes of checks against one tree,
  // a marker naming another. Loaded lazily and tolerantly: a checkout without
  // the verifier simply stamps no marker (fail closed), it does not lose the run.
  const gateStart = await (async () => {
    try {
      const { captureGateStart } = await import('./lib/gate-evidence.mjs')
      return captureGateStart(GIT_CWD ?? process.cwd())
      // FAIL-OPEN-INTENT: null is the REJECTING value — no start means no marker.
    } catch {
      return null
    }
  })()

  // Worktree paths containing '#' break Vite's URL parsing. Create a symlink
  // without '#' and pass VITEST_ROOT so vitest resolves the root from the symlink.
  const _cwd = resolve('.')
  let vitestEnv
  if (_cwd.includes('#')) {
    const sym = '/tmp/arbiter-wt-sym'
    if (!existsSync(sym)) symlinkSync(_cwd, sym)
    vitestEnv = { VITEST_ROOT: sym }
  }

  // Gates excluded from parityContentHash (INV-59): these differ structurally between
  // local and CI environments — PR-only gates or tests run with different selectors.
  const PARITY_EXCLUDE = new Set(['commitlint', 'docs', 'unit tests'])

  // Opt-in selective gating (#2094): local iteration speed only, never a merge
  // gate — CI and any pre-push/pre-merge invocation always run the full,
  // unfiltered gate. ARBITER_SELECTIVE_GATE=1 computes changed files against
  // origin/main — committed AND uncommitted (this is a pre-commit iteration
  // tool; using only `origin/main...HEAD` would see an empty diff before the
  // first commit and skip every check, including ALWAYS-bucket ones) — and
  // skips checks whose affects-registry entry proves untouched.
  const _isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
  if (process.env.ARBITER_SELECTIVE_GATE === '1' && !_isCI) {
    try {
      // Two-dot: merge-base(origin/main, HEAD) vs the CURRENT WORKING TREE —
      // includes staged, unstaged, and committed-since-merge-base changes.
      const trackedDiff = execFileSync('git', ['diff', '--name-only', 'origin/main'], {
        encoding: 'utf-8',
        cwd: GIT_CWD,
        timeout: 6000,
      })
      // git diff never lists untracked files; a brand-new file is still a real change.
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        encoding: 'utf-8',
        cwd: GIT_CWD,
        timeout: 6000,
      })
      const changedFiles = [...trackedDiff.split('\n'), ...untracked.split('\n')]
        .map((s) => s.trim())
        .filter(Boolean)
      // No diff at all vs origin/main => nothing to reason about; run the full
      // gate rather than let an empty changedFiles array read as "skip everything".
      const skipped =
        changedFiles.length === 0
          ? new Set()
          : computeSkipped(changedFiles, GATE_AFFECTS_REGISTRY, GATE_SKIP_BLACKLIST)
      setSkippedChecks(skipped)
      if (skipped.size > 0) {
        process.stdout.write(
          `[selective-gate] ${skipped.size} check(s) skipped (no affected files in diff vs origin/main)\n`,
        )
      }
    } catch (err) {
      // git diff failure (e.g. no origin/main locally, detached HEAD) => full gate, fail safe.
      process.stdout.write(
        `[selective-gate] could not compute diff (${err instanceof Error ? err.message : String(err)}) — running full gate\n`,
      )
    }
  }

  process.stdout.write('\n')
  process.stdout.write(`=== arbiter Quality Gate: ${subcommand} [${level}] ===\n`)
  process.stdout.write('\n')

  // ─── check: T1 fast checks ───────────────────────────────────────────────────
  runCheck('build-kit', 'node', ['scripts/build-kit.mjs'])
  runCheck('no redacted tokens', 'node', ['scripts/check-no-redacted-tokens.mjs'])
  runCheck('no work refs', 'node', ['scripts/check-no-work-refs.mjs', 'all'])
  runCheck('private paths ignored', 'node', ['scripts/check-private-paths-ignored.mjs'])
  runCheck('no tracked artifacts (INV-117)', 'node', ['scripts/check-no-tracked-artifacts.mjs'])
  // #2159: found unwired by check-unwired-guards.mjs's own self-run — an
  // UNCONDITIONAL_EMISSIONS sibling of check-collab-mode-wired/check-constraint-scan/
  // check-no-tracked-artifacts (all wired above/below) that was never wired into
  // arbiter's own gate. Validates arbiter's OWN .claude/hooks routing (#2129).
  runCheck('hook routing (#2129)', 'node', ['scripts/check-hook-routing.mjs'])
  // #2291: arbiter shipped this ratchet to consumers without running it itself. It is
  // the gate that catches a gate spine frozen by `update` — and the reason it never
  // fired anywhere is that it was delivered only THROUGH the spine it polices. Wiring
  // it here (and, for consumers, as its own 01-pr-fast.yml step) is the dogfood half.
  runCheck('safety adopt ratchet (#2291)', 'node', ['scripts/check-safety-adopt-ratchet.mjs'])
  runCheck('typecheck', 'npx', ['tsc', '--noEmit'])
  runCheck('format', 'npx', ['prettier', '--check', '.'])
  // #1523: scripts/ (the gate-enforcement layer) is linted alongside src/ and
  // __tests__/ so the enforcer is held to the same dead-code bar it imposes.
  runCheck('lint', 'npx', ['eslint', 'src', '__tests__', 'scripts'])
  // #2085 (fail-fast ordering): the expensive vitest suites (unit tests, greenfield
  // smoke) are deferred to the END of the L1 block — after the cheap static/lint
  // gates above and the near-instant check-*.mjs gates below — so a fast failure
  // (lint, format, typecheck, a static check) surfaces in the output stream first
  // and the operator can abort sooner. Pure reordering: the checks stay inside the
  // L1 partition (before l1EndIdx), so parityContentHash/contentHash (both sorted
  // by name) and the `check`-subcommand set are byte-identical.
  runCheck('circular deps', 'npx', ['madge', '--circular', '--extensions', 'ts,tsx,js,jsx', 'src/'])
  runCheck('placeholders', 'node', ['scripts/check-no-placeholders.mjs', 'src'])
  runCheck('i18n raw strings', 'node', [
    'scripts/check-no-raw-strings.mjs',
    'src',
    '--inventory',
    '__tests__/i18n/_migration-inventory.json',
  ])
  runCheck('spdx headers', 'node', ['scripts/check-spdx-headers.mjs'])
  runCheck('orphan TODOs', 'node', ['scripts/check-no-orphan-todo.mjs'])
  runCheck('no direct-fs outside the façade', 'node', ['scripts/check-no-direct-fs.mjs'])
  runCheck('PII scan', 'node', ['scripts/pii-scan.mjs'])
  runCheck('inline suppressions', 'node', ['scripts/check-inline-suppressions.mjs'])
  runCheck('suppressions expiry', 'node', ['scripts/check-suppressions.mjs'])
  runCheck('commitlint', 'npx', ['commitlint', '--from', 'origin/main', '--to', 'HEAD'], {
    cwd: GIT_CWD,
  })
  runCheck('test naming', 'node', ['scripts/check-test-naming.mjs'])
  runCheck('hardness inventory', 'node', ['scripts/check-hardness-inventory.mjs'])
  // #2326: the SAME checker aimed at arbiter's OWN materialized hooks. The line above
  // covers the TEMPLATE pair only, so a defect living solely in `.claude/hooks/` was
  // invisible to every hook check we had — the blind spot that let #2324 run 18 days.
  // Distinct name: parity gates are keyed by name, and a duplicate would let the passing
  // template run mask a failing self run. Measured ~1.6s.
  runCheck('hardness inventory (self hooks)', 'node', [
    'scripts/check-hardness-inventory.mjs',
    '--manifest',
    '.arbiter/self-hooks-manifest.json',
    '--hooks-dir',
    '.claude/hooks',
  ])
  runCheck('docs', 'node', ['scripts/check-docs.mjs'], { cwd: GIT_CWD })
  runCheck('install command (B1)', 'node', ['scripts/check-install-command.mjs'])
  runCheck('tool claims', 'node', ['scripts/check-tool-claims.mjs'])
  runCheck('third-party licenses', 'node', ['scripts/gen-third-party-licenses.mjs', '--check'])
  runCheck('matrix fixtures', 'node', ['scripts/check-matrix-fixtures.mjs'])
  runCheck('matrix proven cells', 'node', ['scripts/check-matrix-proven-cells.mjs'])
  runCheck('skills-matrix-schema', 'node', ['scripts/check-skills-matrix.mjs'])
  // #2429: a tabletop is high-recall/low-precision, so every blocker/major finding must
  // terminate in an owner. Vacuous when .arbiter/evidence/tabletop/ holds nothing.
  runCheck('tabletop evidence (#2429)', 'node', ['scripts/check-tabletop-evidence.mjs'])
  runCheck('template tests', 'node', ['scripts/check-template-tests.mjs'])
  runCheck('generator tests', 'node', ['scripts/check-generator-tests.mjs'])
  runCheck('command tests', 'node', ['scripts/check-command-tests.mjs'])
  runCheck('brownfield tests (CANON-11)', 'node', ['scripts/check-brownfield-tests.mjs'])
  runCheck('catalog parity', 'node', ['scripts/check-catalog-agents-parity.mjs'])
  runCheck('global-invariants parity', 'node', [
    'scripts/check-global-invariants-parity.mjs',
    '--config=arbiter.json',
  ])
  runCheck('kit catalog parity', 'node', ['scripts/check-kit-catalog-parity.mjs'])
  runCheck('enforcement wired', 'node', ['scripts/check-inv-enforcement-wired.mjs'])
  // #1410: advisory — report check-*.mjs gates not reachable from check-all.mjs
  // (orphan gates). Report-only (exit 0); promotion to blocking is a tracked follow-up.
  runWarnCheck('orchestrator coverage (#1410)', 'node', ['scripts/check-orchestrator-coverage.mjs'])
  runCheck('constraint scan (INV-115)', 'node', ['scripts/check-constraint-scan.mjs'])
  runCheck('agent-dispatch matrix (#1267)', 'node', ['scripts/check-agent-dispatch.mjs'])
  runCheck('wiki lint (INV-116)', 'node', ['scripts/check-wiki-lint.mjs'])
  runCheck('node version ssot', 'node', ['scripts/check-node-version-ssot.mjs'])
  runCheck('bloat ratchet', 'node', ['scripts/check-bloat-ratchet.mjs'])
  runCheck('exit code contract', 'node', ['scripts/check-exit-code-contract.mjs'])
  runCheck('pipe/tee hazard', 'node', ['scripts/check-pipe-tee-hazard.mjs'])
  runCheck('ssot core', 'node', ['scripts/check-ssot-core.mjs'])
  runCheck('doc links', 'node', ['scripts/check-doc-links.mjs'])
  runCheck('governance mirror sync (#1805)', 'node', ['scripts/check-governance-mirror-sync.mjs'])
  runCheck('doc style', 'node', ['scripts/check-doc-style.mjs'])
  // #2387: the orchestration surface drifts in two ways models obey literally — a skill or
  // agent name with no file behind it, and a mandatory ceremony step re-marked optional.
  runCheck('orchestration integrity (#2387)', 'node', ['scripts/check-orchestration-integrity.mjs'])
  runCheck('claude-md lint (#1266)', 'node', ['scripts/check-claude-md-lint.mjs'])
  runCheck('doc index (#1102)', 'node', ['scripts/gen-doc-index.mjs', '--check'])
  runCheck('llms.txt drift (#1721)', 'node', ['scripts/gen-llms-txt.mjs', '--check'])
  runCheck('status dashboard', 'node', ['scripts/gen-status.mjs', '--check'])
  // F2 (#1838, item 6): derived website pages (experiments table, kit count)
  // are generator-emitted; hand-edits or registry drift fail here.
  runCheck('derived pages (#1838)', 'node', ['scripts/gen-derived-pages.mjs', '--check'])
  runCheck('gap register', 'node', ['scripts/gen-gap.mjs', '--check'])
  runCheck('ssot core index (#1100)', 'node', ['scripts/gen-ssot-core.mjs', '--check'])
  runCheck('adr index (INV-107)', 'node', ['scripts/check-adr-index.mjs'])
  runCheck('adr digest (INV-107)', 'node', ['scripts/gen-adr-readme.mjs', '--check'])
  runCheck('adr enforcement linkage (#1473)', 'node', ['scripts/check-adr-enforcement.mjs'])
  // #2419 AC-2: promoted from runWarnCheck at L2. The police for advisory-forever gates was
  // itself an advisory gate in the partition a commit never runs, so an expired promoteBy could
  // not fail anything. Hard, and at L1 — an amnesty that lapses reds the very next commit.
  runCheck('bypass ceremony (E4 #1949)', 'node', ['scripts/check-bypass-ceremony.mjs'])
  runCheck('cli ref parity (INV-111)', 'node', ['scripts/gen-cli-ref.mjs', '--check'])
  // F2 (#1838, item 4): extends INV-111 beyond the generated cli.md region —
  // hand-authored prose (PRIVACY.md, docs/, website/) can cite a phantom
  // command without ever touching that region.
  runCheck('phantom command scan (INV-111 ext, #1838)', 'node', [
    'scripts/check-phantom-command-scan.mjs',
  ])
  // AC-2243.2 (#2243): advisory — a first-pass scan of dead repo-path
  // citations in prose (`src/ship/fix-on-red.ts` class). Proven correct on
  // synthetic fixtures; the real-corpus false-positive surface (relative-path
  // placeholders, optional-tool paths like graphify-out/) is not yet fully
  // triaged, so this reports rather than blocks. Promotion to a hard check is
  // a tracked follow-up once a full-corpus pass confirms zero false positives.
  runCheck('doc path citations (#2243)', 'node', ['scripts/check-doc-path-citations.mjs'])
  // F2 (#1838, item 5): package.json / --version / CHANGELOG.md three-way
  // agreement — the permanent gate promised in the F1 fix for #1837.
  runCheck('version parity (#1838)', 'node', ['scripts/check-version-parity.mjs'])
  runCheck('phase doc consistency (INV-113)', 'node', ['scripts/check-phase-doc-consistency.mjs'])
  // INV-138: acceptance-criteria anchor — flag-gated (features.acceptanceAnchor),
  // vacuous without an active task, so main/CI/fresh clones stay green.
  runCheck('acceptance anchor (INV-138)', 'node', ['scripts/check-acceptance.mjs'])
  runCheck('canonical paths', 'node', ['scripts/check-canonical-paths.mjs'])
  runCheck('canon references', 'node', ['scripts/check-canon-references.mjs'])
  runCheck('canon enforcement parity (B1)', 'node', ['scripts/check-canon-enforcement-parity.mjs'])
  // #1923 (CANON-15): every template emitting a linter/scanner/boundary config must
  // also emit the gate step that invokes it — a config with no invocation is a paper rule.
  runCheck('canon-15 wired gate (#1923)', 'node', ['scripts/check-canon15-wired-gate.mjs'])
  runCheck('plugin api stability', 'node', ['scripts/check-plugin-api-stability.mjs'])
  runCheck('deprecations', 'node', ['scripts/check-deprecations.mjs'])
  runCheck('hook contracts', 'node', ['scripts/check-hook-contracts.mjs'])
  runCheck('api snapshot', 'node', ['scripts/check-api-snapshot.mjs'])
  runCheck('ci tiers (INV-73)', 'node', ['scripts/check-ci-tiers.mjs'])
  runCheck('action pin parity', 'node', ['scripts/sync-action-pins.mjs', '--check'])
  runCheck('action pin sha (INV-76)', 'node', ['scripts/check-action-pins.mjs'])
  runCheck('runtime dep pins (#1557)', 'node', ['scripts/check-runtime-dep-pins.mjs'])
  // #1684: npm-ci lockfile-drift gate — `npm ci` parity UNDER THE PINNED npm
  // (package.json#packageManager), invoked as npx npm@<pin> NOT ambient npm so the
  // local-npm-11 vs CI-npm-10 lock skew that breaks `npm ci` repo-wide is caught pre-merge.
  runCheck('npm-ci drift (#1684)', 'node', ['scripts/check-npm-ci-drift.mjs'])
  // Workflow hardening report (gold-audit D-ACTIONS value-report source) — emits
  // .arbiter/reports/workflow-hardening.json. MUST precede the gold-audit no-regress check
  // below so the D-ACTIONS value checks read a fresh report (absent ⇒ NA ⇒ yCount regress).
  runCheck('workflow hardening (INV-76/95)', 'node', ['scripts/check-workflow-hardening.mjs'])
  // Gold-audit no-regress + false-gap + registry validation. Relocated here (after the
  // 'doc links' and 'workflow hardening' report generators) so the D-DOCS/D-ACTIONS value
  // checks evaluate against fresh .arbiter/reports/*.json rather than absent (NA) reports.
  runCheck('gold-audit no-regress (#1373)', 'node', [
    'scripts/gold-audit.mjs',
    '--check',
    '--require-baseline',
  ])
  runCheck('gold-audit false-gap (#1373)', 'node', ['scripts/gold-audit.mjs', '--strict'])
  runCheck('gold registries no-false-gap (#1413)', 'node', ['scripts/check-gold-registries.mjs'])
  runToolCheck('actionlint', 'actionlint', [])
  // Local↔CI parity guards (#1244 follow-up): keep the gate's external tools pinned
  // and installable locally, and keep permission tests root-guarded — the two
  // classes (besides the spawn buffer) that let local-green hide CI-red.
  runCheck('ci tool parity', 'node', ['scripts/check-ci-tool-parity.mjs'])
  runCheck('perm-test guards', 'node', ['scripts/check-perm-test-guards.mjs'])
  // ─── L1: Anti-drift validator family (INV-89, W6) ────────────────────────────
  runCheck('anti-drift: suppression rationale', 'node', ['scripts/check-suppression-rationale.mjs'])
  runCheck('anti-drift: suppression expiry', 'node', ['scripts/check-suppression-expiry.mjs'])
  runCheck('anti-drift: pii scan config', 'node', ['scripts/check-pii-scan.mjs'])
  runCheck('anti-drift: secret scan', 'node', ['scripts/check-secret-scan.mjs'])
  runCheck('anti-drift: drift manifest', 'node', ['scripts/check-drift.mjs'])
  runCheck('anti-drift: workflow runners', 'node', ['scripts/check-workflow-runners.mjs'])
  runCheck('anti-drift: docker action runner safety (#1756)', 'node', [
    'scripts/check-docker-action-runner-safety.mjs',
  ])
  runCheck('anti-drift: workflow docs sync', 'node', ['scripts/check-workflow-docs-sync.mjs'])
  runCheck('anti-drift: workflow integrity', 'node', ['scripts/check-workflow-test-integrity.mjs'])
  runCheck('anti-drift: workflow parallelism (INV-120)', 'node', [
    'scripts/check-workflow-parallelism.mjs',
  ])
  runCheck('anti-drift: pr size gate', 'node', ['scripts/check-pr-size-gate.mjs'])
  runCheck('anti-drift: unwired guards (#2159)', 'node', ['scripts/check-unwired-guards.mjs'])
  runCheck('anti-drift: validator helptext', 'node', ['scripts/check-validator-helptext.mjs'])
  runCheck('anti-drift: tier coverage', 'node', ['scripts/check-tier-coverage.mjs'])
  runCheck('nightly freshness (INV-93)', 'node', ['scripts/check-nightly-freshness.mjs'])
  runCheck('monthly freshness (INV-82)', 'node', ['scripts/check-monthly-freshness.mjs'])
  runCheck('deploy cosign supply-chain (INV-95/97/98)', 'node', [
    'scripts/check-workflow-cosign.mjs',
  ])
  runCheck('no passWithNoTests (INV-25)', 'node', ['scripts/check-no-passwithnotests.mjs'])
  runCheck('collab mode wired (INV-100)', 'node', ['scripts/check-collab-mode-wired.mjs'])
  runCheck('merge method ff-only (INV-101)', 'node', ['scripts/check-merge-method.mjs'])
  runCheck('settings coverage (#1121)', 'node', ['scripts/check-settings-coverage.mjs'])
  runCheck('methodology coverage (#2039)', 'node', ['scripts/check-methodology-coverage.mjs'])
  // F2 (#1838, item 1): CANON-10 promoted from "prose — checked at PR review"
  // to a wired gate — every hook in .claude/settings.json must be documented
  // in .claude/CLAUDE.md's hooks table, and vice versa.
  runCheck('hook doc parity (CANON-10, #1838)', 'node', ['scripts/check-hook-doc-parity.mjs'])
  runCheck('feature matrix (INV-112)', 'node', ['scripts/check-feature-matrix.mjs', '--check'])
  // #2007: --enforce, not warn-default. Without it the scanner exits 0 even while printing
  // findings, so runCheck recorded PASS on a gate that had just reported violations — the
  // masked-PASS class. Flipped only after #2031 removed the scanner's three false-positive
  // classes; enforcing a scanner that cries wolf is worse than not enforcing at all.
  runCheck('anti-proforma (INV-118)', 'node', ['scripts/check-anti-proforma.mjs', '--enforce'])
  runCheck('anti-fake-green (#1412)', 'node', ['scripts/check-anti-fake-green.mjs'])
  runCheck('fixture isolation (INV-139)', 'node', ['scripts/check-fixture-isolation.mjs'])
  runCheck('test pyramid (INV-124)', 'node', ['scripts/check-test-pyramid.mjs'])
  runCheck('test scope-tier (INV-124)', 'node', ['scripts/check-test-scope-tier.mjs'])
  runCheck('domain-api surface (INV-125)', 'node', ['scripts/check-domain-api-surface.mjs'])
  runCheck('api e2e (INV-126)', 'node', ['scripts/check-api-e2e.mjs'])
  runCheck('render smoke presence (INV-127)', 'node', ['scripts/check-render-smoke.mjs'])
  runCheck('smoke journeys (INV-137)', 'node', ['scripts/check-smoke-journeys.mjs'])
  runCheck('M16 handoff-contract marker (#2103)', 'node', ['scripts/check-m16-handoff.mjs'])
  runCheck('e2e escalation ladder (#2043)', 'node', ['scripts/check-e2e-escalation.mjs'])
  runCheck('workflow cache strategy (§17.5 rec 3)', 'node', [
    'scripts/check-workflow-cache-strategy.mjs',
  ])
  runCheck('build-cache strategy (C3)', 'node', ['scripts/check-build-cache-strategy.mjs'])
  // #1744 (INV-45): template<->materialized drift is caught at COMMIT time, not push time.
  runCheck('dogfood', 'node', ['scripts/check-self-dogfood.mjs'])
  // #1922 (CANON-01): the REVERSE direction of dogfood — every self mechanism maps to a
  // template emission, a motivated divergence, or a reasoned self-only entry, + count ratchet.
  runCheck('canon-01 declination (#1922)', 'node', ['scripts/check-canon01-declination.mjs'])
  // #2222: cheap (~2s) check catches example drift at commit time instead of after the weekly lane.
  runCheck('examples drift (#2222)', 'node', ['scripts/regenerate-examples.mjs', '--check'])
  // #2415: the examples are the only place arbiter can read its own emissions the way a
  // consumer does — every script/command/hook an emitted playbook cites must resolve in the
  // tree that ships it, not in arbiter's. Runs right after the drift check, on the same corpus.
  runCheck('emitted markdown refs (#2415)', 'node', ['scripts/check-emitted-markdown-refs.mjs'])

  // #2085 (fail-fast ordering): expensive vitest suites run LAST in L1, after every
  // cheap static/lint/check-*.mjs gate above, so quick failures surface first. Still
  // inside the L1 partition (captured by l1EndIdx below) → hash- and set-invariant.
  // The shared helper scales the measured 24-core timeout budget to the local
  // core count (#2370); all suite-shaped steps use the same portability rule.
  runCheck('unit tests', 'npm', ['test'], vitestEnv ? { env: vitestEnv } : {})
  runCheck(
    'greenfield smoke',
    'npx',
    [
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      '__tests__/integration/init-greenfield-smoke.test.ts',
    ],
    vitestEnv ? { env: vitestEnv } : {},
  )

  // Capture L1 boundary for parityContentHash computation (INV-59)
  const l1EndIdx = getResults().length

  // Bake golden masters (e2e/bake/fixture-bake.test.ts, 27 fixtures) are gated by the L2
  // integration suite (INV-25), hence at pre-push and in CI (#2190), but stay out of L1:
  // they run `arbiter init` 27 times — far too expensive for the every-commit partition.

  // ─── gate: T1+T2 extended checks ─────────────────────────────────────────────
  if (subcommand !== 'check') {
    const coverageRunStartedAt = Date.now()
    runCheck('coverage', 'npm', ['test', '--', '--coverage'], vitestEnv ? { env: vitestEnv } : {})
    // Coverage no-regression ratchet (#1483): runs right after coverage, reading the
    // coverage/coverage-summary.json the run above emits (json-summary reporter). Fails if any
    // of lines/branches/functions/statements drops below the .coverage-baseline.json floor.
    runCheck('coverage ratchet (#1483)', 'node', ['scripts/check-coverage-ratchet.mjs'])
    // When running from rsync'd temp dir on behalf of a '#'-path worktree,
    // VitePress cannot resolve workspace paths; degrade to warn (CI validates).
    const docsCheck = process.env.ARBITER_HOOK_GIT_CWD?.includes('#') ? runWarnCheck : runCheck
    // #1807: this gate only needs to know the website BUILDS — it must never
    // write into the working tree to find out. Plain `docs:build` starts with
    // `sync-public-governance.mjs`, an unconditional copyFileSync(AGENTS.md ->
    // website/governance/AGENTS.md) with no --check mode, so running it here
    // mutated a tracked file mid-gate in a worktree whose mirror had drifted
    // (uncommitted side effect the operator had to `git checkout --` away).
    // `docs:build:verify` (build only) is read-only; drift in the mirror is
    // already caught by the dedicated 'governance mirror sync (#1805)' check
    // above (line ~163) — that hard-fails BEFORE this one ever needs to run.
    docsCheck('docs:build', 'npm', ['run', 'docs:build:verify'])
    runCheck('dead code', 'npx', ['knip'])
    // Fail-closed wrapper: bare `npx jscpd --silent` exits 0 on a 0-file scan
    // under v5, making the gate vacuous on fileset drift (#1286).
    runCheck('duplication', 'node', ['scripts/check-duplication.mjs'])
    // #2428: local SKILL.md/command corpus vs the committed companion-line-hash snapshot
    // (never live network — --refresh-hashes is a separate, manual, fail-closed-offline step).
    runCheck('skill provenance (#2428)', 'node', ['scripts/check-skill-provenance.mjs'])
    runCheck('audit', 'npm', ['audit', '--omit=dev', '--audit-level=high'])
    // Consumer-resolution audit (#1718, follow-up to #1670 parts 2&3): the dev-tree
    // `audit` step above sees npm `overrides`, which npm silently drops for anyone
    // who installs @arbiter/cli as a dependency. This packs the publishable tarball,
    // installs it into a throwaway root with no repo overrides/devDeps, and audits
    // THAT tree at a stricter `moderate` floor — closing the structural blind spot.
    runCheck('consumer audit', 'node', ['scripts/check-consumer-audit.mjs'])
    // --log-opts=HEAD (#1908): default gitleaks scans ALL refs in the local
    // object DB (every branch you've ever fetched), not just this one — so an
    // unrelated branch's commit can fail the gate on a checkout that has
    // nothing to do with it. Scoping to HEAD keeps full-history depth for the
    // ref actually being validated, matching the CI 01-pr-fast.yml gitleaks step.
    runCheck('gitleaks', 'gitleaks', [
      'detect',
      '--source',
      '.',
      '--config',
      '.gitleaks.toml',
      '--gitleaks-ignore-path',
      'suppressions/.gitleaksignore',
      '--log-opts=HEAD',
      '--exit-code',
      '1',
    ])
    runCheck('emission coherence (INV-123)', 'node', ['scripts/check-emission-coherence.mjs', '.'])
    runCheck('debt ratchet', 'node', [
      'scripts/debt-report.mjs',
      '--gate',
      '--coverage-summary',
      'coverage/coverage-summary.json',
      '--coverage-started-at',
      String(coverageRunStartedAt),
    ])
    runCheck('STRIDE/RACI traceability', 'node', ['scripts/check-stride-traceability.mjs'])
    runCheck('self-validation drill', 'node', ['scripts/self-validation.mjs'])
    runCheck('local-ci parity', 'node', ['scripts/check-local-ci-parity.mjs'])
    runCheck('id stability', 'node', ['scripts/check-id-stability.mjs'])
    runCheck('anti-telemetry', 'node', ['scripts/check-anti-telemetry.mjs'])
    runCheck('tdd-evidence', 'node', ['scripts/check-tdd-evidence.mjs'])
    // ADR-106 (#1966): codex-track parity contract — derive-from-Claude rules,
    // 100% classified parity surface, generated Known Limitations, merge-base
    // baseline anti-shrinkage. Bakes a fixture via the real CLI (init).
    runCheck('codex parity (#1966)', 'node', ['scripts/check-codex-parity.mjs'])
    // ADR-106 addendum (#1966): self-track — arbiter's OWN materialized .agents/.codex
    // must stay normalized-equivalent to its own generator's emission (skipIfExists rot).
    runCheck('codex self-parity (#1966)', 'node', ['scripts/check-codex-self-parity.mjs'])
    // INV-133 (#1456): over-age linked task-marker gate. SKIPs offline / no token.
    runCheck('todo max-age', 'node', ['scripts/check-todo-max-age.mjs'])
    runCheck('evidence-bundle', 'node', ['scripts/check-evidence-bundle.mjs'])
    // E1-E6a #1943 (anti-context-rot enforcers, advisory at land-time per design §0; promote
    // to runCheck at gated-review). Vacuous-pass when no evidence — wired now so the path is real.
    runWarnCheck('agent-return envelope (E1 #1943)', 'node', ['scripts/check-agent-return.mjs'])
    runWarnCheck('cross-model review (#2358)', 'node', ['scripts/check-cross-model-review.mjs'])
    // #2435 AC-2: promoted from runWarnCheck. `refactor` promises a code-review dispatch and
    // nothing could fail a build over it, so a ship reached `verification` with no review ever
    // dispatched. The check vacuous-passes with no sidecar for this task/branch, so the
    // promotion costs nothing where no review was owed and refuses where one was.
    runCheck('review completion (#2177)', 'node', ['scripts/check-review-completion.mjs'])
    runWarnCheck('refutation majority (E2 #1943)', 'node', [
      'scripts/check-refutation-verdicts.mjs',
    ])
    runWarnCheck('audit dry-pass (E3 #1943)', 'node', ['scripts/check-audit-dry-pass.mjs', '--all'])
    runWarnCheck('handoff lint (E6a #1943)', 'node', ['scripts/check-handoff-doc.mjs'])
    // bypass ceremony (E4 #1949) moved to the L1 partition as a hard check — see #2419 AC-2.
    // reuse survey (INV-70, #2079): advisory pending the start-warn→promote decision (#2044 item c).
    runWarnCheck('reuse survey (INV-70)', 'node', ['scripts/check-reuse-survey.mjs'])
    runCheck('commit-footer rationale (INV-119)', 'node', [
      'scripts/check-commit-footer-rationale.mjs',
    ])
    runCheck('fail-closed audit (INV-96)', 'node', ['scripts/check-fail-closed-audit.mjs'])
    runCheck('script cohesion (INV-94)', 'node', ['scripts/check-script-cohesion.mjs'])
    // INV-25 (#1039): full integration suite in L2 gate — 19 files, not just smoke
    runCheck(
      'integration suite (INV-25)',
      'npx',
      ['vitest', 'run', '--config', 'vitest.integration.config.ts', '--silent'],
      vitestEnv ? { env: vitestEnv } : {},
    )
    // INV-25 (#1040): BDD layer
    runCheck('BDD suite (INV-25)', 'npm', ['run', 'test:bdd'])

    // Advisory (#1397/C5): conformance scorecard ratchet — informational, never blocks gate.
    // The script is committed in arbiter itself, so a missing file must fail rather than vanish.
    runWarnCheck('conformance', 'node', ['scripts/conformance.mjs', '--check'])

    // Strict (#1481/INV-135): doc-set mandatory-doc completeness — a missing mandatory doc
    // fails the gate (--strict). Recommended-tier gaps remain advisory inside the script.
    runCheck('doc-set presence', 'node', ['scripts/check-doc-set.mjs', '--strict'])
  }

  // ─── Summary ─────────────────────────────────────────────────────────────────
  const results = getResults()
  const failed = getFailed()

  process.stdout.write('\n')
  process.stdout.write('=== Summary ===\n')
  process.stdout.write('\n')

  const nameWidth = Math.max(6, ...results.map((r) => r.name.length))
  const header = `${'Check'.padEnd(nameWidth)}  Status  Elapsed`
  const divider = '-'.repeat(header.length)
  process.stdout.write(String(header) + '\n')
  process.stdout.write(String(divider) + '\n')
  let totalElapsed = 0
  for (const r of results) {
    totalElapsed += r.elapsed
    process.stdout.write(`${r.name.padEnd(nameWidth)}  ${r.status.padEnd(6)}  ${r.elapsed}ms
`)
  }
  process.stdout.write(String(divider) + '\n')
  process.stdout.write(`${'Total'.padEnd(nameWidth)}          ${totalElapsed}ms
`)
  process.stdout.write('\n')

  // ─── Gate result JSON (INV-59) ────────────────────────────────────────────────
  {
    const l1Gates = results.slice(0, l1EndIdx)
    const parityGates = l1Gates
      .filter((r) => !PARITY_EXCLUDE.has(r.name))
      .map((r) => ({ name: r.name, pass: r.status === 'PASS' }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const parityContentHash = createHash('sha256').update(JSON.stringify(parityGates)).digest('hex')

    const allForHash = results
      .map((r) => ({ name: r.name, pass: r.status === 'PASS' }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const contentHash = createHash('sha256').update(JSON.stringify(allForHash)).digest('hex')

    const artifact = {
      schema: 'arbiter-gate-v1',
      node: process.version,
      level,
      gates: results.map((r) => ({
        name: r.name,
        pass: r.status === 'PASS',
        // #2052: `pass` alone collapses SKIP into the same false as FAIL —
        // `status` keeps the full PASS/FAIL/TIMEOUT/WARN/SKIP distinction visible to
        // JSON consumers, not just the console summary table.
        status: r.status,
        durationMs: r.elapsed,
      })),
      parityGates,
      pass: failed === 0,
      parityContentHash,
      contentHash,
    }

    const outPath =
      jsonPath !== null && jsonPath !== ''
        ? jsonPath
        : resolve(GIT_CWD ?? process.cwd(), '.arbiter/gate/local-result.json')

    try {
      mkdirSync(dirname(outPath), { recursive: true })
      writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n')
    } catch (err) {
      process.stderr.write(
        `check-all: warning: could not write gate result to ${outPath}: ${err.message}\n`,
      )
    }
  }

  if (failed === 0) {
    try {
      const root = GIT_CWD ?? process.cwd()
      // #1441: stamp the task id so the fail-closed Stop hook can reject a prior
      // task's gate-pass on the same branch (anti-replay, beyond branch+sha).
      const taskId = (() => {
        try {
          const statusPath = resolve(root, '.claude/.task/status.json')
          if (!existsSync(statusPath)) return 'unknown'
          const s = JSON.parse(readFileSync(statusPath, 'utf-8'))
          return typeof s.taskId === 'string' && s.taskId.length > 0 ? s.taskId : 'unknown'
        } catch {
          return 'unknown'
        }
      })()
      // #2328: the marker binds tree content, checkout identity, toolchain
      // identity, level and a TTL — not just head_sha + branch + a boolean.
      // A fact that cannot be resolved yields no marker at all: a green gate
      // with no marker is honest, a marker that cannot prove what it describes
      // is not.
      // Loaded lazily so a checkout missing the verifier writes NO marker (fail
      // closed) instead of crashing an otherwise-green gate at import time.
      const { buildGateEvidence } = await import('./lib/gate-evidence.mjs')
      // #2427: `gateStart` is the identity captured before the first check ran.
      // buildGateEvidence returns null when it is missing, incomplete, or no
      // longer matches the tree — a green gate with no marker is honest, a
      // marker for a tree the gate did not measure end to end is not.
      const evidence = buildGateEvidence({ root, level, taskId, start: gateStart })
      if (evidence === null) {
        process.stderr.write(
          'check-all: warning: gate marker NOT written — HEAD, checkout root or tree hash ' +
            'could not be resolved, or the commit/tree moved while the gate was running, ' +
            'so nothing can bind this gate result to this tree (#2427)\n',
        )
      } else {
        const markerPath = resolve(root, '.arbiter/gate-pass.json')
        mkdirSync(dirname(markerPath), { recursive: true })
        writeFileSync(markerPath, JSON.stringify(evidence, null, 2) + '\n')
      }
    } catch (err) {
      process.stderr.write(`check-all: warning: could not write gate marker: ${err.message}\n`)
    }
  }

  if (failed > 0) {
    const failedResults = results.filter((r) => r.status === 'FAIL' || r.status === 'TIMEOUT')
    console.error(`=== FAILED: ${failed} check(s) ===`)
    console.error('Failed checks:')
    for (const r of failedResults) console.error(`- ${r.name} (${r.status})`)
    console.error('')
    process.exit(1)
  } else {
    process.stdout.write('=== ALL PASSED ===\n\n')
  }
} // end isMain
