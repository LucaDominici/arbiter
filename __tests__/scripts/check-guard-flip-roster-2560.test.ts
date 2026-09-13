// SPDX-License-Identifier: Apache-2.0
// #2560 — membership is a declared property, not a name match. Before this fix, a gate that
// asserts absence but whose name/script matched none of `^check-no-`/`ratchet|no-regress`/
// `parity` returned `null` from the old regex classifier and sat outside the family forever,
// never asked for a flip proof (`check-todo-max-age.mjs` is the proof case named in the issue).
//
// Codex round-1 review found the first cut still escapable: a wired gate tripping NO heuristic
// at all returned `[]` silently — the same defect class, one level up. The fix removes the
// heuristic entirely: EVERY wired mechanism must be classified into exactly one of three declared
// tables (ABSENCE_FAMILY_ROSTER / NOT_ABSENCE / ABSENCE_EXEMPT); an unclassified mechanism is a
// loud error regardless of its name. Round-1 also required each ABSENCE_EXEMPT entry to be
// machine-validated (script wired, reason ≥3 words, until/followUp present) so an exemption
// cannot be a blank check.
//
// Kept in its own file, separate from check-guard-flip.test.ts: every case here drives the
// harness exclusively through --gate/--registry/--roster fixtures and never touches the real
// scripts/check-all.mjs or the kernel-plugin-parity flip fixture (which needs dist/ built). This
// file is fully dist-independent, so it can be re-executed in a fresh detached worktree with only
// node_modules linked (the TDD-evidence re-executor's environment) without a spurious failure.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const HARNESS = resolve('scripts/check-guard-flip.mjs')

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'guard-flip-roster-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// A gate whose name/basename match none of the old three regexes (no `check-no-` prefix, no
// "ratchet", no "parity") AND none of the old wider candidate signal either (no "no"/"never"/
// "drift"/"regress"/"snapshot"/"absence" word) — genuinely unsignalled by any name heuristic.
const UNSIGNALLED_GATE =
  "runCheck('widget freshness audit', 'node', ['scripts/check-widget-freshness.mjs'])\n"

describe('#2560 — absence-family membership is declared, not name-matched', () => {
  const DECLARED_ROSTER = {
    family: {
      'widget freshness audit': {
        script: 'scripts/check-widget-freshness.mjs',
        category: 'no',
      },
    },
    notAbsence: {},
    exempt: {},
  }

  it('a declared gate outside the old name patterns is admitted to the family', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, UNSIGNALLED_GATE)
      const roster = join(dir, 'roster.json')
      writeFileSync(roster, JSON.stringify(DECLARED_ROSTER))
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      // No flip proof registered for it either — so it is admitted (not silently excluded) AND
      // reported UNCOVERED, proving both halves: membership by declaration, and the requirement
      // to prove it once a member.
      const r = spawnSync(
        'node',
        [
          HARNESS,
          `--gate=${gate}`,
          `--registry=${reg}`,
          `--roster=${roster}`,
          '--min-family=1',
          '--max-deferred=0',
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(1)
      expect(`${r.stdout}${r.stderr}`).toMatch(/widget freshness audit/)
    })
  })
})

describe('#2560 Codex round-1 #1 — an UNSIGNALLED, undeclared gate is a loud ERROR, never []', () => {
  it('a wired gate with no name heuristic hit and no declaration in any table is a loud ERROR', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, UNSIGNALLED_GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      // Empty on all three tables: no heuristic can excuse the silence a name-based classifier
      // would have produced here — the old cut returned `[]` for exactly this shape.
      const emptyRoster = join(dir, 'roster.json')
      writeFileSync(emptyRoster, JSON.stringify({ family: {}, notAbsence: {}, exempt: {} }))
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${emptyRoster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/unclassified wired gate/)
      expect(`${r.stdout}${r.stderr}`).toMatch(/widget freshness audit/)
    })
  })

  it('the same gate is silent (no error) once declared NOT_ABSENCE — a real presence check', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, UNSIGNALLED_GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {
            'widget freshness audit': { script: 'scripts/check-widget-freshness.mjs' },
          },
          exempt: {},
        }),
      )
      const r = spawnSync(
        'node',
        [
          HARNESS,
          `--gate=${gate}`,
          `--registry=${reg}`,
          `--roster=${roster}`,
          '--min-family=0',
          '--max-deferred=0',
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(0)
    })
  })
})

