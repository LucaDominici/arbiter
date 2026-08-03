// SPDX-License-Identifier: Apache-2.0
// RED phase (#2221): `update` preserves what the project added but never RETIRES
// what the framework retired — an arbiter-owned hook deleted from arbiter stays
// on every consumer forever (the DEAD-hook finding that reddened the Consumer
// Reliability Bar). Pure decision unit-tested directly: only a PRISTINE
// safety-class orphan may be deleted; a user-modified one is reported, never
// removed; anything outside the safety class is reported only.
import { describe, it, expect } from 'vitest'
import { planRetirement, retirementWarning } from '../../src/commands/retire-policy.js'
import type { WriteResult } from '../../src/utils/fs.js'

const DEAD = '.claude/hooks/pre-task-track-detect.mjs'
const LIVE = '.claude/hooks/stop-dangerous.mjs'

function plan(
  opts: Partial<Parameters<typeof planRetirement>[0]> & {
    prevManifest: Record<string, string>
    results: WriteResult[]
    diskHash: (key: string) => string | null
  },
) {
  return planRetirement({
    targetDir: '/p',
    fullRegistryRun: true,
    ...opts,
  })
}

describe('planRetirement (#2221)', () => {
  it('retires a PRISTINE arbiter-owned hook the current version no longer emits', () => {
    const result = plan({
      prevManifest: { [DEAD]: 'deadhash', [LIVE]: 'livehash' },
      results: [{ path: '/p/.claude/hooks/stop-dangerous.mjs', action: 'skipped' }],
      diskHash: (key) => (key === DEAD ? 'deadhash' : 'livehash'),
    })
    expect(result.retire).toEqual([DEAD])
    expect(result.orphans).toEqual([])
    expect(result.stale).toEqual([])
  })

  it('REPORTS but never deletes a user-modified orphan hook', () => {
    const result = plan({
      prevManifest: { [DEAD]: 'deadhash' },
      results: [],
      diskHash: () => 'user-edited-hash',
    })
    expect(result.retire).toEqual([])
    expect(result.orphans).toEqual([DEAD])
  })

  it('never deletes outside the safety class — a prior-only script is reported only', () => {
    const result = plan({
      prevManifest: { 'scripts/check-legacy.mjs': 'h', 'docs/OLD.md': 'h' },
      results: [],
      diskHash: () => 'h',
    })
    expect(result.retire).toEqual([])
    expect(result.stale).toEqual(['docs/OLD.md', 'scripts/check-legacy.mjs'])
  })

  it('does NOT retire a WITHHELD hook — withheld means visited, not retired', () => {
    const result = plan({
      prevManifest: { [LIVE]: 'livehash' },
      results: [{ path: '/p/.claude/hooks/stop-dangerous.mjs', action: 'skipped', withheld: true }],
      diskHash: () => 'livehash',
    })
    expect(result.retire).toEqual([])
    expect(result.orphans).toEqual([])
  })

  it('does NOT retire a file the generator deliberately did not emit (not-applicable)', () => {
    const result = plan({
      prevManifest: { 'GLOBAL_INVARIANTS.md': 'h' },
      results: [{ path: '/p/GLOBAL_INVARIANTS.md', action: 'skipped', reason: 'not-applicable' }],
      diskHash: () => 'h',
    })
    expect(result.stale).toEqual([])
  })

  it('retires nothing on a SELECTIVE run — un-visited generators are not evidence of retirement', () => {
    const result = plan({
      prevManifest: { [DEAD]: 'deadhash' },
      results: [],
      diskHash: () => 'deadhash',
      fullRegistryRun: false,
    })
    expect(result).toEqual({ retire: [], orphans: [], stale: [] })
  })

  it('ignores a manifest key whose file is already gone from disk', () => {
    const result = plan({
      prevManifest: { [DEAD]: 'deadhash' },
      results: [],
      diskHash: () => null,
    })
    expect(result).toEqual({ retire: [], orphans: [], stale: [] })
  })
})

describe('retirementWarning (#2221)', () => {
  it('is null when there is nothing to report', () => {
    expect(retirementWarning({ retire: [], orphans: [], stale: [] })).toBeNull()
  })

  it('names the user-modified orphan and tells the operator to remove it by hand', () => {
    const warning = retirementWarning({ retire: [], orphans: [DEAD], stale: [] })
    expect(warning).toContain(DEAD)
    expect(warning).toContain('by hand')
  })

  it('reports stale non-safety files without claiming they were removed', () => {
    const warning = retirementWarning({ retire: [], orphans: [], stale: ['docs/OLD.md'] })
    expect(warning).toContain('docs/OLD.md')
    expect(warning).not.toContain('removed')
  })
})
