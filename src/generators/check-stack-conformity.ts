// SPDX-License-Identifier: Apache-2.0
// CATALOG: Stack-conformity generator (#1312, INV-121) — emits
// CATALOG:   scripts/check-stack-conformity.mjs into target projects when a
// CATALOG:   language is declared. The emitted gate fails when the repo-ROOT
// CATALOG:   manifest contradicts the declared language/databaseEngine axes.
// CATALOG: Self-safety lives in the emitted .mjs at RUNTIME (absent language ⇒
// CATALOG:   exit 0), not in render-time EJS — check-self-dogfood defaults the
// CATALOG:   render `language` to 'typescript', so a render gate would not gate off.
// CATALOG: Distinct from check-collab-mode-wired.ts (collaborationMode axis) — a
// CATALOG:   config-validator survey (CANON-16) found nothing inspecting
// CATALOG:   lockfile/go.mod, so this is a genuinely new responsibility.
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface StackConformityGeneratorResult {
  files: WriteResult[]
}

export function generateStackConformity(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): StackConformityGeneratorResult {
  const base = config.targetDir
  return {
    files: [
      writeFile(
        resolvedPath(base, 'scripts', 'check-stack-conformity.mjs'),
        renderTemplate('scripts/check-stack-conformity.mjs.ejs', config),
        { skipIfExists: true, dryRun: opts.dryRun },
      ),
    ],
  }
}
