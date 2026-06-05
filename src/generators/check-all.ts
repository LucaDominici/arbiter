// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { computeThresholds } from '../config/thresholds.js'
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

  const scriptPath = resolvedPath(base, 'scripts', 'check-all.mjs')
  results.push(
    writeFile(scriptPath, renderTemplate('scripts/check-all.mjs.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  // #351 (CANON-01): emit shared helper trinity alongside the gate script.
  // check-all.mjs imports runCheck/runWarnCheck/runToolCheck/pushResult from
  // ./lib/run-helpers.mjs; the file must always be present when check-all.mjs is.
  const helpersPath = resolvedPath(base, 'scripts', 'lib', 'run-helpers.mjs')
  results.push(
    writeFile(helpersPath, renderTemplate('scripts/lib/run-helpers.mjs.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  // #1093 (CANON-01, INV-100): emit the collaborationMode-wired check alongside
  // check-all.mjs. Run at L1, it asserts the generated arbiter.json declares a
  // valid collaborationMode — the primary workflow axis (ADR-051). Unconditional
  // because every arbiter.json carries the field after init.
  const collabCheckPath = resolvedPath(base, 'scripts', 'check-collab-mode-wired.mjs')
  results.push(
    writeFile(collabCheckPath, renderTemplate('scripts/check-collab-mode-wired.mjs.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

  // #1214 (CANON-01, INV-115): emit the governance constraint scanner. It extracts
  // free-text hard prohibitions (NEVER / MUST NOT / DO NOT / 🛑) from the project's
  // governance docs and classifies each as COVERED / ENFORCED-BY-SCAN / UNENFORCEABLE.
  // Warn-default on targets (ENFORCE_DEFAULT=false) so a fresh init can never hard-fail
  // on an un-curated token; projects curate scripts/constraint-map.json and flip
  // --enforce=true to promote. Unconditional — every governed project ships governance docs.
  const constraintScanPath = resolvedPath(base, 'scripts', 'check-constraint-scan.mjs')
  results.push(
    writeFile(constraintScanPath, renderTemplate('scripts/check-constraint-scan.mjs.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
  )

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

  // #1127 (INV-102/103/104, CANON-01, CANON-09): FE boundary purity gate.
  // Emitted for frontend-spa archetype or projects with a 'frontend' lane.
  // Checks: API-layer isolation (INV-102), headless domain (INV-103),
  // state-mgmt discipline (INV-104). L2+ only (matches governance level).
  const isFrontend = config.archetype === 'frontend-spa' || config.lanes.includes('frontend')
  if (isFrontend && config.governanceLevel !== 'L1') {
    results.push(
      writeFile(
        resolvedPath(base, 'scripts', 'check-fe-boundaries.mjs'),
        renderTemplate('scripts/check-fe-boundaries.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files: results }
}
