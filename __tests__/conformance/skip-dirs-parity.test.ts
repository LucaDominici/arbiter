// SPDX-License-Identifier: Apache-2.0
// SKIP_DIRS TS↔mjs parity (#1521).
//
// The conformance engine (src/conformance/shared.ts) and the presence-gate .mjs walker
// (scripts/lib/glob-walk.mjs) each define a SKIP_DIRS prune-set. They are the single source of
// truth for "which vendor/build trees a repo walk prunes". The #1521 revolution unified ~30
// hand-rolled walkers onto these two helpers; this gate locks the two skip-lists byte-identical so
// the policy can never silently re-diverge (the exact drift the duplication ratchet cannot see).
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { SKIP_DIRS as TS_SKIP_DIRS } from '../../src/conformance/shared.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
// Import the real shipped .mjs SSOT (not a re-implementation) so the gate guards the live file.
const { SKIP_DIRS: MJS_SKIP_DIRS } = (await import(
  join(REPO_ROOT, 'scripts/lib/glob-walk.mjs')
)) as { SKIP_DIRS: ReadonlySet<string> }

describe('SKIP_DIRS TS↔mjs parity (#1521)', () => {
  it('the conformance (TS) and presence-gate (mjs) skip-lists are byte-identical', () => {
    const ts = [...TS_SKIP_DIRS].sort()
    const mjs = [...MJS_SKIP_DIRS].sort()
    expect(ts).toEqual(mjs)
  })

  it('the unified skip-list prunes every vendor/build tree the revolution consolidated', () => {
    for (const dir of ['node_modules', '.git', 'dist', 'build', 'coverage', '.coverage']) {
      expect(TS_SKIP_DIRS.has(dir)).toBe(true)
    }
  })
})
