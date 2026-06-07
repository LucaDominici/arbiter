// SPDX-License-Identifier: Apache-2.0
// CATALOG: Anti-proforma generator — emits check-anti-proforma.mjs to target scripts/ dir (INV-118).
// CATALOG:   Activated for all languages (non-JVM: source-text scan, warn-default; JVM additional
// CATALOG:   bytecode enforcement is handled by archunit.ts → AntiProformaTest.java.ejs).
// CATALOG: Distinct from archunit.ts (JVM-specific bytecode scan). This generator handles non-JVM
// CATALOG:   stacks via source-text regex pattern matching on *.test.ts/*.spec.ts/*.test.mjs files.
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface AntiProformaGeneratorResult {
  files: WriteResult[]
}

export function generateAntiProforma(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): AntiProformaGeneratorResult {
  const base = config.targetDir
  const data = config

  return {
    files: [
      writeFile(
        resolvedPath(base, 'scripts', 'check-anti-proforma.mjs'),
        renderTemplate('scripts/check-anti-proforma.mjs.ejs', data),
        { dryRun: opts.dryRun },
      ),
    ],
  }
}
