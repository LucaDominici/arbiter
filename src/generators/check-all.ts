// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { resolveEffectiveThresholds } from '../config/thresholds.js'
import { resolveCollaborationMode } from '../config/collaboration-mode-defaults.js'
import { isSubtreeFrontendLane } from '../detectors/lanes.js'
import type { Archetype, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

/**
 * #359 Phase 7G — release binary size budget per archetype (bytes). Inlined
 * (not exported) to avoid expanding the public API surface; kept in sync with
 * the matching copy in src/generators/coverage.ts.
 */
function binarySizeBudget(archetype: Archetype): number {
  const MB = 1024 * 1024
  if (archetype === 'cli') return 10 * MB
  if (archetype === 'embedded') return 5 * MB
  return 0
}

export interface CheckAllGeneratorResult {
  files: WriteResult[]
}

/**
 * #1319.8 (CANON-01, INV-30): emit the greenfield-aware coverage gate predicate
 * for TypeScript projects with coverage enabled. check-all.mjs imports
 * evaluateCoverageGate from ./lib/coverage-gate.mjs to decide PASS (greenfield,
 * zero executable statements) vs threshold-enforcement vs FAIL (no/malformed
 * summary). Only TS uses vitest+coverage-summary.json; other languages enforce
 * coverage via their native toolchain (tarpaulin/jacoco/coverage.py). Extracted
 * to keep generateCheckAll under the complexity/line ceiling (CANON-22).
 */
function emitCoverageGate(
  base: string,
  data: { language: string; enableDebtGates: boolean; coverageEnabled: boolean },
  opts: { dryRun: boolean },
): WriteResult[] {
  if (!(data.language === 'typescript' && data.enableDebtGates && data.coverageEnabled)) {
    return []
  }
  const coverageGatePath = resolvedPath(base, 'scripts', 'lib', 'coverage-gate.mjs')
  return [
    writeFile(coverageGatePath, renderTemplate('scripts/lib/coverage-gate.mjs.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  ]
}

/**
 * #1331 (INV-123): emit a single skipIfExists template file under the project
 * root and return its WriteResult. Keeps generateCheckAll under the line ceiling
 * (CANON-22) while sharing the resolvedPath/renderTemplate/writeFile boilerplate.
 */
function emitTemplateFile(
  base: string,
  relPath: readonly string[],
  template: string,
  data: object,
  opts: { dryRun: boolean },
): WriteResult {
  return writeFile(resolvedPath(base, ...relPath), renderTemplate(template, data), {
    skipIfExists: true,
    dryRun: opts.dryRun,
  })
}

/**
 * #1331 (CANON-22): the unconditional emissions every governed project gets
 * alongside check-all.mjs, written via one shared loop so the boilerplate (and
 * its cyclomatic weight) lives outside generateCheckAll:
 *   check-all.mjs               — the gate script itself
 *   optional-emissions.json     — #1331/INV-123 manifest of intentionally-optional
 *                                 (existsSync-guarded) gate scripts so the
 *                                 emission-coherence lint tells a declared optional
 *                                 from a real ghost
 *   lib/run-helpers.mjs         — #351/CANON-01 runCheck/runToolCheck trinity
 *   check-collab-mode-wired.mjs — #1093/INV-100 collaborationMode L1 assertion
 *   check-constraint-scan.mjs   — #1214/INV-115 governance constraint scanner
 */
const UNCONDITIONAL_EMISSIONS: ReadonlyArray<{ rel: readonly string[]; tpl: string }> = [
  { rel: ['scripts', 'check-all.mjs'], tpl: 'scripts/check-all.mjs.ejs' },
  { rel: ['scripts', 'optional-emissions.json'], tpl: 'scripts/optional-emissions.json.ejs' },
  { rel: ['scripts', 'lib', 'run-helpers.mjs'], tpl: 'scripts/lib/run-helpers.mjs.ejs' },
  {
    rel: ['scripts', 'check-collab-mode-wired.mjs'],
    tpl: 'scripts/check-collab-mode-wired.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-hook-routing.mjs'],
    tpl: 'scripts/check-hook-routing.mjs.ejs',
  },
  { rel: ['scripts', 'check-constraint-scan.mjs'], tpl: 'scripts/check-constraint-scan.mjs.ejs' },
  // #2037 (INV-115): scaffold the map alongside its checker so the gate never runs
  // against an absent map by construction. skipIfExists — a project's curated
  // coverage is never clobbered by a later `arbiter update`.
  { rel: ['scripts', 'constraint-map.json'], tpl: 'scripts/constraint-map.json.ejs' },
  // #1407 (INV-129): repo-hygiene gate — no tracked data/state files or compiled
  // binaries in the index. Emitted unconditionally and wired at L1 in check-all.mjs.ejs.
  {
    rel: ['scripts', 'check-no-tracked-artifacts.mjs'],
    tpl: 'scripts/check-no-tracked-artifacts.mjs.ejs',
  },
  // #1442: container image digest-pin gate. Emitted unconditionally (self-SKIPs when
  // the repo ships no Dockerfiles); wired at L1 in check-all.mjs.ejs.
  {
    rel: ['scripts', 'check-image-pins.mjs'],
    tpl: 'scripts/check-image-pins.mjs.ejs',
  },
  // #1445 (INV-130): stack-agnostic E2E reliability subsystem. The library
  // (fingerprint/classify/retryLadder/riskTier/ledger/quarantine schema) is emitted
  // first; the fail-closed quarantine hygiene gate imports it and is wired at L1 in
  // check-all.mjs.ejs. Both self-SKIP/vacuous-pass when no quarantine registry exists.
  {
    rel: ['scripts', 'lib', 'e2e-reliability.mjs'],
    tpl: 'scripts/lib/e2e-reliability.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-e2e-quarantine.mjs'],
    tpl: 'scripts/check-e2e-quarantine.mjs.ejs',
  },
  // #1446 (INV-131): TDD red→green evidence re-verification gate. Self-contained
  // (inlines schema + git checks — no arbiter CLI dependency); wired at L2 in
  // check-all.mjs.ejs. Self-SKIPs (no origin/main or no task-ID commits).
  {
    rel: ['scripts', 'check-tdd-evidence.mjs'],
    tpl: 'scripts/check-tdd-evidence.mjs.ejs',
  },
  // #1456 (INV-133): TODO max-age enforcement gate. A TODO(#NNN) whose linked issue
  // was created more than MAX_AGE_DAYS ago FAILS the gate (age from issue created_at
  // only). Self-contained; wired at L2 in check-all.mjs.ejs. Graceful-SKIPs offline.
  {
    rel: ['scripts', 'check-todo-max-age.mjs'],
    tpl: 'scripts/check-todo-max-age.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-test-pyramid.mjs'],
    tpl: 'scripts/check-test-pyramid.mjs.ejs',
  },
  // #1457 (INV-134): per-module coverage non-regression ratchet. Emitted unconditionally
  // (self-SKIPs when no coverage summary exists, or the stack is not yet supported);
  // wired ADVISORY (runWarnCheck) at L2 in check-all.mjs.ejs so it starts as a warning
  // (start-warn-promote-later) and never hard-fails a fresh consumer's gate.
  {
    rel: ['scripts', 'verify-module-coverage.mjs'],
    tpl: 'scripts/verify-module-coverage.mjs.ejs',
  },
  // #1508: mutation-score non-regression ratchet. Emitted unconditionally (self-SKIPs
  // when no mutation report exists, or the stack is not yet supported); wired blocking
  // next to the mutation gate so the killed-mutant ratio cannot silently drift toward
  // the absolute floor without ever tripping a regression.
  {
    rel: ['scripts', 'verify-mutation-baseline.mjs'],
    tpl: 'scripts/verify-mutation-baseline.mjs.ejs',
  },
  {
    // #1365/INV-126: live-API e2e gate. Emitted unconditionally (manifest absent or
    // required:false ⇒ runtime SKIP); the suite itself is scaffolded by the api-e2e
    // generator only for service archetypes.
    rel: ['scripts', 'check-api-e2e.mjs'],
    tpl: 'scripts/check-api-e2e.mjs.ejs',
  },
  // #1366 (INV-127): frontend render-smoke presence gate. Emitted unconditionally
  // (self-SKIPs for non-frontend / ungoverned repos) so the gate is always wired;
  // imports the shared glob-walk helper, also emitted unconditionally below.
  {
    rel: ['scripts', 'check-render-smoke.mjs'],
    tpl: 'scripts/check-render-smoke.mjs.ejs',
  },
  // #2080 (INV-137): declarative smoke-journey acceptance-floor gate. Emitted unconditionally
  // (runtime-SKIPs on applicable:false / absent manifest) so the gate is always wired; imports
  // the shared glob-walk helper emitted just below. The manifest + starter come from
  // src/generators/smoke-journeys.ts.
  {
    rel: ['scripts', 'check-smoke-journeys.mjs'],
    tpl: 'scripts/check-smoke-journeys.mjs.ejs',
  },
  {
    rel: ['scripts', 'lib', 'glob-walk.mjs'],
    tpl: 'scripts/lib/glob-walk.mjs.ejs',
  },
  // ADR-110 (INV-138): acceptance-anchor orchestration tools. The generated ship.md
  // preflight/FIT-rubric steps invoke issue-readiness.mjs / rework-log.mjs, so the
  // files must exist in every governed tree (INV-123 emission coherence — command-doc
  // references are unguarded by construction). Both share the pure parsing core in
  // scripts/lib/acceptance-criteria.mjs, co-emitted like glob-walk above. The
  // check-acceptance.mjs GATE stays self-only (not wired in generated check-all) —
  // that wiring is the tracked ADR-110 follow-up.
  {
    rel: ['scripts', 'issue-readiness.mjs'],
    tpl: 'scripts/issue-readiness.mjs.ejs',
  },
  {
    rel: ['scripts', 'rework-log.mjs'],
    tpl: 'scripts/rework-log.mjs.ejs',
  },
  {
    rel: ['scripts', 'lib', 'acceptance-criteria.mjs'],
    tpl: 'scripts/lib/acceptance-criteria.mjs.ejs',
  },
  // #1398 (INV-128) conformance.mjs and #1419 gold-audit.mjs are NOT listed here:
  // each has a dedicated always-on owner (generateConformanceScript / generateGoldKit)
  // that runs later in the registry and is the SOLE emitter. Listing them here too made
  // generateCheckAll a second always-on emitter — the #1318.2 double-write class (false
  // "already exist" on fresh init + duplicated/over-counted `arbiter diff` entries, #1578).
  // The wiring is independent of emission: check-all.mjs.ejs gates each as an advisory
  // `runWarnCheck` on `existsSync(scripts/<file>)`, so the gate stays fully intact.
  // #1428 (INV-135): doc-set + anti-fake-green thin runners. Each delegates to
  // `npx arbiter <cmd>` (the engine + `yaml` dep stay in arbiter's env), so a consumer
  // needs NO local `yaml` dep. Emitted unconditionally and wired ADVISORY (runWarnCheck)
  // in check-all.mjs L2 so a fresh consumer passes with no day-1 redness (gh absent =
  // fail-OPEN; doc-set advisory unless --strict).
  {
    rel: ['scripts', 'check-doc-set.mjs'],
    tpl: 'scripts/check-doc-set.mjs.ejs',
  },
  // T4 (gold-doc-tranches-t3-t5.md §2.3): freshness thin runner, same shape/rationale as
  // check-doc-set.mjs above — delegates to `npx arbiter doc-set --freshness`. Emitted
  // unconditionally but wired OUTSIDE check-all.mjs L2 (monthly + release lane only, per the
  // solo-developer-gate-model doctrine) — see _monthly.yml.ejs / 05-release.yml.ejs.
  {
    rel: ['scripts', 'check-doc-freshness.mjs'],
    tpl: 'scripts/check-doc-freshness.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-anti-fake-green.mjs'],
    tpl: 'scripts/check-anti-fake-green.mjs.ejs',
  },
  // #1497 (A5): ship arbiter's deterministic file-scan anti-fake-green guards INTO the generated
  // project so a planted false-green is caught by THIS project's own gate — not only by arbiter's.
  // Each is self-contained (node-only, no lib import) and NO-DATA-safe (PASS when there is nothing
  // to scan), so each is emitted unconditionally and hard-wired (runCheck) in check-all.mjs. The
  // self-contained aggregate (check-anti-fake-green.mjs) also runs this set as an informational view.
  {
    rel: ['scripts', 'check-muted-test.mjs'],
    tpl: 'scripts/check-muted-test.mjs.ejs',
  },
  // Brownfield companion to check-muted-test (#1835 follow-through): pre-existing
  // muted tests (e.g. a legacy repo's @Disabled suites) are grandfathered via
  // `--update-baseline`; NEW muted gate tests always fail. Emitted empty (strict
  // default) so the mechanism is discoverable and manifest-owned.
  {
    rel: ['muted-tests-baseline.json'],
    tpl: 'scripts/muted-tests-baseline.json.ejs',
  },
  {
    rel: ['scripts', 'check-skip-critical-e2e.mjs'],
    tpl: 'scripts/check-skip-critical-e2e.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-no-stub-redirects.mjs'],
    tpl: 'scripts/check-no-stub-redirects.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-grace-window.mjs'],
    tpl: 'scripts/check-grace-window.mjs.ejs',
  },
  // #2161: assertion-delta guard — diff-based, applies to any test stack, so (unlike
  // oracle-discrimination above) it is emitted unconditionally like its five siblings above.
  {
    rel: ['scripts', 'check-assertion-delta.mjs'],
    tpl: 'scripts/check-assertion-delta.mjs.ejs',
  },
  // T1 (convergence playbook): anti-erosion ratchet — fails when a safety-class
  // file (.claude/hooks/*.mjs) is still withheld (user-modified, not re-adopted).
  // Reads .arbiter-generated-manifest.json's withheldSafety section (update.ts).
  // Wired at L1 in check-all.mjs.ejs (safety hooks exist from L1 upward).
  {
    rel: ['scripts', 'check-safety-adopt-ratchet.mjs'],
    tpl: 'scripts/check-safety-adopt-ratchet.mjs.ejs',
  },
  // E1-E7 #1943 (CANON-14): anti-context-rot enforcer twins — verbatim copies of
  // arbiter's own gate set (design: docs/design/anti-context-rot-enforcers.md).
  // Emitted unconditionally: every gate vacuous-PASSes when its evidence surface
  // is absent, and the design's tier table keeps the recorder AVAILABLE from L1
  // ("solo/L1: recorder available, gate not wired").
  // check-touched-vs-manifest is emitted but NOT wired into the gate ring — it is
  // a per-group harvest-time gate that requires --plan/--group/--base args (E7).
  {
    rel: ['scripts', 'check-touched-vs-manifest.mjs'],
    tpl: 'scripts/check-touched-vs-manifest.mjs.ejs',
  },
  { rel: ['scripts', 'record-agent-return.mjs'], tpl: 'scripts/record-agent-return.mjs.ejs' },
  // Shared E1-E7 helpers + the envelope schema the recorder/gate validate against.
  { rel: ['scripts', 'lib', 'gate-args.mjs'], tpl: 'scripts/lib/gate-args.mjs.ejs' },
  {
    rel: ['scripts', 'lib', 'agent-return-validate.mjs'],
    tpl: 'scripts/lib/agent-return-validate.mjs.ejs',
  },
  {
    rel: ['schemas', 'agent-return.schema.json'],
    tpl: 'scripts/schemas/agent-return.schema.json.ejs',
  },
  // #2058: best-effort nightly safety net — deletes Actions artifacts GitHub
  // itself already marked expired but hasn't physically purged. Invoked directly
  // by the nightly workflow's cleanup-expired-artifacts job, not wired into the
  // check-all.mjs gate ring (it's CI hygiene, not a correctness gate).
  {
    rel: ['scripts', 'gh-cleanup-expired-artifacts.mjs'],
    tpl: 'scripts/gh-cleanup-expired-artifacts.mjs.ejs',
  },
]

