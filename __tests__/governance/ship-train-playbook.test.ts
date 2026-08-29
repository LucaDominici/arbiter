// SPDX-License-Identifier: Apache-2.0
// #2401 — the playbook never mentioned trains, so agents ran the full per-issue
// ceremony (plan, plan-review, red-team, code review, cross-model seat, full gate,
// PR) for every three-line fix. The doc IS the enforcement surface here: nothing
// executes ship.md, so a missing section is a silently missing rule.
//
// `.claude/commands/*.md` are MATERIALIZED from `src/templates/claude/commands/*.md.ejs`
// (INV-45, scripts/check-self-dogfood.mjs) — both twins are asserted so a fix applied to
// only one of them fails here instead of drifting until the dogfood gate notices.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../..')
const raw = (p: string): string => readFileSync(join(root, p), 'utf-8')
// Prose wraps: a sentence that must be PRESENT is asserted on whitespace-collapsed text so a
// reflow never turns a governance rule into a failing test.
const flat = (p: string): string => raw(p).replace(/\s+/g, ' ')

const SHIP_TWINS = [
  '.claude/commands/ship.md',
  'src/templates/claude/commands/ship.md.ejs',
] as const
const DRAIN_TWINS = [
  '.claude/commands/drain.md',
  'src/templates/claude/commands/drain.md.ejs',
] as const

describe('ship.md §Train (#2401)', () => {
  for (const path of SHIP_TWINS) {
    describe(path, () => {
      it('AC-2401.3: carries a ## Train section, directly after §The loop', () => {
        const body = raw(path)
        expect(body.includes('\n## Train\n')).toBe(true)
        expect(body.indexOf('\n## Train\n')).toBeGreaterThan(body.indexOf('\n## The loop\n'))
        expect(body.indexOf('\n## Train\n')).toBeLessThan(body.indexOf('\n## Phase map\n'))
      })

      it('AC-2401.3: names the per-issue residue, the tier rule and the config knob', () => {
        const train = flat(path).slice(flat(path).indexOf('## Train '))
        for (const marker of [
          'AC-<issue>.<n>',
          'Closes #',
          'widest',
          'arbiter.json',
          'ship.train',
        ]) {
          expect(train.includes(marker)).toBe(true)
        }
      })

      it('AC-2401.3: cites §Gate economy rather than restating the cadence', () => {
        const body = flat(path)
        const train = body.slice(body.indexOf('## Train '), body.indexOf('## Local-only state'))
        expect(train.includes('Gate economy')).toBe(true)
      })

      it('AC-2401.3: calls per-issue ceremony on a batch a violation, not extra safety', () => {
        expect(flat(path).includes('playbook violation, not extra safety')).toBe(true)
      })
    })
  }
})

// #2400 — the convergence rule is a doc rule as much as an engine rule: the engine counts the
// rounds, but only ship.md tells the agent to review the delta and to park sub-HIGH findings.
describe('ship.md bounded review rounds (#2400)', () => {
  for (const path of SHIP_TWINS) {
    describe(path, () => {
      it('AC-2400.3: §Refactor documents delta-only re-review and the severity threshold', () => {
        const body = flat(path)
        const refactor = body.slice(body.indexOf('## Refactor / code-review evidence'))
        for (const marker of [
          '--review-round',
          '--force-review',
          'git diff <lastReviewedSha>..HEAD',
          'below HIGH do not block landing',
          'ship.review.maxRounds',
        ]) {
          expect(refactor.includes(marker)).toBe(true)
        }
      })

      it('AC-2400.3: scopes the HIGH threshold to reviewer findings, sparing the ac-fit gate', () => {
        expect(flat(path).includes('ac-fit verdicts below are a separate hard gate')).toBe(true)
      })

      it('AC-2400.3: counts review rounds per train, in the §Train table', () => {
        const body = flat(path)
        const train = body.slice(body.indexOf('## Train '), body.indexOf('## Local-only state'))
        expect(train.includes('review rounds (`ship.review.maxRounds`)')).toBe(true)
      })
    })
  }
})

// #2402 — a PR is owned until merged. The engine refuses `complete`; the doc is where the
// session-ending rule lives, because no gate can observe "the agent walked away".
describe('ship.md landing + handover (#2402)', () => {
  for (const path of SHIP_TWINS) {
    describe(path, () => {
      it('AC-2402.3: §Complete states that advance --to complete requires MERGED', () => {
        const body = flat(path)
        const complete = body.slice(body.indexOf('## Complete'))
        for (const marker of ['MERGED', '--no-pr', '--pr <n>', 'gh pr list --head']) {
          expect(complete.includes(marker)).toBe(true)
        }
      })

      it('AC-2402.3: carries a Handover subsection with the open-PR table', () => {
        const body = flat(path)
        expect(body.includes('### Handover')).toBe(true)
        const handover = body.slice(body.indexOf('### Handover'))
        for (const marker of [
          '.arbiter/HANDOVER-<date>-<slug>.md',
          '## Open PRs',
          'needs-human',
          'CI state',
          'Blocker',
        ]) {
          expect(handover.includes(marker)).toBe(true)
        }
      })

      it('AC-2402.3: §Hard stops forbids abandoning a red open PR', () => {
        expect(
          flat(path).includes('An open PR with red CI is never abandoned — watch, fix, re-watch'),
        ).toBe(true)
      })
    })
  }
})

describe('drain.md alignment (#2401)', () => {
  for (const path of DRAIN_TWINS) {
    it(`AC-2401.3: ${path} points at ship.md §Train instead of restating it`, () => {
      const body = flat(path)
      expect(body.includes('§Train')).toBe(true)
      expect(body.includes('A wave IS a train')).toBe(true)
    })
  }
})

describe('AGENTS.md ceremony cadence (#2401)', () => {
  it('AC-2401.3: states ceremony-per-train, gates-per-landing and names the config knob', () => {
    const body = flat('AGENTS.md')
    expect(body.includes('Ceremony is per train, gates are per landing')).toBe(true)
    expect(body.includes('ship.train')).toBe(true)
  })
})
