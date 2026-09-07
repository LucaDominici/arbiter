// SPDX-License-Identifier: Apache-2.0
// #2435 — the `/ship` lifecycle is presented as gate-blocked at every phase; half of it was not.
//
// These tests DERIVE their expectations from `.claude/commands/ship.md` (and from the
// `--to` help string in `src/cli.ts`) rather than restating a hand-written list, so a row
// added to the phase map, or a promise added to a row, immediately owns a gate — or fails.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PHASE_ORDER, LATERAL_PHASES } from '../../src/commands/task-state.js'

const SHIP_MD = '.claude/commands/ship.md'
const SHIP_TPL = 'src/templates/claude/commands/ship.md.ejs'
const TASK_TS = 'src/commands/task.ts'
const CLI_TS = 'src/cli.ts'

/**
 * The phase-map table rows of ship.md, as `phase → row text`.
 *
 * The table is the one whose header is `| Phase | What ...`; its rows start with a
 * backtick-quoted phase name.
 */
function phaseMapRows(markdown: string): Map<string, string> {
  const rows = new Map<string, string>()
  let inTable = false
  for (const line of markdown.split('\n')) {
    if (/^\|\s*Phase\s*\|/.test(line)) {
      inTable = true
      continue
    }
    if (inTable) {
      if (!line.startsWith('|')) {
        inTable = false
        continue
      }
      const m = line.match(/^\|\s*`([a-z-]+)`\s*\|(.*)$/)
      if (m) rows.set(m[1], m[2])
    }
  }
  return rows
}

/**
 * Top-level keys of the `phaseGates` record literal in `src/commands/task.ts`.
 *
 * Read from source rather than from the module because the record is a function-local
 * constant — the point of the check is that the ENTRY exists at all, which is a
 * structural property of the file.
 */
function phaseGateKeys(source: string): Set<string> {
  const start = source.indexOf('const phaseGates')
  expect(start, 'phaseGates record not found in src/commands/task.ts').toBeGreaterThan(-1)
  const open = source.indexOf('{', source.indexOf('=', start))
  let depth = 0
  const keys = new Set<string>()
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1) {
      const rest = source.slice(i)
      const m = rest.match(/^\n\s{4}'?([a-z-]+)'?:\s/)
      if (m) keys.add(m[1])
    }
  }
  return keys
}

/** A row promises machine-checkable work when it names a dispatch or an evidence artifact. */
function promisesDispatchOrArtifact(rowText: string): boolean {
  return /\bdispatch(es|ed|ing)?\b/i.test(rowText) || /\.arbiter\/evidence\//.test(rowText)
}

describe('#2435 AC-1 — every ship.md phase row that promises a dispatch or artifact is gated', () => {
  it('derives the promising phases from ship.md and finds a phaseGates entry for each (AC-1)', () => {
    const rows = phaseMapRows(readFileSync(SHIP_MD, 'utf-8'))
    expect(rows.size).toBeGreaterThan(0)

    const promising = [...rows.entries()]
      .filter(([, text]) => promisesDispatchOrArtifact(text))
      .map(([phase]) => phase)
    expect(promising.length).toBeGreaterThan(0)

    const gated = phaseGateKeys(readFileSync(TASK_TS, 'utf-8'))
    const ungated = promising.filter((p) => !gated.has(p))
    expect(ungated, `ship.md rows promising a dispatch/artifact with no phaseGates entry`).toEqual(
      [],
    )
  })

  it('keeps the same property in the emitted template twin (AC-1)', () => {
    const rows = phaseMapRows(readFileSync(SHIP_TPL, 'utf-8'))
    const promising = [...rows.entries()]
      .filter(([, text]) => promisesDispatchOrArtifact(text))
      .map(([phase]) => phase)
    const gated = phaseGateKeys(readFileSync(TASK_TS, 'utf-8'))
    expect(promising.filter((p) => !gated.has(p))).toEqual([])
  })
})

describe('#2435 AC-4 — the --to phase set equals the ship.md phase-map row set', () => {
  /** The phases enumerated in the `--to <phase>` help string of `arbiter task advance`. */
  function advanceChoices(cliSource: string): Set<string> {
    const m = cliSource.match(/'Target phase \(([^)]+)\)'/)
    expect(m, '--to help string not found in src/cli.ts').not.toBeNull()
    return new Set((m as RegExpMatchArray)[1].split('|'))
  }

  it('ship.md names every phase `task advance --to` accepts (AC-4)', () => {
    const documented = new Set(phaseMapRows(readFileSync(SHIP_MD, 'utf-8')).keys())
    const accepted = advanceChoices(readFileSync(CLI_TS, 'utf-8'))
    expect([...accepted].filter((p) => !documented.has(p)).sort()).toEqual([])
    expect([...documented].filter((p) => !accepted.has(p)).sort()).toEqual([])
  })

  it('the accepted set is exactly the engine phase vocabulary (AC-4)', () => {
    const accepted = advanceChoices(readFileSync(CLI_TS, 'utf-8'))
    const engine = new Set<string>([...PHASE_ORDER, ...LATERAL_PHASES])
    expect([...accepted].sort()).toEqual([...engine].sort())
  })

  it('the template twin documents the same phase set (AC-4)', () => {
    const documented = new Set(phaseMapRows(readFileSync(SHIP_TPL, 'utf-8')).keys())
    const engine = new Set<string>([...PHASE_ORDER, ...LATERAL_PHASES])
    expect([...documented].sort()).toEqual([...engine].sort())
  })
})

describe('#2435 AC-5 — the tdd skill names the command that writes the green gate evidence', () => {
  const SKILL = '.claude/skills/tdd/SKILL.md'
  const SKILL_TPL = 'src/templates/claude/skills/tdd/SKILL.md.ejs'

  it('SKILL.md names `arbiter task record-red` (AC-5)', () => {
    expect(readFileSync(SKILL, 'utf-8')).toContain('arbiter task record-red')
  })

  it('the template twin names it too (AC-5)', () => {
    expect(readFileSync(SKILL_TPL, 'utf-8')).toContain('arbiter task record-red')
  })

  it('every phase gate that reads an evidence file is named by the skill the ship.md row routes to (AC-5)', () => {
    // The `green` gate reads the RED evidence file. ship.md's `red` row routes the user to the
    // `tdd` skill, so that skill must name the command that writes what the gate reads.
    const rows = phaseMapRows(readFileSync(SHIP_MD, 'utf-8'))
    const redRow = rows.get('red') ?? ''
    expect(redRow).toMatch(/`tdd` skill/)
    expect(readFileSync(SKILL, 'utf-8')).toMatch(/arbiter task record-red/)
  })
})
