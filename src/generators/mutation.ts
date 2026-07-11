// SPDX-License-Identifier: Apache-2.0
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import { injectGradleWiring, safeApplyFromSnippet } from '../utils/gradle.js'
import { resolveEffectiveThresholds } from '../config/thresholds.js'
import { isL3Allowed } from '../utils/maturity-check.js'
import { levelAtLeast } from '../config/levels.js'
import { releaseEnforcesMutation } from './github.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

// Pinned in the injected root-build wiring; the template no longer carries a
// plugins {} block (illegal inside an applied script — #1835-class fix).
const PITEST_PLUGIN_VERSION = '1.15.0'

export interface MutationGeneratorResult {
  files: WriteResult[]
}

function shouldEmit(target: 'java' | 'typescript', language: string, acceptBeta: boolean): boolean {
  if (language === target) return true
  if (language !== 'multi') return false
  return isL3Allowed(target, 'mutation', acceptBeta).allowed
}

function emitJavaMutation(
  targetDir: string,
  buildTool: string,
  data: object,
  dryRun: boolean,
): WriteResult {
  if (buildTool === 'maven') {
    return writeFile(
      resolvedPath(targetDir, 'docs', 'mutation', 'pitest-maven-setup.md'),
      renderTemplate('mutation/pitest-maven-setup.md.ejs', data),
      { skipIfExists: true, dryRun },
    )
  }
  const result = writeFile(
    resolvedPath(targetDir, 'gradle', 'pitest.gradle'),
    renderTemplate('mutation/pitest.gradle.ejs', data),
    { skipIfExists: true, dryRun },
  )
  // #1835-class fix: the gate runs `./gradlew pitest`, which only exists once
  // the plugin is declared in the ROOT plugins block (illegal in the applied
  // script). The apply(from=...) is guarded — a pre-fix pitest.gradle that
  // still carries a plugins {} block is left unwired rather than breaking the build.
  const apply = safeApplyFromSnippet(targetDir, 'gradle/pitest.gradle')
  injectGradleWiring(targetDir, dryRun, {
    plugins: [{ id: 'info.solidsoft.pitest', version: PITEST_PLUGIN_VERSION }],
    snippets: apply ? [apply] : [],
  })
  return result
}

export function generateMutation(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): MutationGeneratorResult {
  // #1543 — emit mutation configs at L3+ (always), OR at any level whose release
  // workflow enforces mutation as BLOCKING (non-starter pipeline style). Previously
  // gated on L3+ only, which left L1/L2 standard pipelines (e.g. peer-review L2,
  // gated-review L1/L2) running 05-release's mutation-blocking job with no config →
  // a zero-mutant fallback that the #1505 fail-on-empty guard fails. Starter pipelines
  // at L1/L2 (e.g. trunk-solo) emit no release, so they still emit no config.
  if (!levelAtLeast(config.governanceLevel, 'L3') && !releaseEnforcesMutation(config)) {
    return { files: [] }
  }

  const { language, targetDir, acceptBetaTools = false } = config

  if (language !== 'multi') {
    const gate = isL3Allowed(language, 'mutation', acceptBetaTools)
    if (!gate.allowed) return { files: [] }
  }

  const data: object = {
    ...config,
    // #1527 — resolve via the single shared precedence rule (same as check-all +
    // coverage); replaces the old hardcoded `?? 85` that ignored computeThresholds.
    mutationThreshold: resolveEffectiveThresholds(config).mutationScore,
    basePackage: config.basePackage ?? 'com.example',
    modulePath: config.projectName.replace(/-/g, '_'),
  }

  const files: WriteResult[] = [
    // #1887-C: the per-stack setup doc — written already, never rendered.
    writeFile(
      resolvedPath(targetDir, 'docs', 'mutation', 'README.md'),
      renderTemplate('mutation/README.md.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  if (shouldEmit('java', language, acceptBetaTools)) {
    files.push(emitJavaMutation(targetDir, config.buildTool, data, opts.dryRun))
  }
  if (shouldEmit('typescript', language, acceptBetaTools)) {
    files.push(
      writeFile(
        resolvedPath(targetDir, 'stryker.conf.json'),
        renderTemplate('mutation/stryker.conf.json.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }
  if (language === 'rust') {
    files.push(
      writeFile(
        resolvedPath(targetDir, 'cargo-mutants.toml'),
        renderTemplate('mutation/cargo-mutants.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(targetDir, 'scripts', 'parse-mutants.mjs'),
        renderTemplate('mutation/parse-mutants.mjs.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  } else if (language === 'python') {
    files.push(
      writeFile(
        resolvedPath(targetDir, 'mutmut-config.toml'),
        renderTemplate('mutation/mutmut-config.toml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
      writeFile(
        resolvedPath(targetDir, 'scripts', 'parse-mutmut.py'),
        renderTemplate('mutation/parse-mutmut.py.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files }
}
