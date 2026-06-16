// SPDX-License-Identifier: Apache-2.0
// Remediation handler dispatch (#1422).
//
// `planRemediation(gap)` is the LIVE entrypoint (consumed by `arbiter close-gold-gap` + #1421
// /levelup): it loads the validated catalog, resolves the (type,dimension) entry for the gap, and
// dispatches to the ONE handler for the entry's `kind`. Typed dispatch keyed by kind — NOT four
// ad-hoc clones (CANON-22). Deterministic: same gap ⇒ same plan.

import { loadCatalog, entryForGap } from '../catalog.js'
import type { PlaybookCatalog, RemediationGap, RemediationKind, RemediationPlan } from '../types.js'
import type { RemediationHandler } from './handler.js'
import { docSetHandler } from './doc-set.js'
import { testHandler } from './test.js'
import { configHandler } from './config.js'
import { processHandler } from './process.js'

/** kind → handler. Exhaustive over RemediationKind (a missing kind is a compile error). */
const HANDLERS: Record<RemediationKind, RemediationHandler> = {
  'doc-set': docSetHandler,
  test: testHandler,
  config: configHandler,
  process: processHandler,
}

/**
 * Produce a deterministic remediation plan for a single gold-audit gap.
 * @param gap the N/P check to remediate
 * @param opts.repo target repo root (informational — handlers never touch the filesystem)
 * @param opts.catalog override the loaded catalog (tests); defaults to the shipped catalog
 */
export function planRemediation(
  gap: RemediationGap,
  opts: { repo?: string; catalog?: PlaybookCatalog } = {},
): RemediationPlan {
  const catalog = opts.catalog ?? loadCatalog()
  const entry = entryForGap(catalog, gap.type, gap.dimension)
  const handler = HANDLERS[entry.kind]
  return handler(gap, { repo: opts.repo ?? process.cwd(), entry })
}
