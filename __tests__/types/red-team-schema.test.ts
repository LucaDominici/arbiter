// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import {
  ContextBlockSchema,
  RedTeamFindingSchema,
  RedTeamEvidenceV1,
} from '../../src/types/plan.js'

describe('ContextBlockSchema (#689)', () => {
  const baseFields = {
    type: 'feat',
    pipeline: 'plan → impl → gate → PR',
    branch_convention: 'task/#689-foo',
    base_branch: 'main',
    key_constraints: ['No any type'],
    red_team_warnings: ['Hook runs without npm deps'],
    estimate: 'S (2h)',
  }

  it('accepts singular issue form', () => {
    const result = ContextBlockSchema.safeParse({ context: { issue: '#689', ...baseFields } })
    expect(result.success).toBe(true)
  })

  it('accepts plural issues array form', () => {
    const result = ContextBlockSchema.safeParse({
      context: { issues: ['#689', '#690'], ...baseFields },
    })
    expect(result.success).toBe(true)
  })

  it('rejects when both issue and issues are absent', () => {
    const result = ContextBlockSchema.safeParse({ context: { ...baseFields } })
    expect(result.success).toBe(false)
  })

  it('rejects when issues array is empty', () => {
    const result = ContextBlockSchema.safeParse({ context: { issues: [], ...baseFields } })
    expect(result.success).toBe(false)
  })

  it('rejects missing pipeline field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pipeline: _, ...rest } = baseFields
    const result = ContextBlockSchema.safeParse({ context: { issue: '#689', ...rest } })
    expect(result.success).toBe(false)
  })

  it('rejects missing estimate field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { estimate: _, ...rest } = baseFields
    const result = ContextBlockSchema.safeParse({ context: { issue: '#689', ...rest } })
    expect(result.success).toBe(false)
  })

  it('rejects missing key_constraints field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { key_constraints: _, ...rest } = baseFields
    const result = ContextBlockSchema.safeParse({ context: { issue: '#689', ...rest } })
    expect(result.success).toBe(false)
  })

  it('rejects missing red_team_warnings field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { red_team_warnings: _, ...rest } = baseFields
    const result = ContextBlockSchema.safeParse({ context: { issue: '#689', ...rest } })
    expect(result.success).toBe(false)
  })
})

describe('RedTeamFindingSchema (#691)', () => {
  const validFinding = {
    id: 'RT-01',
    angle: 'security',
    impact: 'HIGH',
    description: 'SQL injection possible in query builder',
    recommendation: 'Use parameterized queries',
  }

  it('accepts a valid finding', () => {
    const result = RedTeamFindingSchema.safeParse(validFinding)
    expect(result.success).toBe(true)
  })

  it('accepts all valid impact levels', () => {
    for (const impact of ['CRITICAL', 'HIGH', 'MEDIUM', 'SUGGESTION']) {
      const result = RedTeamFindingSchema.safeParse({ ...validFinding, impact })
      expect(result.success).toBe(true)
    }
  })

  it('accepts all valid angle values', () => {
    const angles = [
      'security',
      'concurrency',
      'performance',
      'edge-cases',
      'regression',
      'dependency',
      'data-integrity',
      'error-handling',
    ]
    for (const angle of angles) {
      const result = RedTeamFindingSchema.safeParse({ ...validFinding, angle })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid impact value', () => {
    const result = RedTeamFindingSchema.safeParse({ ...validFinding, impact: 'BLOCKER' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid angle value', () => {
    const result = RedTeamFindingSchema.safeParse({ ...validFinding, angle: 'vibes' })
    expect(result.success).toBe(false)
  })

  it('rejects missing id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _, ...rest } = validFinding
    const result = RedTeamFindingSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})

describe('RedTeamEvidenceV1 (#691)', () => {
  const validEvidence = {
    task_id: '#689',
    timestamp: '2026-05-16T10:00:00.000Z',
    agent_count: 2,
    findings: [
      {
        id: 'RT-01',
        angle: 'security',
        impact: 'MEDIUM',
        description: 'Minor issue',
        recommendation: 'Fix it',
      },
    ],
  }

  it('round-trips a valid evidence document', () => {
    const result = RedTeamEvidenceV1.safeParse(validEvidence)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.task_id).toBe('#689')
      expect(result.data.findings).toHaveLength(1)
      expect(result.data.agent_count).toBe(2)
    }
  })

  it('accepts empty findings array', () => {
    const result = RedTeamEvidenceV1.safeParse({ ...validEvidence, findings: [] })
    expect(result.success).toBe(true)
  })

  it('rejects missing task_id', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { task_id: _, ...rest } = validEvidence
    const result = RedTeamEvidenceV1.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects negative agent_count', () => {
    const result = RedTeamEvidenceV1.safeParse({ ...validEvidence, agent_count: -1 })
    expect(result.success).toBe(false)
  })
})