// The four repo-wide anti-context-rot gates are wired ADVISORY (runWarnCheck)
// inside check-all.mjs.ejs's enableDebtGates ring (L2+ default) — their emission
// follows the SAME predicate so no fixture ever carries a dead emission (#1835
// class; caught by check-emission-coherence on L1/peer-review).
const DEBT_GATED_EMISSIONS: ReadonlyArray<{ rel: readonly string[]; tpl: string }> = [
  { rel: ['scripts', 'check-agent-return.mjs'], tpl: 'scripts/check-agent-return.mjs.ejs' },
  {
    rel: ['scripts', 'check-refutation-verdicts.mjs'],
    tpl: 'scripts/check-refutation-verdicts.mjs.ejs',
  },
  { rel: ['scripts', 'check-audit-dry-pass.mjs'], tpl: 'scripts/check-audit-dry-pass.mjs.ejs' },
  { rel: ['scripts', 'check-handoff-doc.mjs'], tpl: 'scripts/check-handoff-doc.mjs.ejs' },
]

function emitUnconditional(base: string, data: object, opts: { dryRun: boolean }): WriteResult[] {
  return UNCONDITIONAL_EMISSIONS.map(({ rel, tpl }) => emitTemplateFile(base, rel, tpl, data, opts))
}

function emitDebtGated(
  base: string,
  data: { enableDebtGates?: boolean },
  opts: { dryRun: boolean },
): WriteResult[] {
  if (data.enableDebtGates !== true) return []
  return DEBT_GATED_EMISSIONS.map(({ rel, tpl }) => emitTemplateFile(base, rel, tpl, data, opts))
}

