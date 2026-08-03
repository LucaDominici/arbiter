// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path'
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface CiTierGeneratorResult {
  files: WriteResult[]
}

// Emits the 4 supplementary CI-tier artifacts (reusable workflow + label infra).
// Standard numbered CI workflows (01–09) remain owned by github.ts with ciTierMode awareness.
export function generateCiTier(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): CiTierGeneratorResult {
  if (!githubGenerationIsEnabled(config)) return { files: [] }

  const data = config
  const githubDir = resolvedPath(config.targetDir, '.github')
  const workflowsDir = join(githubDir, 'workflows')
  const actionsDir = join(githubDir, 'actions')

  const files: WriteResult[] = [
    writeFile(
      join(workflowsDir, '_notify.yml'),
      renderTemplate('github/workflows/_notify.yml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(
      join(workflowsDir, '_label-sync.yml'),
      renderTemplate('github/workflows/_label-sync.yml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
    writeFile(join(githubDir, 'labels.yml'), renderTemplate('github/labels.yml.ejs', data), {
      skipIfExists: true,
      dryRun: opts.dryRun,
    }),
    writeFile(
      join(actionsDir, 'setup-node-pnpm', 'action.yml'),
      renderTemplate('github/actions/setup-node-pnpm/action.yml.ejs', data),
      { skipIfExists: true, dryRun: opts.dryRun },
    ),
  ]

  // #943: opt-in post-merge CODEOWNERS email notification (L2+ only).
  // Requires MAIL_SERVER/MAIL_USERNAME/MAIL_PASSWORD secrets and MAIL_DOMAIN_ALLOWLIST var.
  if (shouldGenerateCodeownersNotification(config)) {
    files.push(
      writeFile(
        join(workflowsDir, '_post-merge-notify.yml'),
        renderTemplate('github/workflows/_post-merge-notify.yml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // #1226: Java projects emit the setup-java-maven composite action (both maven and gradle).
  // skipIfExists preserves any user customisation on re-init (CANON-11).
  // #1803: kotlin shares this action — it only sets up a JVM (Temurin) + restores
  // the Maven/Gradle cache, language-agnostic at the build-tool level. Needed by
  // 02-pr-extended.yml.ejs's license-scan and 05-release.yml.ejs's sbom job, both
  // of which now also cover kotlin.
  if (usesJavaBuildAction(config)) {
    files.push(
      writeFile(
        join(actionsDir, 'setup-java-maven', 'action.yml'),
        renderTemplate('github/actions/setup-java-maven/action.yml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  // C3 (#1497): parametric cross-job build cache composite action. Generalises the
  // Maven-reactor-only artifact handoff into a per-archetype strategy
  // (node-workspace | python-wheel | maven-reactor | gradle) with an immutable
  // run-id artifact key and a non-blocking rebuild fallback. Emitted for the
  // archetypes the strategy supports; Rust uses Swatinem/rust-cache instead and
  // is intentionally excluded. skipIfExists preserves user customisation (CANON-11).
  if (supportsCrossJobBuildCache(config)) {
    files.push(
      writeFile(
        join(actionsDir, 'build-cache', 'action.yml'),
        renderTemplate('github/actions/build-cache/action.yml.ejs', data),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    )
  }

  return { files }
}

function githubGenerationIsEnabled(config: ProjectConfig): boolean {
  return config.permitGitHub ?? config.useGitHub
}

function shouldGenerateCodeownersNotification(config: ProjectConfig): boolean {
  return config.governanceLevel !== 'L1' && config.enableCodeownersNotify === true
}

function usesJavaBuildAction(config: ProjectConfig): boolean {
  return config.language === 'java' || config.language === 'kotlin'
}

function supportsCrossJobBuildCache(config: ProjectConfig): boolean {
  return ['typescript', 'python', 'java'].includes(config.language)
}
