// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { resolveEffectiveThresholds } from '../config/thresholds.js'
import { injectGradleWiring, safeApplyFromSnippet } from '../utils/gradle.js'
import type { Archetype, ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

// #1887-F: org.jetbrains.kotlinx.kover is a marketplace plugin (unlike jacoco,
// which ships built-in with Gradle) — kover.gradle.ejs's `kover {}` extension
// block only resolves once the plugin is declared in the root plugins block.
const KOVER_PLUGIN_VERSION = '0.9.8'

/**
 * #359 Phase 7G — release binary size budget per archetype (bytes).
 * Inlined (not exported) to avoid expanding the public API surface; both
 * Rust-binary consumers (coverage + check-all) call it via local copies kept
 * in sync. cli → 10 MB, embedded → 5 MB, others → 0 (no binary emitted).
 */
function binarySizeBudget(archetype: Archetype): number {
  const MB = 1024 * 1024
  if (archetype === 'cli') return 10 * MB
  if (archetype === 'embedded') return 5 * MB
  return 0
}

export interface CoverageGeneratorResult {
  files: WriteResult[]
}

export function generateCoverage(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CoverageGeneratorResult {
  if (!config.enableDebtGates) return { files: [] }

  const results: WriteResult[] = []
  const base = config.targetDir

  // #1527 — resolve via the single shared precedence rule (same as check-all +
  // mutation). `thresholds` in the template data is OVERRIDDEN with the resolved
  // line/branch floors so vitest `lines`/`functions`/`branches`/`statements` all
  // mirror the same SSOT as the check-all gate — no mixed-SSOT vitest.config.ts.
  const effective = resolveEffectiveThresholds(config)

  const data = {
    ...config,
    thresholds: {
      ...config.thresholds,
      lineCoverage: effective.lineCoverage,
      branchCoverage: effective.branchCoverage,
    },
    coverageThreshold: effective.lineCoverage,
    coverageEnabled: effective.coverageEnabled,
    // #359 (INV-60): binary-size budget for Rust binary archetypes.
    // Zero for non-binary archetypes; template emission is archetype-gated.
    binarySizeBytes: binarySizeBudget(config.archetype),
  }

  if (config.language === 'typescript' || config.language === 'multi') {
    results.push(
      writeFile(
        resolvedPath(base, 'vitest.config.ts'),
        renderTemplate('coverage/vitest.config.ts.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (
    (config.language === 'java' || config.language === 'multi') &&
    config.buildTool === 'gradle'
  ) {
    results.push(
      writeFile(
        resolvedPath(base, 'gradle', 'jacoco.gradle'),
        renderTemplate('coverage/jacoco.gradle.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
    // #1887-F: gradle/jacoco.gradle was emitted but never wired into the root
    // build — the exact #1886 modulith-deps.gradle ghost class. jacoco itself is
    // a built-in Gradle plugin (self-applies via `apply plugin: 'jacoco'` inside
    // the applied script — no plugins{} declaration needed, unlike kover below),
    // so only the apply(from=...) line is required. Withhold when the root
    // build already configures `jacoco {}` inline (mirrors the spotbugs/spotless
    // rootBuildSignatures precedent in debt-gates.ts).
    const applyJacoco = safeApplyFromSnippet(base, 'gradle/jacoco.gradle', {
      rootBuildSignatures: [/(?:^|\n)[ \t]*jacoco\s*\{/],
    })
    if (applyJacoco) injectGradleWiring(base, opts.dryRun, { snippets: [applyJacoco] })
  }

  if ((config.language === 'java' || config.language === 'multi') && config.buildTool === 'maven') {
    results.push(
      writeFile(
        resolvedPath(base, 'docs', 'coverage', 'jacoco-maven-setup.md'),
        renderTemplate('coverage/jacoco-maven-setup.md.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  if (config.language === 'rust') {
    results.push(...emitRustCoverage(base, config, data, opts.dryRun))
  }

  // #1177: python + kotlin extracted to keep generateCoverage complexity ≤ 15.
  // Go: no config file — gate script handles coverage inline
  results.push(...emitSingleFileCoverage(config.language, base, data, opts.dryRun))

  return { files: results }
}

function emitSingleFileCoverage(
  language: string,
  base: string,
  data: Record<string, unknown>,
  dryRun: boolean,
): WriteResult[] {
  if (language === 'python') {
    return [
      writeFile(
        resolvedPath(base, '.coveragerc'),
        renderTemplate('coverage/.coveragerc.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    ]
  }
  if (language === 'kotlin') {
    return emitKotlinCoverage(base, data, dryRun)
  }
  return []
}

function emitKotlinCoverage(
  base: string,
  data: Record<string, unknown>,
  dryRun: boolean,
): WriteResult[] {
  const result = writeFile(
    resolvedPath(base, 'kover.gradle'),
    renderTemplate('coverage/kover.gradle.ejs', data),
    { skipIfExists: true, dryRun },
  )
  // #1887-F: kover.gradle was emitted but never wired — unlike jacoco, kover is a
  // marketplace plugin that MUST be declared in the root plugins block (with a
  // version) for its `kover {}` extension block to resolve at all. Withhold the
  // apply-from when the root build already configures `kover {}` inline.
  const applyKover = safeApplyFromSnippet(base, 'kover.gradle', {
    rootBuildSignatures: [/(?:^|\n)[ \t]*kover\s*\{/],
  })
  if (applyKover) {
    injectGradleWiring(base, dryRun, {
      plugins: [{ id: 'org.jetbrains.kotlinx.kover', version: KOVER_PLUGIN_VERSION }],
      snippets: [applyKover],
    })
  }
  return [result]
}

/**
 * Emit Rust coverage artifacts: .tarpaulin.toml plus the optional
 * Cargo.toml.profile.release snippet for binary archetypes (#359, INV-60).
 *
 * Extracted from generateCoverage to keep its cyclomatic complexity below the
 * project ceiling.
 */
function emitRustCoverage(
  base: string,
  config: ProjectConfig,
  data: Record<string, unknown>,
  dryRun: boolean,
): WriteResult[] {
  const out: WriteResult[] = [
    writeFile(
      resolvedPath(base, '.tarpaulin.toml'),
      renderTemplate('coverage/.tarpaulin.toml.ejs', data),
      { skipIfExists: true, dryRun },
    ),
  ]

  // Phase 7G: emit a profile.release snippet for binary archetypes only.
  // The template materializes at docs/coverage/Cargo.toml.profile.release so it
  // does not collide with an existing Cargo.toml — operators append the block
  // manually. INV-60 size check is wired separately in check-all.mjs.
  if (config.archetype === 'cli' || config.archetype === 'embedded') {
    out.push(
      writeFile(
        resolvedPath(base, 'docs', 'coverage', 'Cargo.toml.profile.release'),
        renderTemplate('coverage/Cargo.toml.profile.release.ejs', data),
        { skipIfExists: true, dryRun },
      ),
    )
  }

  return out
}
