// SPDX-License-Identifier: Apache-2.0
// #1253: ISO 9001 quality-process overlay generator.
//
// Orthogonal to the audit-trail overlays (pharma/sox/gdpr/generic, see pharma.ts):
// this overlay is about the QUALITY MANAGEMENT SYSTEM, not the audit trail. It emits
// three controlled documents plus one enforceable gate:
//   1. docs/quality/REQUIREMENTS_TRACEABILITY.md — requirement→test RTM (ISO 9001 §8.3/§8.5)
//   2. docs/quality/DOCUMENT_CONTROL.md           — controlled-document register (§7.5, doc_version)
//   3. docs/quality/CAPA_LOG.md                   — corrective/preventive-action log (§10.2)
//   4. scripts/check-iso9001.mjs                  — fail-closed gate validating the three above
//
// RTM reuse: the RTM doc mirrors the FEATURE_MATRIX RTM schema (sentinel-delimited
// table + status ladder) and the gate mirrors check-feature-matrix.mjs's sentinel-parse
// + ref-existence approach — making requirement→test traceability gate-checkable, not prose.
//
// Language-neutral: emits identical artefacts on every stack. Stacks naturally with the
// boolean compliance mappings (enableIso27001Mapping / enableNis2Mapping / enableGdprMapping)
// since those are separate config fields. (industryOverlay is single-valued, so iso9001
// cannot be co-selected with the pharma/cfr overlay via this field — see #1248.)

import { renderTemplate } from '../utils/render.js'
import { writeFile, resolvedPath } from '../utils/fs.js'
import type { ProjectConfig } from '../wizard/types.js'
import type { WriteResult } from '../utils/fs.js'

export interface Iso9001GeneratorResult {
  files: WriteResult[]
}

/**
 * Emit the ISO 9001 quality-process overlay. Fires only when
 * `industryOverlay === 'iso9001'`; returns no files for any other overlay
 * (orthogonal — does not hijack the audit-trail overlays).
 */
export function generateIso9001(
  config: ProjectConfig,
  opts: { dryRun: boolean } = { dryRun: false },
): Iso9001GeneratorResult {
  if (config.industryOverlay !== 'iso9001') {
    return { files: [] }
  }

  const base = config.targetDir
  const data = config
  const skip = { skipIfExists: true, dryRun: opts.dryRun } as const
  const qualityDir = 'docs/quality'

  const files = [
    writeFile(
      resolvedPath(base, qualityDir, 'REQUIREMENTS_TRACEABILITY.md'),
      renderTemplate('quality/iso9001/REQUIREMENTS_TRACEABILITY.md.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, qualityDir, 'DOCUMENT_CONTROL.md'),
      renderTemplate('quality/iso9001/DOCUMENT_CONTROL.md.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, qualityDir, 'CAPA_LOG.md'),
      renderTemplate('quality/iso9001/CAPA_LOG.md.ejs', data),
      skip,
    ),
    writeFile(
      resolvedPath(base, 'scripts', 'check-iso9001.mjs'),
      renderTemplate('scripts/check-iso9001.mjs.ejs', data),
      skip,
    ),
  ]

  return { files }
}
