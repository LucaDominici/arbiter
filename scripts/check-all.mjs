#!/usr/bin/env node
// arbiter quality gate
// Usage: node scripts/check-all.mjs [subcommand] [--level L1|L2|L3] [--json [path]]
//   Subcommands: check (T1 fast, ~2 min), gate (T1+T2, ~10 min, default),
//                full (T1+T2+T3 dry-run, ~35 min),
//                simulate-nightly (T4), simulate-weekly (T5)
//   Back-compat: L1 → check --level L1, L2 → gate --level L2, L3 → gate --level L3
//
// check (T1, "check" subcommand — L1 fast checks): 113 hard checks (runCheck/runToolCheck)
//   + 1 advisory (runWarnCheck), as of #2042.
// gate (T1+T2, "gate" subcommand, default): check + T2 extended checks, cumulative total
//   138 hard checks + 7 advisory, as of #2042.
// These counts are hand-maintained (#2042 fixed a ~2x stale count and a 25/37-gate-name
// drift found by audit) — do not hand-copy an enumerated gate list here, it WILL drift.
// For the exhaustive, always-current list: grep this file for `run(Check|ToolCheck|WarnCheck)(`
// between the "check: T1 fast checks" and "─── Summary" section markers below, or run
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
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minimatch } from 'minimatch'
import { runCheck, runWarnCheck, runToolCheck, getResults, getFailed } from './lib/run-helpers.mjs'
import { parseCheckArgs } from './lib/parse-check-args.mjs'

