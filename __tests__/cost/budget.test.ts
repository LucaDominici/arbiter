// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { assertImplBudget } from '../../src/cost/budget.js'

const BASE_REPORT = {
  taskId: '#703',
  byPhase: {
    red: { in: 10_000, out: 2_000, samples: 5 },
  },
  totals: { in: 10_000, out: 2_000, samples: 5 },
}

describe('assertImplBudget (#703)', () => {
  it('returns ok=true when input tokens under default threshold', () => {
    const result = assertImplBudget(BASE_REPORT, 50_000)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('returns ok=false when input tokens over threshold', () => {
    const over = {
      ...BASE_REPORT,
      byPhase: { red: { in: 60_000, out: 5_000, samples: 3 } },
      totals: { in: 60_000, out: 5_000, samples: 3 },
    }
    const result = assertImplBudget(over, 50_000)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/budget|threshold|token/i)
  })

  it('returns ok=true (warn-only) when samples=0 regardless of threshold', () => {
    const noSamples = {
      ...BASE_REPORT,
      byPhase: { red: { in: 0, out: 0, samples: 0 } },
      totals: { in: 0, out: 0, samples: 0 },
    }
    const result = assertImplBudget(noSamples, 1)
    expect(result.ok).toBe(true)
    expect(result.reason).toMatch(/warn|no.*sample|transcript/i)
  })

  it('uses first-phase input tokens for assessment', () => {
    const report = {
      taskId: '#703',
      byPhase: {
        red: { in: 80_000, out: 3_000, samples: 2 },
        green: { in: 5_000, out: 1_000, samples: 1 },
      },
      totals: { in: 85_000, out: 4_000, samples: 3 },
    }
    const result = assertImplBudget(report, 50_000)
    expect(result.ok).toBe(false)
  })

  it('custom threshold is respected', () => {
    const result = assertImplBudget(BASE_REPORT, 5_000)
    expect(result.ok).toBe(false)
  })

  it('returns ok=true (warn-only) when byPhase is empty', () => {
    const empty = {
      taskId: '#703',
      byPhase: {},
      totals: { in: 0, out: 0, samples: 0 },
    }
    const result = assertImplBudget(empty, 1)
    expect(result.ok).toBe(true)
    expect(result.reason).toMatch(/warn|no.*sample|transcript/i)
  })

  it('default threshold is 50_000', () => {
    const under = {
      ...BASE_REPORT,
      byPhase: { red: { in: 49_999, out: 1_000, samples: 1 } },
      totals: { in: 49_999, out: 1_000, samples: 1 },
    }
    expect(assertImplBudget(under).ok).toBe(true)
    const over = {
      ...BASE_REPORT,
      byPhase: { red: { in: 50_001, out: 1_000, samples: 1 } },
      totals: { in: 50_001, out: 1_000, samples: 1 },
    }
    expect(assertImplBudget(over).ok).toBe(false)
  })
})
