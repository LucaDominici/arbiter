// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { computeThresholds } from '../config/thresholds.js'
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
  { rel: ['scripts', 'check-constraint-scan.mjs'], tpl: 'scripts/check-constraint-scan.mjs.ejs' },
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
  {
    rel: ['scripts', 'lib', 'glob-walk.mjs'],
    tpl: 'scripts/lib/glob-walk.mjs.ejs',
  },
  // #1398 (INV-128): conformance scorecard runner. Emitted unconditionally so every
  // governed project can run `node scripts/conformance.mjs --check`; wired as an
  // advisory (runWarnCheck) in check-all.mjs L2 so it never hard-fails the gate.
  {
    rel: ['scripts', 'conformance.mjs'],
    tpl: 'scripts/conformance.mjs.ejs',
  },
  // #1419: gold-audit thin runner. Delegates to `npx arbiter gold-audit --check`
  // (the engine + `yaml` dep stay in arbiter's env). Emitted unconditionally and
  // wired ADVISORY (runWarnCheck, plain --check) in check-all.mjs so a fresh consumer
  // bootstraps its baseline on first run with no day-1 redness. The consumer-DATA
  // standards/* that this runner reads are emitted by generateGoldKit (gold-kit gen).
  {
    rel: ['scripts', 'gold-audit.mjs'],
    tpl: 'scripts/gold-audit.mjs.ejs',
  },
  // #1428 (INV-135): doc-set + anti-fake-green thin runners. Each delegates to
  // `npx arbiter <cmd>` (the engine + `yaml` dep stay in arbiter's env), so a consumer
  // needs NO local `yaml` dep. Emitted unconditionally and wired ADVISORY (runWarnCheck)
  // in check-all.mjs L2 so a fresh consumer passes with no day-1 redness (gh absent =
  // fail-OPEN; doc-set advisory unless --strict).
  {
    rel: ['scripts', 'check-doc-set.mjs'],
    tpl: 'scripts/check-doc-set.mjs.ejs',
  },
  {
    rel: ['scripts', 'check-anti-fake-green.mjs'],
    tpl: 'scripts/check-anti-fake-green.mjs.ejs',
  },
]

function emitUnconditional(base: string, data: object, opts: { dryRun: boolean }): WriteResult[] {
  return UNCONDITIONAL_EMISSIONS.map(({ rel, tpl }) => emitTemplateFile(base, rel, tpl, data, opts))
}

export function generateCheckAll(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CheckAllGeneratorResult {
  const results: WriteResult[] = []
  const base = config.targetDir

  const computed = computeThresholds(
    config.linesOfCode ?? 0,
    config.thresholdProfile ?? 'fixed',
    config.governanceLevel,
  )

  const data = {
    ...config,
    // #484 — use `??` not `||` so explicit numeric thresholds (validated > 0 by
    // src/config/schema.ts::validateThresholds) are honored. `||` would treat
    // 0 as falsy and silently substitute the computed default.
    coverageThreshold: config.thresholds?.lineCoverage ?? computed.coverageThreshold,
    coverageEnabled: computed.coverageEnabled,
    mutationEnabled: computed.mutationEnabled,
    mutationThreshold: config.thresholds?.mutationScore ?? computed.mutationThreshold,
    // #359 (INV-60): binary-size cap consumed by the rust archetype branch of
    // check-all.mjs. Value is 0 for non-binary archetypes; the template guards
    // emission on archetype before reading the variable, so 0 is inert.
    binarySizeBytes: binarySizeBudget(config.archetype),
  }

  results.push(...emitUnconditional(base, data, opts))

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

  // #1367 (INV-126): domain<->API surface-completeness gate.
  results.push(...emitDomainApiSurface(base, config, data, opts))

  // #1127 / #1330: frontend gate scripts (boundary purity + per-lane subtree gate).
  results.push(...emitFrontendChecks(base, config, data, opts))

  return { files: results }
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