describe('#2560 Codex round-1 #2 — every ABSENCE_EXEMPT entry is machine-validated', () => {
  const GATE = "runCheck('anti-drift: widget scan', 'node', ['scripts/check-widget-drift.mjs'])\n"
  const validExempt = {
    script: 'scripts/check-widget-drift.mjs',
    reason: 'reads live repo state, no fixture flag',
    followUp: '#2675',
  }

  it('a well-formed exemption (wired script, real reason, followUp) is accepted silently', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {},
          exempt: { 'anti-drift: widget scan': validExempt },
        }),
      )
      const r = spawnSync(
        'node',
        [
          HARNESS,
          `--gate=${gate}`,
          `--registry=${reg}`,
          `--roster=${roster}`,
          '--min-family=0',
          '--max-deferred=0',
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(0)
    })
  })

  it('an exemption whose script disagrees with the live wiring (stale) is a loud ERROR', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {},
          exempt: {
            'anti-drift: widget scan': { ...validExempt, script: 'scripts/check-wrong-file.mjs' },
          },
        }),
      )
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${roster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/stale exemption/)
    })
  })

  it('an exemption with a blank/placeholder reason (<3 words) is a loud ERROR', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {},
          exempt: { 'anti-drift: widget scan': { ...validExempt, reason: 'tbd' } },
        }),
      )
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${roster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/at least 3 words/)
    })
  })

  it('an exemption with neither `until` nor `followUp` is a loud ERROR (no open-ended exclusion)', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      const { followUp: _drop, ...noFollowUp } = validExempt
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {},
          exempt: { 'anti-drift: widget scan': noFollowUp },
        }),
      )
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${roster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/no ticket and no expiry/)
    })
  })
})

describe('#2560 Codex round-2 #1 — exactly one table per wired mechanism', () => {
  const GATE = "runCheck('anti-drift: widget scan', 'node', ['scripts/check-widget-drift.mjs'])\n"

  it('a gate declared in TWO tables is a loud ERROR naming both', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: { 'anti-drift: widget scan': { script: 'scripts/check-widget-drift.mjs' } },
          exempt: {
            'anti-drift: widget scan': {
              script: 'scripts/check-widget-drift.mjs',
              reason: 'reads live repo state, no fixture flag',
              followUp: '#2675',
            },
          },
        }),
      )
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${roster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/declared in more than one table/)
      expect(`${r.stdout}${r.stderr}`).toMatch(/NOT_ABSENCE/)
      expect(`${r.stdout}${r.stderr}`).toMatch(/ABSENCE_EXEMPT/)
    })
  })

  it('a table row naming a gate that is NOT wired (stale) is a loud ERROR, not silently skipped', () => {
    withTmp((dir) => {
      // GATE is wired and correctly classified NOT_ABSENCE; the roster ALSO carries a row for a
      // gate that check-all.mjs never wires at all — a leftover from a rename or removal.
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {
            'anti-drift: widget scan': { script: 'scripts/check-widget-drift.mjs' },
            'a gate nobody wires anymore': { script: 'scripts/check-nonexistent.mjs' },
          },
          exempt: {},
        }),
      )
      const r = spawnSync(
        'node',
        [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${roster}`],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/NOT_ABSENCE\['a gate nobody wires anymore'\]/)
      expect(`${r.stdout}${r.stderr}`).toMatch(/not wired in check-all\.mjs/)
    })
  })
})

describe('#2560 Codex round-2 #2 — `until` must be a real, unexpired calendar date', () => {
  const GATE = "runCheck('anti-drift: widget scan', 'node', ['scripts/check-widget-drift.mjs'])\n"
  const baseExempt = {
    script: 'scripts/check-widget-drift.mjs',
    reason: 'reads live repo state, no fixture flag',
  }

  function runWithUntil(dir: string, until: string) {
    const gate = join(dir, 'check-all.mjs')
    writeFileSync(gate, GATE)
    const reg = join(dir, 'registry.json')
    writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
    const roster = join(dir, 'roster.json')
    writeFileSync(
      roster,
      JSON.stringify({
        family: {},
        notAbsence: {},
        exempt: { 'anti-drift: widget scan': { ...baseExempt, until } },
      }),
    )
    return spawnSync(
      'node',
      [HARNESS, `--gate=${gate}`, `--registry=${reg}`, `--roster=${roster}`],
      {
        encoding: 'utf-8',
      },
    )
  }

  it('an `until` that is not a real calendar date (2026-99-99) is a loud ERROR', () => {
    withTmp((dir) => {
      const r = runWithUntil(dir, '2026-99-99')
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/not a real calendar date/)
    })
  })

  it('an `until` in the past (2000-01-01) is a loud ERROR — expired exemption', () => {
    withTmp((dir) => {
      const r = runWithUntil(dir, '2000-01-01')
      expect(r.status).toBe(2)
      expect(`${r.stdout}${r.stderr}`).toMatch(/expired exemption/)
    })
  })

  it('an `until` far in the future is accepted', () => {
    withTmp((dir) => {
      const gate = join(dir, 'check-all.mjs')
      writeFileSync(gate, GATE)
      const reg = join(dir, 'registry.json')
      writeFileSync(reg, JSON.stringify({ ceiling: 0, deferred: [] }))
      const roster = join(dir, 'roster.json')
      writeFileSync(
        roster,
        JSON.stringify({
          family: {},
          notAbsence: {},
          exempt: { 'anti-drift: widget scan': { ...baseExempt, until: '2099-01-01' } },
        }),
      )
      const r = spawnSync(
        'node',
        [
          HARNESS,
          `--gate=${gate}`,
          `--registry=${reg}`,
          `--roster=${roster}`,
          '--min-family=0',
          '--max-deferred=0',
        ],
        { encoding: 'utf-8' },
      )
      expect(r.status).toBe(0)
    })
  })
})
