// SPDX-License-Identifier: Apache-2.0
//
// #1259 — gh-backed affinity adapter (subject + same-milestone sibling fetch).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as runCliModule from '../../src/utils/run-cli.js'

vi.mock('../../src/utils/run-cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/utils/run-cli.js')>()
  return { ...actual, runCliJson: vi.fn() }
})

const mockRunCliJson = vi.mocked(runCliModule.runCliJson)

describe('fetchAffinityContext', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('fetches subject + open same-milestone siblings (excluding self)', async () => {
    const { fetchAffinityContext } = await import('../../src/affinity/gh-issues.js')
    mockRunCliJson
      .mockReturnValueOnce({
        number: 1259,
        labels: [{ name: 'domain:dx' }],
        milestone: { title: 'M5' },
      })
      .mockReturnValueOnce([
        { number: 1259, labels: [{ name: 'domain:dx' }], milestone: { title: 'M5' } },
        { number: 1260, labels: [{ name: 'type:feat' }], milestone: { title: 'M5' } },
      ])

    const { subject, candidates } = fetchAffinityContext('#1259')
    expect(subject.id).toBe('#1259')
    expect(subject.milestone).toBe('M5')
    expect(candidates.map((c) => c.id)).toEqual(['#1260'])
  })

  it('returns no candidates (solo) when the subject has no milestone', async () => {
    const { fetchAffinityContext } = await import('../../src/affinity/gh-issues.js')
    mockRunCliJson.mockReturnValueOnce({ number: 1259, labels: [], milestone: null })

    const { subject, candidates } = fetchAffinityContext('#1259')
    expect(subject.milestone).toBeUndefined()
    expect(candidates).toEqual([])
    // only the subject view is called; no sibling list when there is no milestone
    expect(mockRunCliJson).toHaveBeenCalledTimes(1)
  })
})

describe('renderShipAffinityWithGh', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('renders an Affinity line and degrades (no throw) when gh fails', async () => {
    const { renderShipAffinityWithGh } = await import('../../src/affinity/gh-issues.js')
    mockRunCliJson.mockImplementation(() => {
      throw new Error('gh offline')
    })
    const lines = renderShipAffinityWithGh('#1259')
    expect(lines.some((l) => /Affinity.*unavailable/i.test(l))).toBe(true)
  })
})

describe('shipAffinityLines — cli glue (id resolution)', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('forwards the explicit id to the renderer', async () => {
    const { shipAffinityLines } = await import('../../src/affinity/gh-issues.js')
    const seen: string[] = []
    const render = (subject: string): string[] => {
      seen.push(subject)
      return [`Affinity: rendered ${subject}`]
    }
    const lines = shipAffinityLines('#42', undefined, render)
    expect(seen).toEqual(['#42'])
    expect(lines).toContain('Affinity: rendered #42')
  })

  it('returns the no-id advisory when no id and no task state exist', async () => {
    const { shipAffinityLines } = await import('../../src/affinity/gh-issues.js')
    let rendered = false
    const render = (): string[] => {
      rendered = true
      return []
    }
    // A tmp dir with no .claude/.task state → readUnifiedState returns null.
    const lines = shipAffinityLines(undefined, '/nonexistent-arbiter-affinity-dir', render)
    expect(rendered).toBe(false)
    expect(lines.some((l) => /unavailable.*no issue id/i.test(l))).toBe(true)
  })
})
