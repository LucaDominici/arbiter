// SPDX-License-Identifier: Apache-2.0
// RED phase (acceptance-anchor, INV-137): the pure acceptance-criteria lib must parse
// AC checkboxes / non-goals / touches out of issue bodies and plan files, classify
// readiness (explicit AC-N ids required, stock template lines don't count), and
// validate the ac-fit evidence artifact. No I/O — everything here is pure.
import { describe, it, expect } from 'vitest'
import {
  parseAcceptanceBlocks,
  assessReadiness,
  renderClarificationComment,
  parsePlanAnchor,
  computeAcHash,
  validateAcFit,
} from '../../scripts/lib/acceptance-criteria.mjs'

const READY_BODY = [
  '### Objective',
  'Add a retry to the fetcher.',
  '### Acceptance criteria',
  '- [ ] AC-1: fetcher retries 3 times on 5xx with backoff',
  '- [ ] AC-2: retry exhaustion surfaces the last error to the caller',
  '### Non-goals',
  '- No circuit breaker in this task',
  '### Files / contracts touched',
  '- src/fetcher.ts',
].join('\n')

describe('parseAcceptanceBlocks', () => {
  it('extracts explicit AC-N criteria, non-goals and touches', () => {
    const r = parseAcceptanceBlocks(READY_BODY)
    expect(r.criteria).toHaveLength(2)
    expect(r.criteria[0]).toMatchObject({ id: 'AC-1', explicit: true })
    expect(r.criteria[1].text).toContain('retry exhaustion')
    expect(r.nonGoals).toEqual(['No circuit breaker in this task'])
    expect(r.touches).toEqual(['src/fetcher.ts'])
  })

  it('normalizes CRLF (GitHub form output)', () => {
    const r = parseAcceptanceBlocks(READY_BODY.split('\n').join('\r\n'))
    expect(r.criteria).toHaveLength(2)
    expect(r.nonGoals).toHaveLength(1)
  })

  it('assigns positional ids to bare checkboxes and marks them non-explicit', () => {
    const body = '### Acceptance criteria\n- [ ] first thing\n- [ ] AC-7: explicit thing'
    const r = parseAcceptanceBlocks(body)
    expect(r.criteria[0]).toMatchObject({ id: 'AC-1', explicit: false })
    expect(r.criteria[1]).toMatchObject({ id: 'AC-7', explicit: true })
  })

  it('matches headings at any level and checked boxes', () => {
    const body = '## Acceptance Criteria\n- [x] AC-1: done thing\n#### Non-Goals\n- nope'
    const r = parseAcceptanceBlocks(body)
    expect(r.criteria).toHaveLength(1)
    expect(r.nonGoals).toEqual(['nope'])
  })

  it('returns empty sets for an empty or heading-free body', () => {
    expect(parseAcceptanceBlocks('just prose')).toEqual({ criteria: [], nonGoals: [], touches: [] })
  })

  it('recognizes numbered/emphasized form headings (### 6. Non-Goals) — red-team F2', () => {
    const body = [
      '### 5. Acceptance Criteria',
      '- [ ] AC-1: does the thing',
      '### 6. Non-Goals',
      '- not that thing',
      '### 2. Technical Scope',
      '- src/x.ts',
    ].join('\n')
    const r = parseAcceptanceBlocks(body)
    expect(r.criteria).toHaveLength(1)
    expect(r.nonGoals).toEqual(['not that thing'])
    expect(r.touches).toEqual(['src/x.ts'])
  })

  it('never parses fenced code blocks quoting the grammar — red-team F4', () => {
    const body = [
      'Docs example:',
      '```md',
      '### Acceptance criteria',
      '- [ ] AC-1: sample only',
      '### Non-goals',
      '- sample',
      '```',
    ].join('\n')
    expect(parseAcceptanceBlocks(body)).toEqual({ criteria: [], nonGoals: [], touches: [] })
  })

  it('does not classify unrelated headings like "Profiles" as touches — red-team F11', () => {
    const body = '## Profiles\n- some bullet'
    expect(parseAcceptanceBlocks(body).touches).toEqual([])
  })

  it('accepts wave-namespaced ids (AC-123.1) as explicit', () => {
    const body = '### Acceptance criteria\n- [ ] AC-123.1: group-scoped behavior'
    const r = parseAcceptanceBlocks(body)
    expect(r.criteria[0]).toMatchObject({ id: 'AC-123.1', explicit: true })
  })
})

