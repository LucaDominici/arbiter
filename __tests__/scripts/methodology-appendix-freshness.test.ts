// SPDX-License-Identifier: Apache-2.0
// #1943 acceptance (b): "the PARTIAL/TO-CREATE rows of appendix §5 updated to EXISTS with a
// code anchor". That was hand-checked once when E1-E7 landed, and then rotted in three
// places — the M15 bypass-ceremony row still read "detector missing" months after
// scripts/check-bypass-ceremony.mjs shipped and was wired, and the M4 finding-loss row still
// read "Not wired into the Stop chain" after the hook was registered.
//
// A hand-check that has to be repeated is a hand-check that will be skipped. These two rules
// make the appendix self-checking against the tree it describes, in the ONE direction that
// produces a false claim: a row understating machinery that demonstrably exists. The reverse
// direction (a row overstating) is deliberately left to review — "wired" has more shades than
// a regex can adjudicate, and a rule that guessed would be the fake-green this file guards.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const METHODOLOGY = resolve('docs/methodology/agent-orchestration-and-context-hygiene.md')
const CHECK_ALL = resolve('scripts/check-all.mjs')
const CLAUDE_SETTINGS = resolve('.claude/settings.json')

interface Row {
  measure: string
  status: string
  anchors: string
}

/** Parse the §5 table rows. Fails loudly if the table shape changed — never vacuously. */
function appendixRows(): Row[] {
  const src = readFileSync(METHODOLOGY, 'utf-8')
  const start = src.indexOf('## 5. Appendix')
  expect(start, '§5 heading not found — the appendix moved or was renamed').toBeGreaterThan(-1)
  const rows: Row[] = []
  for (const line of src.slice(start).split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    // | # | Measure | Mechanism | Status | Code anchors |  => 7 cells with the empty ends
    if (cells.length < 6) continue
    const [, id, measure, , status, anchors] = cells
    if (id === '#' || (id ?? '').startsWith('---')) continue
    rows.push({ measure: `${id} ${measure}`, status: status ?? '', anchors: anchors ?? '' })
  }
  expect(rows.length, 'extracted zero §5 rows — the parser is out of date').toBeGreaterThan(10)
  return rows
}

const understated = (status: string): boolean =>
  status.includes('PARTIAL') || status.includes('TO-CREATE')

describe('#1943 §5 appendix must not understate what the tree already enforces', () => {
  const rows = appendixRows()

  it('no row is PARTIAL/TO-CREATE while a gate script it names is wired in check-all.mjs', () => {
    const checkAll = readFileSync(CHECK_ALL, 'utf-8')
    const stale: string[] = []
    for (const row of rows) {
      if (!understated(row.status)) continue
      for (const [, script] of row.anchors.matchAll(/`(scripts\/check-[\w-]+\.mjs)`/g)) {
        // Wired = check-all.mjs actually invokes it, hard or advisory. Merely existing on
        // disk is not enough — an unwired script is exactly what PARTIAL is for.
        if (checkAll.includes(`'${script}'`)) {
          stale.push(`${row.measure}: ${row.status} but ${script} is wired in check-all.mjs`)
        }
      }
    }
    expect(stale).toEqual([])
  })

  it('no row claims a hook is unwired while .claude/settings.json registers it', () => {
    const settings = readFileSync(CLAUDE_SETTINGS, 'utf-8')
    const stale: string[] = []
    for (const row of rows) {
      if (!/not wired|not activated|not-activated/i.test(`${row.status} ${row.anchors}`)) continue
      for (const [, hook] of row.anchors.matchAll(/`(\.claude\/hooks\/[\w-]+\.mjs)`/g)) {
        if (settings.includes(hook)) {
          stale.push(`${row.measure}: claims unwired but ${hook} is in .claude/settings.json`)
        }
      }
    }
    expect(stale).toEqual([])
  })

  it('every EXISTS row carries at least one backticked code anchor', () => {
    const bare = rows
      .filter((r) => r.status.includes('EXISTS') && !r.anchors.includes('`'))
      .map((r) => r.measure)
    expect(bare).toEqual([])
  })
})
