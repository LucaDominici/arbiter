// SPDX-License-Identifier: Apache-2.0
/**
 * #2009 (#1888 pattern): locks the cut of the genuinely-dead zero-caller scripts
 * so a future re-add is a hard test failure, not a silent regrowth.
 *
 * Proof of zero callers at cut time (grep across the whole tree minus
 * node_modules/.git/dist, i.e. package.json, .github/, .claude/, scripts/,
 * src/, src/templates/, docs/, website/):
 *   - scripts/docs-backfill-tags.mjs — one-shot P5 tag backfill, already applied.
 *     Only remaining mentions are historical CHANGELOG entries. Also carried a
 *     fail-closed baseline entry, pruned here so it cannot suppress nothing.
 *   - scripts/migrate-decisions-to-adr-files.mjs — self-declared one-time Wave 2
 *     migration, already applied (docs/internal/ADR/ is per-file today).
 *
 * NOT cut, against the issue's original list: scripts/update-kit-baseline.mjs.
 * Zero callers, but not dead — it is the SOLE regenerator of src/kit/baseline.json,
 * which is live: __tests__/kit/catalog.test.ts reads it for the TML ratchet and the
 * per-stack gap-count ratchet. It is a hand-invoked maintenance tool, exactly like
 * the `--update-baseline` mode of the other ratchet gates, and it runs correctly
 * today (verified: regenerates a byte-plausible baseline off the built
 * src/kit/derived.json). Deleting it would leave a live ratchet with no way to
 * move — the same dormant-enforcement pathology this cluster exists to fix.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

const CUT = ['scripts/docs-backfill-tags.mjs', 'scripts/migrate-decisions-to-adr-files.mjs']

describe('dead zero-caller scripts stay cut (#2009)', () => {
  it.each(CUT)('%s no longer exists', (rel) => {
    expect(existsSync(join(ROOT, rel))).toBe(false)
  })

  // #2418: baseline rows are dated/owned objects, not bare strings.
  const baselinePaths = (): string[] =>
    (
      JSON.parse(readFileSync(join(ROOT, 'scripts/data/fail-closed-baseline.json'), 'utf8')) as {
        files: { file: string }[]
      }
    ).files.map((e) => e.file)

  it('fail-closed-baseline.json no longer lists the deleted scripts', () => {
    for (const rel of CUT) expect(baselinePaths()).not.toContain(rel)
  })

  it('keeps update-kit-baseline.mjs — sole regenerator of the live src/kit ratchet', () => {
    expect(existsSync(join(ROOT, 'scripts/update-kit-baseline.mjs'))).toBe(true)
    expect(baselinePaths()).toContain('scripts/update-kit-baseline.mjs')
  })
})