export function generateCheckAll(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CheckAllGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  // #1527 — single resolver shared with the coverage + mutation generators so
  // the gate floor can never disagree with the tool-config floor for the same
  // project. Replaces the old per-generator `?? computed` precedence (#484).
  const effective = resolveEffectiveThresholds(config)

  const data = {
    ...config,
    coverageThreshold: effective.lineCoverage,
    coverageEnabled: effective.coverageEnabled,
    mutationEnabled: effective.mutationEnabled,
    mutationThreshold: effective.mutationScore,
    // #359 (INV-60): binary-size cap consumed by the rust archetype branch of
    // check-all.mjs. Value is 0 for non-binary archetypes; the template guards
    // emission on archetype before reading the variable, so 0 is inert.
    binarySizeBytes: binarySizeBudget(config.archetype),
  }

  results.push(...emitUnconditional(base, data, opts))
  results.push(...emitDebtGated(base, data, opts))

  // #1319.8 — greenfield-aware coverage gate predicate (TS + coverage only).
  results.push(...emitCoverageGate(base, data, opts))

  // #358 (CANON-02, CANON-15, Phase 7F): emit ephemeral-server runner used by
  // integration/e2e gate steps (Playwright TS, pytest-playwright Python) to
  // bring up a server, poll for readiness, run tests, and tear it down. Only
  // archetypes that exercise an HTTP surface at L2+ need the runner; library
  // and L1 setups skip the emission to keep the generated tree minimal.
  const archetypesNeedingServer = new Set(['frontend-spa', 'backend-web-db'])
  if (config.governanceLevel !== 'L1' && archetypesNeedingServer.has(config.archetype)) {
    const ephemeralPath = resolvedPath(base, 'scripts', 'lib', 'ephemeral-server.mjs')
    results.push(
      writeFile(ephemeralPath, renderTemplate('scripts/lib/ephemeral-server.mjs.ejs', data), {
        skipIfExists: true,
        dryRun: opts.dryRun,
      }),
    )
  }

  // #360 (CANON-02): Rust context-aware INV-04 checkers — no .unwrap()/.expect() and no `unsafe`.
  // Emitted only for rust projects, invoked at L1 from check-all.mjs.ejs.
  if (config.language === 'rust') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'checks', 'check-rust-no-unwrap.mjs'),
        renderTemplate('scripts/checks/check-rust-no-unwrap.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'checks', 'check-rust-no-unsafe.mjs'),
        renderTemplate('scripts/checks/check-rust-no-unsafe.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #356 (CANON-01): rebased-aware docs-check script + [skip-docs] bypass.
  // Mirrors CI docs-check job so the gate fires locally pre-push. L2+ only (matches CI gating).
  if (config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-docs.mjs'),
        renderTemplate('scripts/check-docs.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1977: trunk-solo requires the local-ci-parity check wired BY DEFAULT — a
  // no-PR flow is only sound when `run.sh gate full ≡ CI` (INV-59); without a
  // PR there is no independent CI net before trunk. peer-review/gated-review
  // rely on the PR itself as that net, so the script is trunk-solo-only.
  if (resolveCollaborationMode(config) === 'trunk-solo') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-local-ci-parity.mjs'),
        renderTemplate('scripts/check-local-ci-parity.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1367 (INV-126): domain<->API surface-completeness gate.
  results.push(...emitDomainApiSurface(base, config, data, opts))

  // #2160: oracle-discrimination guard — conditional on an E2E (Playwright) harness being
  // applicable, same predicate as generateE2eConstitution (e2e-constitution.ts).
  results.push(...emitOracleDiscrimination(base, config, data, opts))

  // #1127 / #1330: frontend gate scripts (boundary purity + per-lane subtree gate).
  results.push(...emitFrontendChecks(base, config, data, opts))

  // #1737 (CANON-01 Track-B counterpart of arbiter-self's #1718): consumer-resolution
  // audit gate for published npm libraries.
  results.push(...emitConsumerAudit(base, config, data, opts))

  return { files: results }
}

/**
 * #1737 — consumer-resolution audit gate (`check-consumer-audit.mjs`), the Track-B
 * counterpart of arbiter-self's own #1718 `scripts/check-consumer-audit.mjs` gate.
 * npm silently drops a package's own `overrides` for anyone who installs it as a
 * dependency, so a published library's dev-tree `npm audit` is structurally blind to
 * that class of exposure — this gate packs+installs+audits the CONSUMER-resolved tree
 * instead. Emitted only for a published npm library target (the established
 * `archetype === 'library' && language === 'typescript'` predicate, see
 * debt-ratchet.ts's `includePublicApiSurface`), and only at L2+ (mirrors the
 * suppressions.ts Java/Kotlin/multi owasp-suppressions.xml governance-level guard).
 */
function emitConsumerAudit(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  if (
    config.archetype !== 'library' ||
    config.language !== 'typescript' ||
    config.governanceLevel === 'L1'
  ) {
    return []
  }
  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-consumer-audit.mjs'),
      renderTemplate('scripts/check-consumer-audit.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
}

/**
 * #1367 (INV-126) — domain<->API surface-completeness gate emission.
 * Only emitted when config.hasPublicApi is true (skip brownfield / library targets).
 */
function emitDomainApiSurface(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  if (!config.hasPublicApi) return []
  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-domain-api-surface.mjs'),
      renderTemplate('scripts/check-domain-api-surface.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'domain-api-surface.json'),
      renderTemplate('scripts/domain-api-surface.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
}

/**
 * #2160 (port of a proven oracle-discrimination guard from a downstream consumer project): emit the
 * oracle-discrimination guard + its seeded-empty ratchet baseline ONLY where an E2E
 * (Playwright) harness is applicable — same predicate as generateE2eConstitution
 * (e2e-constitution.ts): archetype frontend-spa or backend-web-db. A library/cli/embedded
 * target never gets the file, so check-anti-fake-green.mjs's generic existsSync-guarded
 * roster loop reports it `absent` rather than fabricating a pass (AC-4). The baseline is
 * seeded empty (skipIfExists: true, same brownfield-companion shape as
 * muted-tests-baseline.json) — the guard's OWN runtime never writes it except under an
 * explicit --update-baseline flag (AC-2 fail-closed-on-missing stays a human act, not an
 * emission-time convenience).
 */
function emitOracleDiscrimination(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  const hasE2eHarness = config.archetype === 'frontend-spa' || config.archetype === 'backend-web-db'
  if (!hasE2eHarness) return []
  return [
    writeFile(
      resolvedPath(base, 'scripts', 'check-oracle-discrimination.mjs'),
      renderTemplate('scripts/check-oracle-discrimination.mjs.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      resolvedPath(base, 'oracle-discrimination-baseline.json'),
      renderTemplate('scripts/oracle-discrimination-baseline.json.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]
}

/**
 * #1127 + #1330 — frontend gate-script emissions, extracted to keep generateCheckAll
 * under the complexity/line ceiling (CANON-22).
 *
 *  - #1127 (INV-102/103/104, CANON-09): FE boundary purity gate
 *    (`check-fe-boundaries.mjs`). Emitted for the frontend-spa archetype OR any
 *    project with a 'frontend' lane, L2+ only.
 *  - #1330 (CANON-11): per-lane frontend SUBTREE gate (`check-frontend-lane.mjs`).
 *    A `frontend` lane on a *non-frontend-spa* archetype means the FE app lives in a
 *    `frontend/` subtree beside the primary language; the primary-language gate never
 *    runs the FE lane's typecheck/test/build, so emit a dedicated gate-on-present
 *    runner. The frontend-spa archetype keeps its root-level wiring (no subtree emit).
 */
function emitFrontendChecks(
  base: string,
  config: ProjectConfig,
  data: object,
  opts: { dryRun: boolean },
): WriteResult[] {
  const out: WriteResult[] = []
  const isFrontend = config.archetype === 'frontend-spa' || config.lanes.includes('frontend')
  if (isFrontend && config.governanceLevel !== 'L1') {
    out.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-fe-boundaries.mjs'),
        renderTemplate('scripts/check-fe-boundaries.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }
  if (isSubtreeFrontendLane(config)) {
    out.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-frontend-lane.mjs'),
        renderTemplate('scripts/check-frontend-lane.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }
  return out
}