// isMain guard so computeSkipped can be imported without running checks.
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

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
  const { subcommand, level, jsonPath: _parsedJsonPath } = parseCheckArgs(process.argv.slice(2))
  let jsonPath = _parsedJsonPath

  // When the pre-commit hook rsyncs to a temp dir to work around the Vite '#' bug,
  // git-dependent checks (commitlint, docs) must run from the original repo path.
  const GIT_CWD = process.env.ARBITER_HOOK_GIT_CWD

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

  process.stdout.write('\n')
  process.stdout.write(`=== arbiter Quality Gate: ${subcommand} [${level}] ===\n`)
  process.stdout.write('\n')

  // ─── check: T1 fast checks ───────────────────────────────────────────────────
  runCheck('build-kit', 'node', ['scripts/build-kit.mjs'])
  runCheck('no redacted tokens', 'node', ['scripts/check-no-redacted-tokens.mjs'])
  runCheck('no work refs', 'node', ['scripts/check-no-work-refs.mjs', 'all'])
  runCheck('private paths ignored', 'node', ['scripts/check-private-paths-ignored.mjs'])
  runCheck('no tracked artifacts (INV-117)', 'node', ['scripts/check-no-tracked-artifacts.mjs'])
  runCheck('typecheck', 'npx', ['tsc', '--noEmit'])
  runCheck('format', 'npx', ['prettier', '--check', '.'])
  // #1523: scripts/ (the gate-enforcement layer) is linted alongside src/ and
  // __tests__/ so the enforcer is held to the same dead-code bar it imposes.
  runCheck('lint', 'npx', ['eslint', 'src', '__tests__', 'scripts'])
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
  runCheck('no direct-fs in generators', 'node', ['scripts/check-no-direct-fs-in-generators.mjs'])
  runCheck('PII scan', 'node', ['scripts/pii-scan.mjs'])
  runCheck('inline suppressions', 'node', ['scripts/check-inline-suppressions.mjs'])
  runCheck('suppressions expiry', 'node', ['scripts/check-suppressions.mjs'])
  runCheck('commitlint', 'npx', ['commitlint', '--from', 'origin/main', '--to', 'HEAD'], {
    cwd: GIT_CWD,
  })
  runCheck('test naming', 'node', ['scripts/check-test-naming.mjs'])
  runCheck('hardness inventory', 'node', ['scripts/check-hardness-inventory.mjs'])
  runCheck('docs', 'node', ['scripts/check-docs.mjs'], { cwd: GIT_CWD })
  runCheck('install command (B1)', 'node', ['scripts/check-install-command.mjs'])
  runCheck('tool claims', 'node', ['scripts/check-tool-claims.mjs'])
  runCheck('third-party licenses', 'node', ['scripts/gen-third-party-licenses.mjs', '--check'])
  runCheck('matrix fixtures', 'node', ['scripts/check-matrix-fixtures.mjs'])
  runCheck('matrix proven cells', 'node', ['scripts/check-matrix-proven-cells.mjs'])
  runCheck('skills-matrix-schema', 'node', ['scripts/check-skills-matrix.mjs'])
  runCheck('template tests', 'node', ['scripts/check-template-tests.mjs'])
  runCheck('generator tests', 'node', ['scripts/check-generator-tests.mjs'])
  runCheck('command tests', 'node', ['scripts/check-command-tests.mjs'])
  runCheck('brownfield tests (CANON-11)', 'node', ['scripts/check-brownfield-tests.mjs'])
  runCheck('catalog parity', 'node', ['scripts/check-catalog-agents-parity.mjs'])
  runCheck('global-invariants parity', 'node', ['scripts/check-global-invariants-parity.mjs'])
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
  runCheck('cli ref parity (INV-111)', 'node', ['scripts/gen-cli-ref.mjs', '--check'])
  // F2 (#1838, item 4): extends INV-111 beyond the generated cli.md region —
  // hand-authored prose (PRIVACY.md, docs/, website/) can cite a phantom
  // command without ever touching that region.
  runCheck('phantom command scan (INV-111 ext, #1838)', 'node', [
    'scripts/check-phantom-command-scan.mjs',
  ])
  // F2 (#1838, item 5): package.json / --version / CHANGELOG.md three-way
  // agreement — the permanent gate promised in the F1 fix for #1837.
  runCheck('version parity (#1838)', 'node', ['scripts/check-version-parity.mjs'])
  runCheck('phase doc consistency (INV-113)', 'node', ['scripts/check-phase-doc-consistency.mjs'])
  runCheck('canonical paths', 'node', ['scripts/check-canonical-paths.mjs'])
  runCheck('canon references', 'node', ['scripts/check-canon-references.mjs'])
  runCheck('canon enforcement parity (B1)', 'node', ['scripts/check-canon-enforcement-parity.mjs'])
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
  // F2 (#1838, item 1): CANON-10 promoted from "prose — checked at PR review"
  // to a wired gate — every hook in .claude/settings.json must be documented
  // in .claude/CLAUDE.md's hooks table, and vice versa.
  runCheck('hook doc parity (CANON-10, #1838)', 'node', ['scripts/check-hook-doc-parity.mjs'])
  runCheck('feature matrix (INV-112)', 'node', ['scripts/check-feature-matrix.mjs', '--check'])
  runCheck('anti-proforma (INV-118)', 'node', ['scripts/check-anti-proforma.mjs'])
  runCheck('anti-fake-green (#1412)', 'node', ['scripts/check-anti-fake-green.mjs'])
  runCheck('test pyramid (INV-124)', 'node', ['scripts/check-test-pyramid.mjs'])
  runCheck('test scope-tier (INV-124)', 'node', ['scripts/check-test-scope-tier.mjs'])
  runCheck('domain-api surface (INV-125)', 'node', ['scripts/check-domain-api-surface.mjs'])
  runCheck('api e2e (INV-126)', 'node', ['scripts/check-api-e2e.mjs'])
  runCheck('render smoke presence (INV-127)', 'node', ['scripts/check-render-smoke.mjs'])
  runCheck('workflow cache strategy (§17.5 rec 3)', 'node', [
    'scripts/check-workflow-cache-strategy.mjs',
  ])
  runCheck('build-cache strategy (C3)', 'node', ['scripts/check-build-cache-strategy.mjs'])
  // #1744 (INV-45): template<->materialized drift is caught at COMMIT time, not push time.
  runCheck('dogfood', 'node', ['scripts/check-self-dogfood.mjs'])

  // Capture L1 boundary for parityContentHash computation (INV-59)
  const l1EndIdx = getResults().length

  // ─── gate: T1+T2 extended checks ─────────────────────────────────────────────
  if (subcommand !== 'check') {
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
    runCheck('debt ratchet', 'node', ['scripts/debt-report.mjs', '--gate'])
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
    runWarnCheck('refutation majority (E2 #1943)', 'node', [
      'scripts/check-refutation-verdicts.mjs',
    ])
    runWarnCheck('audit dry-pass (E3 #1943)', 'node', ['scripts/check-audit-dry-pass.mjs', '--all'])
    runWarnCheck('handoff lint (E6a #1943)', 'node', ['scripts/check-handoff-doc.mjs'])
    runWarnCheck('bypass ceremony (E4 #1949)', 'node', ['scripts/check-bypass-ceremony.mjs'])
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
    if (existsSync('scripts/conformance.mjs')) {
      runWarnCheck('conformance', 'node', ['scripts/conformance.mjs', '--check'])
    }

    // Strict (#1481/INV-135): doc-set mandatory-doc completeness — a missing mandatory doc
    // fails the gate (--strict). Recommended-tier gaps remain advisory inside the script.
    if (existsSync('scripts/check-doc-set.mjs')) {
      runCheck('doc-set presence', 'node', ['scripts/check-doc-set.mjs', '--strict'])
    }
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
        // `status` keeps the full PASS/FAIL/WARN/SKIP distinction visible to
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
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()
      // #1212: stamp the branch so the fail-closed Stop hook can require this
      // gate-pass to belong to the current branch (strict branch+sha match).
      const branch = (() => {
        try {
          return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            encoding: 'utf-8',
          }).trim()
        } catch {
          return 'unknown'
        }
      })()
      const gitUser = (() => {
        try {
          return execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8' }).trim()
        } catch {
          return 'unknown'
        }
      })()
      // #1441: stamp the task id so the fail-closed Stop hook can reject a prior
      // task's gate-pass on the same branch (anti-replay, beyond branch+sha).
      const taskId = (() => {
        try {
          const statusPath = resolve(GIT_CWD ?? process.cwd(), '.claude/.task/status.json')
          if (!existsSync(statusPath)) return 'unknown'
          const s = JSON.parse(readFileSync(statusPath, 'utf-8'))
          return typeof s.taskId === 'string' && s.taskId.length > 0 ? s.taskId : 'unknown'
        } catch {
          return 'unknown'
        }
      })()
      const markerPath = resolve(GIT_CWD ?? process.cwd(), '.arbiter/gate-pass.json')
      mkdirSync(dirname(markerPath), { recursive: true })
      writeFileSync(
        markerPath,
        JSON.stringify(
          {
            head_sha: headSha,
            branch,
            task_id: taskId,
            timestamp: new Date().toISOString(),
            level,
            node_version: process.version,
            git_user: gitUser,
          },
          null,
          2,
        ) + '\n',
      )
    } catch (err) {
      process.stderr.write(`check-all: warning: could not write gate marker: ${err.message}\n`)
    }
  }

  if (failed > 0) {
    const failedResults = results.filter((r) => r.status === 'FAIL')
    console.error(`=== FAILED: ${failed} check(s) ===`)
    console.error('Failed checks:')
    for (const r of failedResults) console.error(`- ${r.name}`)
    console.error('')
    process.exit(1)
  } else {
    process.stdout.write('=== ALL PASSED ===\n\n')
  }
} // end isMain
