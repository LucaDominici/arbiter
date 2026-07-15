// SPDX-License-Identifier: Apache-2.0
/**
 * #1888 (ponytail YAGNI audit): locks the outcome of the dead-export cut so a
 * future re-add of any of this dead surface is a hard test failure, not just
 * a knip hint someone can ignore.
 *
 * `knip --include-entry-exports` found these entirely unreferenced (never
 * imported by any .mjs/.ts/.ejs; the "consumers" all take the same-shaped
 * data as a plain parameter instead):
 *   - scripts/lib/check-registry.mjs (whole file)
 *   - scripts/lib/full-gate-blacklist.mjs (whole file)
 *   - scripts/lib/suppressions-shared.mjs: parseMetaComment (dead export —
 *     has a local twin in check-suppressions.mjs), plus REASON_MIN_LEN /
 *     WARN_DAYS / checkExpiry (used only in-file by validateEntry, never
 *     imported externally — no reason to keep them on the module's export
 *     surface)
 *
 * This test pins that removal: RED before the cut (files/exports present),
 * GREEN after (gone). See .arbiter/evidence/tdd/#1888.json for the recorded
 * red-phase run.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

describe('dead script-lib exports stay cut (#1888)', () => {
  it('scripts/lib/check-registry.mjs no longer exists', () => {
    expect(existsSync(join(ROOT, 'scripts/lib/check-registry.mjs'))).toBe(false)
  })

  it('scripts/lib/full-gate-blacklist.mjs no longer exists', () => {
    expect(existsSync(join(ROOT, 'scripts/lib/full-gate-blacklist.mjs'))).toBe(false)
  })

  it('suppressions-shared.mjs does not re-export the dead symbols', async () => {
    const mod = (await import('../../scripts/lib/suppressions-shared.mjs')) as Record<
      string,
      unknown
    >
    expect(mod.parseMetaComment).toBeUndefined()
    expect(mod.REASON_MIN_LEN).toBeUndefined()
    expect(mod.WARN_DAYS).toBeUndefined()
    expect(mod.checkExpiry).toBeUndefined()
    // the live export surface used by check-suppressions.mjs / check-inline-suppressions.mjs
    // must still be there
    expect(typeof mod.validateEntry).toBe('function')
    expect(typeof mod.parseArgs).toBe('function')
    expect(typeof mod.isAllowedByEntry).toBe('function')
  })

  it('knip.json no longer carries the redundant explicit entry patterns', () => {
    const knip = JSON.parse(readFileSync(join(ROOT, 'knip.json'), 'utf8')) as {
      workspaces: Record<string, { entry?: string[] }>
      ignoreBinaries?: string[]
    }
    const entry = knip.workspaces['.'].entry ?? []
    for (const redundant of [
      'src/cli.ts!',
      'src/types/plugin.ts!',
      'src/invariants/index.ts!',
      'src/compatibility/index.ts!',
    ]) {
      expect(entry).not.toContain(redundant)
    }
    for (const unused of ['cosign', 'java']) {
      expect(knip.ignoreBinaries ?? []).not.toContain(unused)
    }
  })

  it('fail-closed-baseline.json no longer lists the two deleted files', () => {
    const baseline = JSON.parse(
      readFileSync(join(ROOT, 'scripts/data/fail-closed-baseline.json'), 'utf8'),
    ) as { files: string[] }
    expect(baseline.files).not.toContain('scripts/lib/check-registry.mjs')
    expect(baseline.files).not.toContain('scripts/lib/full-gate-blacklist.mjs')
  })
})