describe('assessReadiness', () => {
  it('is ready for a fully specified body', () => {
    expect(assessReadiness(READY_BODY)).toEqual({ ready: true, missing: [] })
  })

  it('is not ready when criteria are only the template stock lines', () => {
    const body = [
      '### Acceptance criteria',
      '- [ ] Gate L1 passes',
      '- [ ] Gate L2 passes',
      '- [ ] Tests cover new behavior',
      '### Non-goals',
      '- none',
      '### Files / contracts touched',
      '- src/x.ts',
    ].join('\n')
    const r = assessReadiness(body)
    expect(r.ready).toBe(false)
    expect(r.missing.join(' ')).toMatch(/stock|template/i)
  })

  it('is not ready when checkboxes lack explicit AC-N ids (renumbering hazard)', () => {
    const body = READY_BODY.replace('AC-1: ', '').replace('AC-2: ', '')
    const r = assessReadiness(body)
    expect(r.ready).toBe(false)
    expect(r.missing.join(' ')).toMatch(/AC-N/i)
  })

  it('lists every missing dimension', () => {
    const r = assessReadiness('### Objective\nvague wish')
    expect(r.ready).toBe(false)
    expect(r.missing.length).toBeGreaterThanOrEqual(3)
  })
})

describe('renderClarificationComment', () => {
  it('renders a checklist naming each missing item', () => {
    const { missing } = assessReadiness('nothing here')
    const c = renderClarificationComment(missing)
    expect(c).toContain('needs-clarification')
    for (const m of missing) expect(c).toContain(m)
  })
})

describe('parsePlanAnchor', () => {
  it('reads the frozen AC + non-goals out of a plan body', () => {
    const plan = [
      '---',
      'context:',
      '  issue: "#42"',
      '---',
      '# Plan',
      '## Acceptance Criteria',
      '- [ ] AC-1: observable behavior one',
      '## Non-Goals',
      '- out of scope thing',
    ].join('\n')
    const r = parsePlanAnchor(plan)
    expect(r).not.toBeNull()
    expect(r?.criteria).toHaveLength(1)
    expect(r?.nonGoals).toHaveLength(1)
  })

  it('returns null when the anchor sections are absent', () => {
    expect(parsePlanAnchor('# Plan\nno sections')).toBeNull()
  })
})

describe('computeAcHash', () => {
  it('is stable across whitespace and checkbox state, sensitive to text', () => {
    const a = parseAcceptanceBlocks(READY_BODY).criteria
    const b = parseAcceptanceBlocks(READY_BODY.replace('- [ ] AC-1', '- [x]  AC-1')).criteria
    expect(computeAcHash(a)).toBe(computeAcHash(b))
    const c = parseAcceptanceBlocks(READY_BODY.replace('3 times', '4 times')).criteria
    expect(computeAcHash(c)).not.toBe(computeAcHash(a))
  })
})

describe('validateAcFit', () => {
  const fit = {
    schema: 'arbiter-ac-fit-v1',
    taskId: '#42',
    sha: 'abc',
    criteria: [
      { id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'src/fetcher.ts', line: 10 }] },
      { id: 'AC-2', verdict: 'PASS', evidence: [{ file: '__tests__/f.test.ts', line: 4 }] },
    ],
  }

  it('accepts a complete, covering artifact', () => {
    expect(validateAcFit(fit, ['AC-1', 'AC-2'])).toEqual([])
  })

  it('reports uncovered and unknown criteria ids', () => {
    const errs = validateAcFit(fit, ['AC-1', 'AC-2', 'AC-3'])
    expect(errs.join(' ')).toContain('AC-3')
    const errs2 = validateAcFit(fit, ['AC-1'])
    expect(errs2.join(' ')).toContain('AC-2')
  })

  it('rejects bad schema, bad verdicts, and PASS without evidence', () => {
    expect(validateAcFit({ schema: 'nope', criteria: [] }, []).length).toBeGreaterThan(0)
    const badVerdict = {
      ...fit,
      criteria: [{ id: 'AC-1', verdict: 'MAYBE', evidence: [{ file: 'x', line: 1 }] }],
    }
    expect(validateAcFit(badVerdict, ['AC-1']).join(' ')).toMatch(/verdict/i)
    const noEvidence = { ...fit, criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [] }] }
    expect(validateAcFit(noEvidence, ['AC-1']).join(' ')).toMatch(/evidence/i)
  })

  it('rejects duplicate ids, stale taskId, and non-integer evidence lines — red-team F3/F12', () => {
    const dup = {
      ...fit,
      criteria: [
        { id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'a.ts', line: 1 }] },
        { id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'b.ts', line: 2 }] },
      ],
    }
    expect(validateAcFit(dup, ['AC-1']).join(' ')).toMatch(/duplicated/)
    expect(validateAcFit(fit, ['AC-1', 'AC-2'], { expectedTaskId: '#43' }).join(' ')).toMatch(
      /does not match/,
    )
    const nanLine = {
      ...fit,
      criteria: [{ id: 'AC-1', verdict: 'PASS', evidence: [{ file: 'a.ts', line: NaN }] }],
    }
    expect(validateAcFit(nanLine, ['AC-1']).join(' ')).toMatch(/evidence/)
  })

  it('optionally requires every verdict to be PASS', () => {
    const notTested = {
      ...fit,
      criteria: [{ id: 'AC-1', verdict: 'NOT-TESTED', evidence: [] }],
    }
    expect(validateAcFit(notTested, ['AC-1'], { requireAllPass: true }).join(' ')).toMatch(
      /NOT-TESTED|not PASS/i,
    )
  })
})
