// SPDX-License-Identifier: Apache-2.0
/**
 * #1529: the knip gate must NOT suppress unused-type analysis.
 *
 * Historically `knip.json` carried `"exclude": ["types", "nsTypes",
 * "enumMembers"]`. That suppression is inherited by every plain `npx knip` run —
 * including the gate (`scripts/check-all.mjs`) and the `deadCode` debt metric
 * (`scripts/debt-lib.mjs`) — so dead exported types/interfaces were invisible
 * repo-wide (88 across 52 files were frozen in). After the #1529 burn-down the
 * exclude is dropped so any future dead type export is a hard gate failure.
 *
 * This test locks that contract: it fails the moment someone re-adds a
 * type-suppressing key to the knip exclude list.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

describe('knip type-export enforcement (#1529)', () => {
  it('knip.json does not suppress type / namespace-type / enum-member analysis', () => {
    const knip = JSON.parse(readFileSync(join(ROOT, 'knip.json'), 'utf8')) as {
      exclude?: string[]
    }
    const exclude = knip.exclude ?? []
    for (const suppressed of ['types', 'nsTypes', 'enumMembers']) {
      expect(exclude).not.toContain(suppressed)
    }
  })
})
