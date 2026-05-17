// SPDX-License-Identifier: Apache-2.0
/**
 * Generator: GDPR Art.17 Erasure Runbook + Hook Stubs (#713)
 *
 * Consumer pain removed: GDPR Art.17 "right to erasure" requires cascading
 * deletes across every data store. Most implementations only disable the
 * identity-provider record instead of hard-deleting it — a compliance gap
 * discovered in viafera audit. This generator emits a 14-step runbook with
 * the correct IDP hard-delete step and per-language hook stubs that fail
 * loudly until filled in by the consuming team.
 */
import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface GdprErasureResult {
  files: WriteResult[]
}

function hookTemplate(language: ProjectConfig['language']): string {
  switch (language) {
    case 'typescript':
      return 'governance/gdpr-erasure-hooks/ts-express.ts.ejs'
    case 'java':
    case 'kotlin':
      return 'governance/gdpr-erasure-hooks/java-spring.java.ejs'
    case 'go':
      return 'governance/gdpr-erasure-hooks/go-chi.go.ejs'
    default:
      throw new Error(
        `generateGdprErasure: no hook stub template for language '${language}'. ` +
          `Add a template under src/templates/governance/gdpr-erasure-hooks/ and register it in hookTemplate().`,
      )
  }
}

function hookFilename(language: ProjectConfig['language']): string {
  switch (language) {
    case 'typescript':
      return 'GdprErasureService.ts'
    case 'java':
    case 'kotlin':
      return 'GdprErasureService.java'
    case 'go':
      return 'gdpr_erasure.go'
    default:
      throw new Error(`generateGdprErasure: no hook filename for language '${language}'.`)
  }
}

export function generateGdprErasure(config: ProjectConfig): GdprErasureResult {
  if (!config.enableGdprErasureRunbook) {
    return { files: [] }
  }

  const tmpl = hookTemplate(config.language)
  const fname = hookFilename(config.language)
  const hookDir = resolvedPath(config.targetDir, 'docs', 'SYSTEM', 'gdpr-erasure-hooks')
  const files: WriteResult[] = [
    writeFile(
      resolvedPath(config.targetDir, 'docs', 'SYSTEM', 'GDPR_ERASURE_RUNBOOK.md'),
      renderTemplate('governance/gdpr-erasure-runbook.md.ejs', config),
      { skipIfExists: true },
    ),
    writeFile(resolvedPath(hookDir, fname), renderTemplate(tmpl, config), { skipIfExists: true }),
  ]

  return { files }
}
