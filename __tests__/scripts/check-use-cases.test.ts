// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the pure functions of scripts/check-use-cases.mjs (INV-149, #2480 wave 8).
 *
 * The EMITTED gate is exercised end-to-end in __tests__/templates/track-b-evidence-gates.test.ts,
 * which renders it into a project-shaped tree and runs it — that is where the rules are proven,
 * because arbiter's own copy skips. This file covers the parsers and the projection, which are the
 * parts a subprocess test can only observe indirectly.
 *
 * Existing Code Survey (CANON-16): the sentinel-block reader mirrors check-id-registry.mjs's, which
 * is the established shape for a markdown SSOT carrying a machine block; the schema validator and
 * the main-module guard are imported from scripts/lib rather than reimplemented.
 */
import { describe, it, expect } from 'vitest'
import {
  extractBlock,
  findDuplicateIds,
  findDanglingFeatures,
  parseMatrixIds,
  parseScenarioExercises,
  findJoinViolations,
  useCaseProjection,
} from '../../scripts/check-use-cases.mjs'

const block = (json: string): string =>
  `# Use cases\n\n<!-- USE_CASES_START -->\n\`\`\`json\n${json}\n\`\`\`\n<!-- USE_CASES_END -->\n`

const uc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'UC-01',
  actor: 'Traveler',
  goal: 'Search and filter trips',
  featureIds: ['F-TRIP-SEARCH'],
  ...over,
})

describe('extractBlock', () => {
  it('reads the fenced JSON between the sentinels', () => {
    expect(extractBlock(block('{"useCases":[]}'))).toEqual({ ok: true, document: { useCases: [] } })
  })

  it('reports missing sentinels rather than throwing', () => {
    const out = extractBlock('# Use cases\n\nprose only\n')
    expect(out.ok).toBe(false)
    expect(out).toHaveProperty('error', expect.stringContaining('sentinel pair'))
  })

  it('reports a sentinel pair in the wrong order', () => {
    expect(extractBlock('<!-- USE_CASES_END -->\n<!-- USE_CASES_START -->').ok).toBe(false)
  })

  it('reports sentinels with no fence between them', () => {
    const out = extractBlock('<!-- USE_CASES_START -->\nno fence\n<!-- USE_CASES_END -->')
    expect(out).toHaveProperty('error', expect.stringContaining('json fence'))
  })

  it('reports malformed JSON as a blocking result rather than throwing', () => {
    const out = extractBlock(block('{not json'))
    expect(out.ok).toBe(false)
    expect(out).toHaveProperty('error', expect.stringContaining('not valid JSON'))
  })
})

describe('parseMatrixIds', () => {
  const MATRIX = [
    '| feature_id | capability |',
    '| --- | --- |',
    '| F-TRIP-SEARCH | search |',
    '| REQ-001 | something |',
    'prose that is not a row',
  ].join('\n')

  it('collects the ids in the first column', () => {
    const ids = parseMatrixIds(MATRIX)
    expect(ids.has('F-TRIP-SEARCH')).toBe(true)
    expect(ids.has('REQ-001')).toBe(true)
  })

  it('excludes the header and separator, which have the same shape as a row', () => {
    const ids = parseMatrixIds(MATRIX)
    expect(ids.has('feature_id')).toBe(false)
    expect(ids.size).toBe(2)
  })
})

describe('findDanglingFeatures — the rule the gate exists for', () => {
  const known = new Set(['F-TRIP-SEARCH'])

  it('reports a featureId the matrix does not declare', () => {
    const found = findDanglingFeatures([uc({ featureIds: ['F-GONE'] })], known)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/featureId "F-GONE" is not a row/)
  })

  it('is silent when every ref resolves', () => {
    expect(findDanglingFeatures([uc()], known)).toEqual([])
  })

  it('reports every dangling ref on one use case, not merely the first', () => {
    expect(findDanglingFeatures([uc({ featureIds: ['F-A', 'F-B'] })], known)).toHaveLength(2)
  })
})

