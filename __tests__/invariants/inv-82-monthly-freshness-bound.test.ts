// SPDX-License-Identifier: Apache-2.0
// #2534: INV-82's title and description claimed a ≤32-day monthly-freshness bound
// while the job that actually enforces it — assert-monthly-freshness in
// 09-heartbeat.yml — has always checked `AGE_DAYS -gt 35`. A monthly run aged 33 or
// 34 days was, per INV-82's own wording, "a silent CI failure" that nothing failed.
//
// This is a regression guard, not a behavioural test: it derives the REAL enforced
// threshold straight from the workflow's shell condition (never hardcodes 35 — a
// later change to the job's threshold must not silently desync this guard) and
// fails if any invariant, or AGENTS.md itself, states a competing monthly-freshness
// day-bound. INV-75 is the sole intended owner of the numeric bound; INV-82 keeps
// only the "08-monthly.yml must exist" clause and defers the number to INV-75.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INVARIANT_CATALOG } from '../../src/invariants/catalog.js'

const read = (p: string): string => readFileSync(resolve(p), 'utf8')

/**
 * Pull the day threshold the assert-monthly-freshness job in 09-heartbeat.yml
 * actually checks, straight from its shell condition — never a constant we own.
 */
function extractEnforcedMonthlyFreshnessDays(workflow: string): number {
  const marker = 'assert-monthly-freshness:'
  const jobIdx = workflow.indexOf(marker)
  expect(jobIdx, 'assert-monthly-freshness job must exist in 09-heartbeat.yml').toBeGreaterThan(-1)

  // Bound the job block at the next top-level (2-space-indented) job header, if any.
  const rest = workflow.slice(jobIdx + marker.length)
  const nextJobHeader = rest.match(/\n {2}[A-Za-z0-9_-]+:\n/)
  const jobBlock = nextJobHeader ? rest.slice(0, nextJobHeader.index) : rest

  const thresholdMatch = jobBlock.match(/AGE_DAYS"\s*-gt\s*(\d+)/)
  expect(
    thresholdMatch,
    'assert-monthly-freshness job must contain an `AGE_DAYS -gt <N>` threshold check',
  ).not.toBeNull()

  return Number(thresholdMatch?.[1])
}

/**
 * Find every "<N> day(s)"-shaped bound stated within ~80 chars of the word
 * "month" in a blob of prose. Catches both title-style phrasing ("≤35 d") and
 * sentence-style phrasing ("within the last 35 days") without hardcoding either
 * exact phrase, so a future rewording of either invariant still gets checked.
 */
function findMonthlyDayBounds(text: string): number[] {
  const found: number[] = []
  const dayNumberPattern = /(\d+)\s*d(?:ays?)?\b/gi
  let match: RegExpExecArray | null
  while ((match = dayNumberPattern.exec(text)) !== null) {
    const windowStart = Math.max(0, match.index - 80)
    const window = text.slice(windowStart, match.index)
    if (/month/i.test(window)) {
      found.push(Number(match[1]))
    }
  }
  return found
}

describe('#2534 — monthly-freshness bound: no invariant may disagree with the enforced job', () => {
  it('the extractor derives a real positive numeric threshold from 09-heartbeat.yml', () => {
    const workflow = read('.github/workflows/09-heartbeat.yml')
    const enforced = extractEnforcedMonthlyFreshnessDays(workflow)
    expect(Number.isFinite(enforced)).toBe(true)
    expect(enforced).toBeGreaterThan(0)
  })

  it('no invariant catalog entry states a monthly-freshness day-bound that disagrees with the enforced job', () => {
    const workflow = read('.github/workflows/09-heartbeat.yml')
    const enforced = extractEnforcedMonthlyFreshnessDays(workflow)

    const offenders: Array<{ id: string; field: string; found: number }> = []
    for (const inv of INVARIANT_CATALOG) {
      const fields: Array<['title' | 'description', string | undefined]> = [
        ['title', inv.title],
        ['description', inv.description],
      ]
      for (const [field, value] of fields) {
        if (typeof value !== 'string') continue
        for (const found of findMonthlyDayBounds(value)) {
          if (found !== enforced) {
            offenders.push({ id: inv.id, field, found })
          }
        }
      }
    }

    expect(
      offenders,
      `every stated monthly-freshness bound must equal the enforced ${enforced}-day ` +
        'threshold in 09-heartbeat.yml (assert-monthly-freshness job)',
    ).toEqual([])
  })

  it('AGENTS.md states no monthly-freshness day-bound that disagrees with the enforced job', () => {
    const workflow = read('.github/workflows/09-heartbeat.yml')
    const enforced = extractEnforcedMonthlyFreshnessDays(workflow)
    const agents = read('AGENTS.md')

    const disagreeing = findMonthlyDayBounds(agents).filter((n) => n !== enforced)
    expect(
      disagreeing,
      `AGENTS.md must not state a monthly-freshness bound other than the enforced ${enforced} days`,
    ).toEqual([])
  })
})