describe('findDuplicateIds', () => {
  it('reports two use cases sharing an id', () => {
    expect(findDuplicateIds([uc(), uc()])).toEqual(['duplicate use-case id "UC-01"'])
  })
})

describe('parseScenarioExercises', () => {
  const DOC = [
    '## 1. First journey',
    '',
    '- **Exercises:** `UC-01`, `UC-02`',
    '',
    '## 2. Second journey',
    '',
    '- **Exercises:** `UC-01`',
    '',
    '## 3. Walks nothing',
    '',
    '- **Slug:** `x`',
  ].join('\n')

  it('maps each use case to every scenario that names it', () => {
    const m = parseScenarioExercises(DOC)
    expect(m.get('UC-01')).toEqual(['1. First journey', '2. Second journey'])
    expect(m.get('UC-02')).toEqual(['1. First journey'])
  })

  it('ignores a scenario with no Exercises line', () => {
    expect(parseScenarioExercises(DOC).size).toBe(2)
  })

  it('returns an empty map for a document with no scenarios', () => {
    expect(parseScenarioExercises('# Nothing here\n').size).toBe(0)
  })
})

describe('findJoinViolations — both directions', () => {
  it('reports a scenario exercising a use case that does not exist', () => {
    const found = findJoinViolations([uc()], new Map([['UC-99', ['1. A journey']]]))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/exercises "UC-99", which is not a declared use case/)
  })

  it('reports status "exercised" that no scenario walks — status is not a walk', () => {
    const found = findJoinViolations([uc({ status: 'exercised' })], new Map())
    expect(found[0]).toMatch(/claims status "exercised" but no tabletop scenario names it/)
  })

  it('is silent when an exercised use case is actually walked', () => {
    const m = new Map([['UC-01', ['1. A journey']]])
    expect(findJoinViolations([uc({ status: 'exercised' })], m)).toEqual([])
  })

  it('demands no walk of a use case that does not claim one', () => {
    expect(findJoinViolations([uc({ status: 'linked' })], new Map())).toEqual([])
  })
})

/**
 * The projection forma's traceability lens consumes. `exercisedBy` is DERIVED from the scenarios
 * the gate just read, not copied from the declared `status` — the two can disagree and only one of
 * them is checkable, so the projection carries the measurement.
 */
describe('useCaseProjection', () => {
  it('derives exercisedBy from the scenarios, not from the declared status', () => {
    const p = useCaseProjection([uc({ status: 'linked' })], new Map([['UC-01', ['2. A journey']]]))
    expect(p.useCases[0]).toMatchObject({ status: 'linked', exercisedBy: ['2. A journey'] })
  })

  it('reports an empty exercisedBy for a use case nothing walks', () => {
    expect(useCaseProjection([uc()], new Map()).useCases[0]).toMatchObject({ exercisedBy: [] })
  })

  it('sorts use cases and their feature ids, so two runs diff meaningfully', () => {
    const p = useCaseProjection(
      [uc({ id: 'UC-02' }), uc({ featureIds: ['F-B', 'F-A'] })],
      new Map(),
    )
    expect(p.useCases.map((u) => u['id'])).toEqual(['UC-01', 'UC-02'])
    expect(p.useCases[0]['featureIds']).toEqual(['F-A', 'F-B'])
  })

  it('omits journeyIds and prdRef when absent, so "not declared" stays distinguishable', () => {
    const row = useCaseProjection([uc()], new Map()).useCases[0]
    expect(row).not.toHaveProperty('journeyIds')
    expect(row).not.toHaveProperty('prdRef')
  })

  it('carries them when present', () => {
    const row = useCaseProjection([uc({ journeyIds: ['JB-02'], prdRef: 'PRD §3' })], new Map())
      .useCases[0]
    expect(row).toMatchObject({ journeyIds: ['JB-02'], prdRef: 'PRD §3' })
  })

  it('declares its schema version, which is what a consumer checks before trusting the shape', () => {
    expect(useCaseProjection([], new Map()).schema).toBe('arbiter-use-cases-v1')
  })
})
